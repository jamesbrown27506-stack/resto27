"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, requireUser } from "@/lib/auth/session";
import { notify } from "@/lib/notify";
import { rateLimit } from "@/lib/rate-limit";

/**
 * In-app messaging — threaded conversations.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  TWO KINDS OF THREAD, ONE TABLE:
 *
 *   · someone ↔ restaurant  (conversations.restaurant_id set) — the
 *     restaurant's ACTIVE staff are the staff side;
 *   · someone ↔ platform    (conversations.restaurant_id NULL) — admins are
 *     the staff side, which is the "write to the administrator" case.
 *
 *  "SOMEONE" IS THE THREAD'S INITIATOR, NOT NECESSARILY A CUSTOMER. The
 *  column is called customer_id because customers were the only people who
 *  could open a thread; a RESTAURANT had no way to reach the platform at
 *  all, which left the one relationship the business actually runs on —
 *  tenant to operator — with no channel inside the product. A manager may now
 *  open a platform thread (restaurant_id NULL, customer_id = their own
 *  profile), and the existing RLS already covers it: the read policy grants
 *  `customer_id = current_profile_id()` whatever role that profile holds.
 *
 *  Two ideas are therefore kept apart below:
 *   · SIDE       — initiator or staff. It decides which unread counter moves
 *                  and who gets notified.
 *   · SENDER ROLE — customer / manager / admin, snapshotted on the message so
 *                  a manager's words are not filed under "customer".
 *
 *  EVERY MUTATION IS SCOPED BY SESSION:
 *   · the initiator id always comes from requireUser(),
 *   · staff membership is re-verified against restaurant_staff on every
 *     call — a role removed from the team loses access immediately,
 *   · admins only reach restaurant_id IS NULL threads,
 *   · a manager may only open a PLATFORM thread — they cannot write to
 *     another restaurant by passing its id.
 *
 *  RATE LIMITED — a conversation that can be abused is a spam engine with
 *  a mail relay attached (each message notifies + emails the other side).
 * ─────────────────────────────────────────────────────────────────────────
 */

const MAX_BODY = 2000;
const MAX_SUBJECT = 120;

export interface ChatConversationSummary {
  id: string;
  subject: string;
  status: "open" | "closed";
  restaurantId: string | null;
  /** The other side's display name, resolved per viewer role. */
  peerName: string;
  /**
   * What the other side IS. Only meaningful on the staff/admin side, where
   * the platform inbox now carries restaurants as well as diners and
   * answering one as though it were the other is a real mistake to make.
   */
  peerRole: "customer" | "manager" | "admin" | null;
  lastMessage: string | null;
  lastMessageAt: string;
  /** MY side's unread count. */
  unread: number;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderRole: "customer" | "manager" | "admin";
  senderName: string;
  body: string;
  read: boolean;
  createdAt: string;
}

export interface ChatThread {
  id: string;
  subject: string;
  status: "open" | "closed";
  peerName: string;
  /** True when the caller may still post to this thread. */
  canPost: boolean;
  messages: ChatMessage[];
}

type ActionResult = { ok: true } | { ok: false; error: string };

function cleanBody(raw: unknown): string {
  return String(raw ?? "").replace(/\r\n/g, "\n").trim().slice(0, MAX_BODY);
}

/** One side may not read the other's messages — the whole thread is shared. */
async function loadThread(
  conversationId: string,
): Promise<{
  id: string;
  subject: string;
  status: string;
  customerId: string;
  restaurantId: string | null;
} | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("conversations")
    .select("id, subject, status, customer_id, restaurant_id")
    .eq("id", conversationId)
    .maybeSingle();
  return (data as unknown as {
    id: string;
    subject: string;
    status: string;
    customer_id: string;
    restaurant_id: string | null;
  } | null)
    ? {
        id: data!.id,
        subject: data!.subject,
        status: data!.status,
        customerId: data!.customer_id,
        restaurantId: data!.restaurant_id,
      }
    : null;
}

