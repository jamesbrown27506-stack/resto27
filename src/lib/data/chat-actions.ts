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
 *   · customer ↔ restaurant  (conversations.restaurant_id set) — the
 *     restaurant's ACTIVE staff are the staff side;
 *   · customer ↔ platform    (conversations.restaurant_id NULL) — admins are
 *     the staff side, which is the "write to the administrator" case.
 *
 *  EVERY MUTATION IS SCOPED BY SESSION:
 *   · the customer id always comes from requireUser(),
 *   · staff membership is re-verified against restaurant_staff on every
 *     call — a role removed from the team loses access immediately,
 *   · admins only reach restaurant_id IS NULL threads.
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
  const customer = await requireUser();
  if (customer.role !== "customer") return { ok: false, error: "Only customers can start conversations." };

  const limited = await rateLimit({ key: "chat:start", limit: 5, windowMs: 60 * 60 * 1000, identifier: customer.id });
  if (!limited.ok) return { ok: false, error: "Trop de conversations ouvertes. Réessayez dans une heure." };

  const body = cleanBody(input.body);
  const subject = String(input.subject ?? "").trim().slice(0, MAX_SUBJECT);
  if (body.length < 1) return { ok: false, error: "Votre message est vide." };

  const supabase = createAdminClient();
  const restaurantId = input.restaurantId?.trim() || null;

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
    .insert({ customer_id: customer.id, restaurant_id: restaurantId, subject })
    .select("id")
    .single();

  if (error || !conversation) {
    console.error("[chat:start]", error?.message);
    return { ok: false, error: "Impossible d'ouvrir la conversation." };
  }

  const { error: messageError } = await supabase.from("conversation_messages").insert({
    conversation_id: conversation.id,
    sender_id: customer.id,
    sender_role: "customer",
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
  let role: "customer" | "manager" | "admin" | null = null;
  if (thread.customerId === profile.id) {
    role = "customer";
  } else if (thread.restaurantId && (await isActiveStaff(profile.id, thread.restaurantId))) {
    role = "manager";
  } else if (!thread.restaurantId && profile.role === "admin") {
    role = "admin";
  }
  if (!role) return { ok: false, error: "Vous ne participez pas à cette conversation." };
  if (thread.status === "closed") return { ok: false, error: "Cette conversation est fermée." };

  const { error } = await supabase.from("conversation_messages").insert({
    conversation_id: thread.id,
    sender_id: profile.id,
    sender_role: role,
    body,
  });
  if (error) {
    console.error("[chat:send]", error.message);
    return { ok: false, error: "Impossible d'envoyer le message." };
  }

  // The other side's unread bumps (read-then-write: the raw increment needs
  // the current value); a reply reopens a closed thread.
  const otherSide = role === "customer" ? "staff_unread" : "customer_unread";
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

  // The other side is told — with their own deep link.
  const preview = body.slice(0, 80);
  if (role === "customer") {
    await notifyStaffSide(thread, preview);
  } else {
    await notify({
      event: "chat_reply",
      tone: "info",
      customerId: thread.customerId,
      href: "/messages",
      params: { preview },
    });
  }

  return { ok: true };
}

/* ── Lists — role decides whose threads ────────────────────────────────── */

async function listFor(scope: "customer" | "staff" | "admin", scopeId: string): Promise<ChatConversationSummary[]> {
  const supabase = createAdminClient();

  let query;
  if (scope === "customer") {
    query = supabase
      .from("conversations")
      .select("id, subject, status, restaurant_id, staff_unread, customer_unread, last_message_at, restaurants ( name )")
      .eq("customer_id", scopeId);
  } else if (scope === "staff") {
    query = supabase
      .from("conversations")
      .select("id, subject, status, restaurant_id, staff_unread, customer_unread, last_message_at, profiles!conversations_customer_id_fkey ( name )")
      .eq("restaurant_id", scopeId);
  } else {
    query = supabase
      .from("conversations")
      .select("id, subject, status, restaurant_id, staff_unread, customer_unread, last_message_at, profiles!conversations_customer_id_fkey ( name )")
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
    profiles: { name: string } | null;
  }[];

  const lastByThread = await lastMessageOf(rows.map((r) => r.id));

  return rows.map((row) => ({
    id: row.id,
    subject: row.subject,
    status: row.status,
    restaurantId: row.restaurant_id,
    peerName:
      scope === "customer"
        ? (row.restaurants?.name ?? "Équipe RestoLink")
        : (row.profiles?.name ?? "Client"),
    lastMessage: lastByThread.get(row.id)?.body ?? null,
    lastMessageAt: lastByThread.get(row.id)?.created_at ?? row.last_message_at,
    unread: scope === "customer" ? row.customer_unread : row.staff_unread,
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
  if (profile.role === "customer") return listFor("customer", profile.id);
  if (profile.role === "admin") return listFor("admin", profile.id);
  // Manager — but /m is branch-scoped; the page passes the active branch.
  return [];
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
  let role: "customer" | "manager" | "admin" | null = null;
  if (thread.customerId === profile.id) role = "customer";
  else if (thread.restaurantId && (await isActiveStaff(profile.id, thread.restaurantId))) role = "manager";
  else if (!thread.restaurantId && profile.role === "admin") role = "admin";
  if (!role) return null;

  const { data: messages, error } = await supabase
    .from("conversation_messages")
    .select("id, sender_id, sender_role, body, read_at, created_at, profiles ( name )")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) return null;

  const peerName =
    role === "customer"
      ? (await restaurantName(thread.restaurantId)) ?? "Équipe RestoLink"
      : (await profileName(thread.customerId)) ?? "Client";

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

  const isCustomer = thread.customerId === profile.id;
  const isStaff = thread.restaurantId ? await isActiveStaff(profile.id, thread.restaurantId) : profile.role === "admin" && !thread.restaurantId;
  if (!isCustomer && !isStaff) return { ok: false, error: "Vous ne participez pas à cette conversation." };

  // My side's messages become read; my counter zeroes.
  await supabase
    .from("conversation_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .neq("sender_id", profile.id)
    .is("read_at", null);

  const patch = isCustomer ? { customer_unread: 0 } : { staff_unread: 0 };
  await supabase.from("conversations").update(patch).eq("id", conversationId);

  return { ok: true };
}

export async function closeConversation(conversationId: string): Promise<ActionResult> {
  const profile = await requireUser();
  const supabase = createAdminClient();
  const thread = await loadThread(conversationId);
  if (!thread) return { ok: false, error: "Conversation introuvable." };

  const isCustomer = thread.customerId === profile.id;
  const isStaff = thread.restaurantId ? await isActiveStaff(profile.id, thread.restaurantId) : profile.role === "admin" && !thread.restaurantId;
  if (!isCustomer && !isStaff) return { ok: false, error: "Vous ne participez pas à cette conversation." };

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