async function isActiveStaff(profileId: string, restaurantId: string): Promise<boolean> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("restaurant_staff")
    .select("id")
    .eq("restaurant_id", restaurantId)
    .eq("profile_id", profileId)
    .eq("status", "active")
    .maybeSingle();
  return Boolean(data);
}

/**
 * Who the caller is in a thread.
 *
 * `side` decides mechanics (which unread counter moves, who is notified);
 * `senderRole` is what gets stamped on the message and never changes again.
 * Splitting them is what lets a manager hold a platform thread without their
 * messages being filed as a customer's.
 */
interface Participation {
  side: "initiator" | "staff";
  senderRole: "customer" | "manager" | "admin";
}

async function participationIn(
  thread: { customerId: string; restaurantId: string | null },
  profile: { id: string; role: string },
): Promise<Participation | null> {
  if (thread.customerId === profile.id) {
    return {
      side: "initiator",
      senderRole:
        profile.role === "manager" ? "manager" : profile.role === "admin" ? "admin" : "customer",
    };
  }
  if (thread.restaurantId && (await isActiveStaff(profile.id, thread.restaurantId))) {
    return { side: "staff", senderRole: "manager" };
  }
  if (!thread.restaurantId && profile.role === "admin") {
    return { side: "staff", senderRole: "admin" };
  }
  return null;
}

/** "The staff side" of a thread — a restaurant's staff, or every admin. */
async function notifyStaffSide(thread: { restaurantId: string | null }, preview: string) {
  if (thread.restaurantId) {
    await notify({
      event: "chat",
      tone: "info",
      restaurantId: thread.restaurantId,
      href: "/m/messages",
      params: { preview },
    });
  } else {
    await notify({
      event: "chat",
      tone: "info",
      admins: true,
      href: "/a/messages",
      params: { preview },
    });
  }
}

/* ── Customer: who can be written to ──────────────────────────────────── */

/** Active restaurants, for the "new conversation" picker. Cheap, safe list. */
export async function listChatTargets(): Promise<{ id: string; name: string }[]> {
  await requireUser();
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("restaurants")
    .select("id, name")
    .eq("status", "active")
    .order("name", { ascending: true })
    .limit(200);
  return ((data ?? []) as { id: string; name: string }[]).map((r) => ({ id: r.id, name: r.name }));
}

/* ── Customer: start a conversation ────────────────────────────────────── */

export async function startConversation(input: {
  restaurantId?: string | null;
  subject?: string;
  body: string;
}): Promise<ActionResult & { conversationId?: string }> {
  const initiator = await requireUser();
  // Admins answer threads, they do not open them — there is no "the platform
  // wrote to itself" inbox for the reply to land in.
  if (initiator.role !== "customer" && initiator.role !== "manager") {
    return { ok: false, error: "Only customers and restaurants can start conversations." };
  }

  const limited = await rateLimit({ key: "chat:start", limit: 5, windowMs: 60 * 60 * 1000, identifier: initiator.id });
  if (!limited.ok) return { ok: false, error: "Trop de conversations ouvertes. Réessayez dans une heure." };

  const body = cleanBody(input.body);
  const subject = String(input.subject ?? "").trim().slice(0, MAX_SUBJECT);
  if (body.length < 1) return { ok: false, error: "Votre message est vide." };

  const supabase = createAdminClient();
  // A manager's only correspondent is the platform. Forced server-side rather
  // than trusted from the form: a restaurant must not be able to open a
  // thread inside a competitor's inbox by posting their id.
  const restaurantId =
    initiator.role === "manager" ? null : input.restaurantId?.trim() || null;

  if (restaurantId) {
    // The target must exist and be active — a conversation with a suspended
    // restaurant is a conversation nobody will ever answer.
    const { data: restaurant } = await supabase
      .from("restaurants")
      .select("id")
      .eq("id", restaurantId)
      .eq("status", "active")
      .maybeSingle();
    if (!restaurant) return { ok: false, error: "Ce restaurant n'est pas joignable." };
  }

  const { data: conversation, error } = await supabase
    .from("conversations")
    .insert({ customer_id: initiator.id, restaurant_id: restaurantId, subject })
    .select("id")
    .single();

  if (error || !conversation) {
    console.error("[chat:start]", error?.message);
    return { ok: false, error: "Impossible d'ouvrir la conversation." };
  }

  const { error: messageError } = await supabase.from("conversation_messages").insert({
    conversation_id: conversation.id,
    sender_id: initiator.id,
    // Snapshotted: "manager" when a restaurant opened the thread, so the admin
    // reading it sees who is actually on the other end.
    sender_role: initiator.role === "manager" ? "manager" : "customer",
    body,
  });

  if (messageError) {
    console.error("[chat:start] first message", messageError.message);
    return { ok: false, error: "Impossible d'envoyer le message." };
  }

  // The first message IS the unread signal for the other side.
  await supabase
    .from("conversations")
    .update({ staff_unread: 1, last_message_at: new Date().toISOString() })
    .eq("id", conversation.id);

  await notifyStaffSide({ restaurantId }, body.slice(0, 80));

  return { ok: true, conversationId: conversation.id };
}

/* ── Any participant: send a message ───────────────────────────────────── */

export async function sendMessage(input: {
  conversationId: string;
  body: string;
}): Promise<ActionResult> {
  const profile = await requireUser();

  const limited = await rateLimit({ key: "chat:send", limit: 15, windowMs: 60_000, identifier: profile.id });
  if (!limited.ok) return { ok: false, error: "Trop de messages envoyés. Réessayez dans une minute." };

  const body = cleanBody(input.body);
  if (body.length < 1) return { ok: false, error: "Votre message est vide." };

  const supabase = createAdminClient();
  const thread = await loadThread(input.conversationId);
  if (!thread) return { ok: false, error: "Conversation introuvable." };

  // ── Who is the caller in this thread? ────────────────────────────────
  const part = await participationIn(thread, profile);
  if (!part) return { ok: false, error: "Vous ne participez pas à cette conversation." };
  if (thread.status === "closed") return { ok: false, error: "Cette conversation est fermée." };

  const { error } = await supabase.from("conversation_messages").insert({
    conversation_id: thread.id,
    sender_id: profile.id,
    sender_role: part.senderRole,
    body,
  });
  if (error) {
    console.error("[chat:send]", error.message);
    return { ok: false, error: "Impossible d'envoyer le message." };
  }

  // The other side's unread bumps (read-then-write: the raw increment needs
  // the current value); a reply reopens a closed thread. Keyed on SIDE, not
  // on sender role — a manager writing into their own platform thread is the
  // initiator, and it is the staff counter that must move.
  const otherSide = part.side === "initiator" ? "staff_unread" : "customer_unread";
  const { data: conv } = await supabase
    .from("conversations")
    .select(otherSide)
    .eq("id", thread.id)
    .maybeSingle();
  const current = (conv as Record<string, number> | null)?.[otherSide] ?? 0;

  await supabase
    .from("conversations")
    .update({
      last_message_at: new Date().toISOString(),
      status: "open",
      [otherSide]: current + 1,
    })
    .eq("id", thread.id);

  // The other side is told — with their own deep link. The initiator is not
  // always a customer any more, so the href follows their area rather than
  // sending a restaurant to a page under (customer) it cannot open.
  const preview = body.slice(0, 80);
  if (part.side === "initiator") {
    await notifyStaffSide(thread, preview);
  } else {
    const initiatorRole = await roleOf(thread.customerId);
    await notify({
      event: "chat_reply",
      tone: "info",
      customerId: thread.customerId,
      href: initiatorRole === "manager" ? "/m/messages" : "/messages",
      params: { preview },
    });
  }

  return { ok: true };
}

/** One profile's platform role — used only to aim a deep link. */
async function roleOf(profileId: string): Promise<string | null> {
  const supabase = createAdminClient();
  const { data } = await supabase.from("profiles").select("role").eq("id", profileId).maybeSingle();
  return (data as { role?: string } | null)?.role ?? null;
}

/* ── Lists — role decides whose threads ────────────────────────────────── */

/**
 * `mine` = threads I opened, whatever my role. `minePlatform` narrows that to
 * the platform ones, which is what a restaurant's support inbox shows: a
 * manager who once ordered dinner on their own account still has customer
 * threads with restaurants, and those belong in the customer area, not in the
 * tenant's conversation with the operator.
 */
type ListScope = "mine" | "minePlatform" | "staff" | "admin";

async function listFor(scope: ListScope, scopeId: string): Promise<ChatConversationSummary[]> {
  const supabase = createAdminClient();

  let query;
  if (scope === "mine" || scope === "minePlatform") {
    query = supabase
      .from("conversations")
      .select("id, subject, status, restaurant_id, staff_unread, customer_unread, last_message_at, restaurants ( name )")
      .eq("customer_id", scopeId);
    if (scope === "minePlatform") query = query.is("restaurant_id", null);
  } else if (scope === "staff") {
    query = supabase
      .from("conversations")
      .select("id, subject, status, restaurant_id, staff_unread, customer_unread, last_message_at, profiles!conversations_customer_id_fkey ( name, role )")
      .eq("restaurant_id", scopeId);
  } else {
    query = supabase
      .from("conversations")
      .select("id, subject, status, restaurant_id, staff_unread, customer_unread, last_message_at, profiles!conversations_customer_id_fkey ( name, role )")
      .is("restaurant_id", null);
  }

  const { data, error } = await query.order("last_message_at", { ascending: false }).limit(50);
  if (error) {
    console.error("[chat:list]", error.message);
    return [];
  }

  const rows = (data ?? []) as unknown as {
    id: string;
    subject: string;
    status: "open" | "closed";
    restaurant_id: string | null;
    staff_unread: number;
    customer_unread: number;
    last_message_at: string;
    restaurants: { name: string } | null;
    profiles: { name: string; role: string } | null;
  }[];

  const lastByThread = await lastMessageOf(rows.map((r) => r.id));
  const mine = scope === "mine" || scope === "minePlatform";

  return rows.map((row) => ({
    id: row.id,
    subject: row.subject,
    status: row.status,
    restaurantId: row.restaurant_id,
    peerName: mine
      ? (row.restaurants?.name ?? "Équipe RestoLink")
      : (row.profiles?.name ?? "Client"),
    peerRole: mine
      ? null
      : ((row.profiles?.role as ChatConversationSummary["peerRole"]) ?? "customer"),
    lastMessage: lastByThread.get(row.id)?.body ?? null,
    lastMessageAt: lastByThread.get(row.id)?.created_at ?? row.last_message_at,
    unread: mine ? row.customer_unread : row.staff_unread,
  }));
}

/** The most recent message body of each thread — one query, not N+1. */
async function lastMessageOf(conversationIds: string[]): Promise<Map<string, { body: string; created_at: string }>> {
  const out = new Map<string, { body: string; created_at: string }>();
  if (conversationIds.length === 0) return out;

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("conversation_messages")
    .select("conversation_id, body, created_at")
    .in("conversation_id", conversationIds)
    .order("created_at", { ascending: false })
    .limit(200);

  for (const row of (data ?? []) as { conversation_id: string; body: string; created_at: string }[]) {
    if (!out.has(row.conversation_id)) out.set(row.conversation_id, { body: row.body, created_at: row.created_at });
  }
  return out;
}

export async function listMyConversations(): Promise<ChatConversationSummary[]> {
  const profile = await requireUser();
  if (profile.role === "customer") return listFor("mine", profile.id);
  if (profile.role === "admin") return listFor("admin", profile.id);
  // Manager: their OWN threads with the platform. The branch's customer
  // threads are a different inbox and come from listBranchConversations —
  // this one is the restaurant writing to the operator, not answering diners.
  return listFor("minePlatform", profile.id);
}

/** The branch-scoped staff list — the /m/messages page calls this. */
export async function listBranchConversations(restaurantId: string): Promise<ChatConversationSummary[]> {
  const profile = await requireUser();
  if (!(await isActiveStaff(profile.id, restaurantId))) return [];
  return listFor("staff", restaurantId);
}

/* ── One thread ────────────────────────────────────────────────────────── */

export async function getConversation(conversationId: string): Promise<ChatThread | null> {
  const profile = await requireUser();
  const supabase = createAdminClient();
  const thread = await loadThread(conversationId);
  if (!thread) return null;

  // Same participant gate as sendMessage — reading is not broadcasting.
  const part = await participationIn(thread, profile);
  if (!part) return null;

  const { data: messages, error } = await supabase
    .from("conversation_messages")
    .select("id, sender_id, sender_role, body, read_at, created_at, profiles ( name )")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) return null;

  // Who the OTHER side is, from where I stand: the restaurant (or the
  // platform team) when I opened the thread, the initiator when I answer it.
  const peerName =
    part.side === "initiator"
      ? ((await restaurantName(thread.restaurantId)) ?? "Équipe RestoLink")
      : ((await profileName(thread.customerId)) ?? "Client");

  return {
    id: thread.id,
    subject: thread.subject,
    status: thread.status as "open" | "closed",
    peerName,
    canPost: thread.status === "open",
    messages: ((messages ?? []) as unknown as {
      id: string;
      sender_id: string;
      sender_role: "customer" | "manager" | "admin";
      body: string;
      read_at: string | null;
      created_at: string;
      profiles: { name: string } | null;
    }[]).map((m) => ({
      id: m.id,
      senderId: m.sender_id,
      senderRole: m.sender_role,
      senderName: m.profiles?.name ?? m.sender_role,
      body: m.body,
      read: m.read_at !== null,
      createdAt: m.created_at,
    })),
  };
}

async function restaurantName(id: string | null): Promise<string | null> {
  if (!id) return null;
  const supabase = createAdminClient();
  const { data } = await supabase.from("restaurants").select("name").eq("id", id).maybeSingle();
  return (data as { name?: string } | null)?.name ?? null;
}

async function profileName(id: string): Promise<string | null> {
  const supabase = createAdminClient();
  const { data } = await supabase.from("profiles").select("name").eq("id", id).maybeSingle();
  return (data as { name?: string } | null)?.name ?? null;
}

/* ── Mark read / close ─────────────────────────────────────────────────── */

export async function markConversationRead(conversationId: string): Promise<ActionResult> {
  const profile = await requireUser();
  const supabase = createAdminClient();
  const thread = await loadThread(conversationId);
  if (!thread) return { ok: false, error: "Conversation introuvable." };

  const part = await participationIn(thread, profile);
  if (!part) return { ok: false, error: "Vous ne participez pas à cette conversation." };

  // My side's messages become read; my counter zeroes.
  await supabase
    .from("conversation_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .neq("sender_id", profile.id)
    .is("read_at", null);

  const patch = part.side === "initiator" ? { customer_unread: 0 } : { staff_unread: 0 };
  await supabase.from("conversations").update(patch).eq("id", conversationId);

  return { ok: true };
}

export async function closeConversation(conversationId: string): Promise<ActionResult> {
  const profile = await requireUser();
  const supabase = createAdminClient();
  const thread = await loadThread(conversationId);
  if (!thread) return { ok: false, error: "Conversation introuvable." };

  if (!(await participationIn(thread, profile))) {
    return { ok: false, error: "Vous ne participez pas à cette conversation." };
  }

  await supabase
    .from("conversations")
    .update({ status: thread.status === "closed" ? "open" : "closed" })
    .eq("id", conversationId);

  return { ok: true };
}

/** For the restaurant directory "contact" affordance — the customer's own open thread with a restaurant, if any. */
export async function findOpenThreadWith(restaurantId: string): Promise<{ conversationId: string } | null> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "customer") return null;

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("conversations")
    .select("id")
    .eq("customer_id", profile.id)
    .eq("restaurant_id", restaurantId)
    .eq("status", "open")
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data ? { conversationId: (data as { id: string }).id } : null;
}
