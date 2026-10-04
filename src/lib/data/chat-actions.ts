"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { getTranslator } from "@/lib/i18n/locale-server";
import { getCurrentProfile, requireUser } from "@/lib/auth/session";
import { notify } from "@/lib/notify";
import { rateLimit } from "@/lib/rate-limit";
import { getBranding } from "@/lib/branding";
import { getBranchContext } from "@/lib/auth/branch";
import { can, type Capability } from "@/lib/capabilities";
import {
  contextFromSubject,
  contextHref,
  isUntouchedThread,
  type ChatContextRef,
} from "@/lib/chat/context";
import {
  createPairThread,
  fetchContextRow,
  findOpenPairThread,
  hasCustomerRelationship,
  isMissingContextColumn,
  resolveThreadContexts,
  type ContextRow,
} from "@/lib/data/chat-context";

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
 *   · a manager may only open a PLATFORM thread through startConversation —
 *     they cannot write to another restaurant by passing its id;
 *   · a BRANCH may open a thread with a customer (openCustomerConversation),
 *     but only one linked to that branch by an order or a reservation, and
 *     the branch is the session's active one. The row is the same
 *     customer↔restaurant thread a customer would have opened — customer_id
 *     is the customer, restaurant_id the branch — so RLS, unread counters and
 *     notifications need no new case: staff are the "staff" side, and their
 *     first message reaches the customer as a chat_reply.
 *
 *  RATE LIMITED — a conversation that can be abused is a spam engine with
 *  a mail relay attached (each message notifies + emails the other side).
 * ─────────────────────────────────────────────────────────────────────────
 */

const MAX_BODY = 2000;
const MAX_SUBJECT = 120;

/** The migration that creates conversations + conversation_messages. */
const CHAT_MIGRATION = "0019_chat.sql";

/**
 * Turn a database error into something the person reading it can act on.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  "IMPOSSIBLE D'OUVRIR LA CONVERSATION" WAS TRUE AND USELESS.
 *
 *  Every failure in here — a missing table, a constraint, a dropped
 *  connection — came out as the same sentence, with the real reason logged to
 *  a server console the person hitting the button cannot see. The single most
 *  likely cause on a fresh or partially-migrated database is that the chat
 *  tables do not exist at all: PostgREST answers that with PGRST205 ("Could
 *  not find the table 'public.conversations' in the schema cache"), which is
 *  perfectly diagnostic and was being thrown away.
 *
 *  So that one case now names itself and names the file to run. Everything
 *  else keeps the generic sentence — a constraint violation is not something
 *  to paste at a customer.
 * ─────────────────────────────────────────────────────────────────────────
 */
function schemaMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  // PGRST205 = unknown table; 42P01 = undefined_table straight from Postgres.
  if (error.code === "PGRST205" || error.code === "42P01") return true;
  return /schema cache|does not exist/i.test(error.message ?? "");
}

function chatError(
  error: { code?: string; message?: string } | null | undefined,
  fallback: string,
  t: Awaited<ReturnType<typeof getTranslator>>,
): string {
  if (schemaMissing(error)) {
    return t("ecu.chatMigrationMissing", { migration: CHAT_MIGRATION });
  }
  return fallback;
}

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
  /** The order / reservation the thread is about (0061, or the subject). */
  context: ChatContextRef | null;
}

/** A thread's context as the viewer sees it — with a link for THEIR side. */
export type ChatThreadContext = ChatContextRef & { href: string | null };

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
  /** "Commande CMD-XXXX" / "Réservation RES-XXXX", linked when possible. */
  context: ChatThreadContext | null;
  messages: ChatMessage[];
}

type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * The contact buttons' result. `reason` is the stable machine code the button
 * maps to a dictionary string (the customer-facing convention, see CLAUDE.md);
 * `error` is the French fallback.
 */
export type OpenChatReason =
  | "auth"
  | "role"
  | "rate_limited"
  | "unreachable"
  | "not_found"
  | "forbidden"
  | "no_customer"
  | "no_relationship"
  | "failed";

export type OpenChatResult =
  | { ok: true; conversationId: string; href: string }
  | { ok: false; reason: OpenChatReason; error: string };

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
  orderId: string | null;
  reservationId: string | null;
} | null> {
  const supabase = createAdminClient();
  const BASE = "id, subject, status, customer_id, restaurant_id";
  const first = await supabase
    .from("conversations")
    .select(`${BASE}, order_id, reservation_id`)
    .eq("id", conversationId)
    .maybeSingle();
  let data: unknown = first.data;
  if (first.error && isMissingContextColumn(first.error)) {
    // Pre-0061: no context columns; the subject still carries the reference.
    data = (await supabase.from("conversations").select(BASE).eq("id", conversationId).maybeSingle()).data;
  }
  const row = data as {
    id: string;
    subject: string;
    status: string;
    customer_id: string;
    restaurant_id: string | null;
    order_id?: string | null;
    reservation_id?: string | null;
  } | null;
  return row
    ? {
        id: row.id,
        subject: row.subject,
        status: row.status,
        customerId: row.customer_id,
        restaurantId: row.restaurant_id,
        orderId: row.order_id ?? null,
        reservationId: row.reservation_id ?? null,
      }
    : null;
}

async function isActiveStaff(profileId: string, restaurantId: string): Promise<boolean> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("restaurant_staff")
    .select("id, restaurants!inner ( status )")
    .eq("restaurant_id", restaurantId)
    .eq("profile_id", profileId)
    .eq("status", "active")
    // A paused branch (0072) still has orders in flight and customers who
    // ordered there — its team keeps the badges and the conversations.
    .in("restaurants.status", ["active", "paused"])
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

/**
 * "The staff side" of a thread — a restaurant's staff, or every admin.
 *
 * The conversation id rides as `reference`: the copy ignores it, but it is
 * what keys the push collapse tag, so two customers writing at once are two
 * banners instead of the second silently replacing the first. The sender's
 * name makes the banner answerable without opening it ("Nouveau message de
 * Ama", not "de un client"), and the `?c=` deep link opens THAT thread
 * rather than the inbox list.
 */
async function notifyStaffSide(
  thread: { id: string; restaurantId: string | null },
  preview: string,
  senderName: string,
) {
  if (thread.restaurantId) {
    await notify({
      event: "chat",
      tone: "info",
      restaurantId: thread.restaurantId,
      href: `/m/messages?c=${thread.id}`,
      params: { preview, customerName: senderName, reference: thread.id },
    });
  } else {
    await notify({
      event: "chat",
      tone: "info",
      admins: true,
      href: `/a/messages?c=${thread.id}`,
      params: { preview, customerName: senderName, reference: thread.id },
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
  const t = await getTranslator();
  const initiator = await requireUser();
  // Admins answer threads, they do not open them — there is no "the platform
  // wrote to itself" inbox for the reply to land in.
  if (initiator.role !== "customer" && initiator.role !== "manager") {
    return { ok: false, error: t("ecu.chatRoleNotAllowed") };
  }

  const limited = await rateLimit({ key: "chat:start", limit: 5, windowMs: 60 * 60 * 1000, identifier: initiator.id });
  if (!limited.ok) return { ok: false, error: t("ecu.chatTooManyThreads") };

  const body = cleanBody(input.body);
  const subject = String(input.subject ?? "").trim().slice(0, MAX_SUBJECT);
  if (body.length < 1) return { ok: false, error: t("ecu.chatEmpty") };

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
    if (!restaurant) return { ok: false, error: t("ecu.chatUnreachable") };
  }

  const { data: conversation, error } = await supabase
    .from("conversations")
    .insert({ customer_id: initiator.id, restaurant_id: restaurantId, subject })
    .select("id")
    .single();

  if (error || !conversation) {
    console.error("[chat:start]", error?.message);
    return { ok: false, error: chatError(error, t("ecu.chatOpenFailed"), t) };
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
    return { ok: false, error: chatError(messageError, t("ecu.chatSendFailed"), t) };
  }

  // The first message IS the unread signal for the other side.
  await supabase
    .from("conversations")
    .update({ staff_unread: 1, last_message_at: new Date().toISOString() })
    .eq("id", conversation.id);

  await notifyStaffSide({ id: conversation.id, restaurantId }, body.slice(0, 80), initiator.name);

  return { ok: true, conversationId: conversation.id };
}

/* ── Contact buttons: open (or reuse) a thread, then navigate into it ──── */

/**
 * Open or reuse the pair's thread. Shared tail of both contact actions: the
 * caller has already proved who it is and that it may talk to this pair.
 */
async function openPairThread(input: {
  customerId: string;
  restaurantId: string;
  context: ContextRow | null;
}): Promise<{ id: string } | { error: string }> {
  const t = await getTranslator();
  const existing = await findOpenPairThread(input);
  if (existing) return { id: existing };

  const created = await createPairThread(input);
  if ("id" in created) return created;
  console.error("[chat:open]", created.error?.message);
  return { error: chatError(created.error, t("ecu.chatOpenFailed"), t) };
}

/**
 * CUSTOMER → RESTAURANT. Any active restaurant, from its public page, an
 * order or a reservation.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE CHAT IS THE ONLY LINE BETWEEN THE TWO SIDES.
 *
 *  Phone numbers and WhatsApp links are deliberately not shown between
 *  customers and restaurants: an order negotiated off-platform is an order
 *  the platform cannot protect, refund or count. That only holds if reaching
 *  the restaurant in-app is at least as easy as dialling it — one tap, from
 *  wherever the question arises, landing in a thread that already says which
 *  order it is about. Hence no compose form in between: this opens the thread
 *  and the composer is right there.
 *
 *  An order / reservation passed in must be the CALLER'S and at THIS
 *  restaurant, or the chip would let a customer attach someone else's order
 *  reference to a conversation.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function openRestaurantConversation(input: {
  restaurantId: string;
  orderId?: string | null;
  reservationId?: string | null;
}): Promise<OpenChatResult> {
  const t = await getTranslator();
  // getActiveProfile semantics without the redirect: an anonymous visitor on
  // a public restaurant page gets a reason code the button turns into a
  // sign-in round trip, not a thrown redirect inside a click handler.
  const profile = await getCurrentProfile();
  if (!profile || profile.deletedAt || profile.status !== "active") {
    return { ok: false, reason: "auth", error: t("ecu.chatSignIn") };
  }
  if (profile.role !== "customer") {
    // A restaurant's inbox lists its platform thread only (listMyConversations)
    // — a thread opened here by a manager account would exist nowhere they
    // could read it.
    return { ok: false, reason: "role", error: t("ecu.chatCustomersOnly") };
  }

  const limited = await rateLimit({ key: "chat:open", limit: 20, windowMs: 60 * 60 * 1000, identifier: profile.id });
  if (!limited.ok) {
    return { ok: false, reason: "rate_limited", error: t("ecu.chatTooManyThreads") };
  }

  const restaurantId = String(input.restaurantId ?? "").trim();
  if (!restaurantId) return { ok: false, reason: "unreachable", error: t("ecu.chatUnreachable") };

  const supabase = createAdminClient();
  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("id")
    .eq("id", restaurantId)
    .eq("status", "active")
    .maybeSingle();
  if (!restaurant) return { ok: false, reason: "unreachable", error: t("ecu.chatUnreachable") };

  let context: ContextRow | null = null;
  const orderId = input.orderId?.trim() || null;
  const reservationId = orderId ? null : input.reservationId?.trim() || null;
  if (orderId || reservationId) {
    context = await fetchContextRow(orderId ? "order" : "reservation", (orderId ?? reservationId)!);
    if (!context || context.customerId !== profile.id || context.restaurantId !== restaurantId) {
      return { ok: false, reason: "not_found", error: t("ecu.chatContextNotFound") };
    }
  }

  const opened = await openPairThread({ customerId: profile.id, restaurantId, context });
  if ("error" in opened) return { ok: false, reason: "failed", error: opened.error };
  return { ok: true, conversationId: opened.id, href: `/messages?c=${opened.id}` };
}

/**
 * RESTAURANT → CUSTOMER. Only a customer linked to the ACTIVE branch by an
 * order or a reservation (see hasCustomerRelationship for why), and only for
 * staff who can already see that link.
 *
 * The branch comes from the session (getBranchContext), never from the call:
 * a waiter at two branches writes as the branch they are working, and nobody
 * can open a thread inside another tenant's inbox by posting its id.
 *
 * `customerId` may be omitted when an order / reservation is given — the
 * customer is read from that row, which is also what proves the link. When
 * both are given they must agree.
 *
 * The capability is the one that already shows the staff member the thing
 * they are writing about: orders.view for an order, reservations.view for a
 * booking, customers.view for a bare "write to this customer". No new
 * capability — the matrix is not this feature's to change.
 */
export async function openCustomerConversation(input: {
  customerId?: string | null;
  orderId?: string | null;
  reservationId?: string | null;
}): Promise<OpenChatResult> {
  const t = await getTranslator();
  const branch = await getBranchContext();
  if (!branch) return { ok: false, reason: "auth", error: t("ecu.chatSessionExpired") };
  if (branch.impersonating) {
    // The admin is not on the restaurant's staff roster, so participationIn()
    // would refuse them the thread they just created — and a platform admin
    // writing to a diner under a restaurant's name is not something to allow
    // by accident anyway.
    return { ok: false, reason: "forbidden", error: t("ecu.chatImpersonating") };
  }

  const restaurantId = branch.active.restaurantId;
  const orderId = input.orderId?.trim() || null;
  const reservationId = orderId ? null : input.reservationId?.trim() || null;
  const capability: Capability = orderId ? "orders.view" : reservationId ? "reservations.view" : "customers.view";
  if (!can(branch.active.role, capability)) {
    return { ok: false, reason: "forbidden", error: t("ecu.chatRoleCannotWrite") };
  }

  const limited = await rateLimit({ key: "chat:open", limit: 30, windowMs: 60 * 60 * 1000, identifier: branch.profile.id });
  if (!limited.ok) {
    return { ok: false, reason: "rate_limited", error: t("ecu.chatTooManyThreads") };
  }

  let context: ContextRow | null = null;
  let customerId = input.customerId?.trim() || null;
  if (orderId || reservationId) {
    context = await fetchContextRow(orderId ? "order" : "reservation", (orderId ?? reservationId)!);
    // Another branch's order answers exactly like a missing one.
    if (!context || context.restaurantId !== restaurantId) {
      return { ok: false, reason: "not_found", error: t("ecu.chatContextNotFound") };
    }
    if (!context.customerId) {
      return { ok: false, reason: "no_customer", error: t("ecu.chatNoAccount") };
    }
    if (customerId && customerId !== context.customerId) {
      return { ok: false, reason: "not_found", error: t("ecu.chatContextNotFound") };
    }
    customerId = context.customerId;
  } else {
    if (!customerId) {
      return { ok: false, reason: "no_customer", error: t("ecu.chatCustomerNotFound") };
    }
    if (!(await hasCustomerRelationship(restaurantId, customerId))) {
      return {
        ok: false,
        reason: "no_relationship",
        error: t("ecu.chatOnlyOwnCustomers"),
      };
    }
  }

  // Writing to yourself would make you the initiator of your own staff
  // thread, and participationIn() would file every reply on the wrong side.
  if (customerId === branch.profile.id) {
    return { ok: false, reason: "forbidden", error: t("ecu.chatNotYourself") };
  }

  // The customer must still be someone who can read the reply.
  const supabase = createAdminClient();
  const { data: customer } = await supabase
    .from("profiles")
    .select("id, status, deleted_at")
    .eq("id", customerId)
    .maybeSingle();
  const c = customer as { id: string; status: string; deleted_at: string | null } | null;
  if (!c || c.deleted_at || c.status !== "active") {
    return { ok: false, reason: "no_customer", error: t("ecu.chatCustomerInactive") };
  }

  const opened = await openPairThread({ customerId, restaurantId, context });
  if ("error" in opened) return { ok: false, reason: "failed", error: opened.error };
  return { ok: true, conversationId: opened.id, href: `/m/messages?c=${opened.id}` };
}

/* ── Any participant: send a message ───────────────────────────────────── */

export async function sendMessage(input: {
  conversationId: string;
  body: string;
}): Promise<ActionResult> {
  const t = await getTranslator();
  const profile = await requireUser();

  const limited = await rateLimit({ key: "chat:send", limit: 15, windowMs: 60_000, identifier: profile.id });
  if (!limited.ok) return { ok: false, error: t("ecu.chatTooManyMessages") };

  const body = cleanBody(input.body);
  if (body.length < 1) return { ok: false, error: t("ecu.chatEmpty") };

  const supabase = createAdminClient();
  const thread = await loadThread(input.conversationId);
  if (!thread) return { ok: false, error: t("ecu.chatNotFound") };

  // ── Who is the caller in this thread? ────────────────────────────────
  const part = await participationIn(thread, profile);
  if (!part) return { ok: false, error: t("ecu.chatNotParticipant") };
  if (thread.status === "closed") return { ok: false, error: t("ecu.chatClosed") };

  const { error } = await supabase.from("conversation_messages").insert({
    conversation_id: thread.id,
    sender_id: profile.id,
    sender_role: part.senderRole,
    body,
  });
  if (error) {
    console.error("[chat:send]", error.message);
    return { ok: false, error: chatError(error, t("ecu.chatSendFailed"), t) };
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
    await notifyStaffSide(thread, preview, profile.name);
  } else {
    const initiatorRole = await roleOf(thread.customerId);
    /*
      The reply is signed by whoever actually answered: the restaurant by
      its name on a restaurant thread, the platform by its own on a
      platform thread. "Réponse de Resto237" from Chez Pauline read as a
      glitch at the exact moment the feature was proving itself.
    */
    let restaurantName: string | undefined;
    if (thread.restaurantId) {
      const { data: restaurant } = await supabase
        .from("restaurants")
        .select("name")
        .eq("id", thread.restaurantId)
        .maybeSingle();
      restaurantName = (restaurant as { name?: string } | null)?.name ?? undefined;
    }
    /*
      /m/messages only for a RESTAURANT'S OWN platform thread. A restaurant
      thread's customer side is always the customer inbox — even when that
      customer happens to hold a manager account elsewhere and a branch wrote
      to them first (openCustomerConversation): /m/messages lists their
      platform threads only, and the banner would open onto nothing.
    */
    const toBackOffice = !thread.restaurantId && initiatorRole === "manager";
    await notify({
      event: "chat_reply",
      tone: "info",
      customerId: thread.customerId,
      href: `${toBackOffice ? "/m/messages" : "/messages"}?c=${thread.id}`,
      params: {
        preview,
        restaurantName,
        platformName: (await getBranding()).name,
        reference: thread.id,
      },
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

  const COMMON = "id, subject, status, restaurant_id, staff_unread, customer_unread, last_message_at, created_at";
  // Tried with the 0061 context columns first; a database that has not run
  // 0061 yet answers 42703 and gets the same list without them (the subject
  // still carries the reference — see lib/chat/context.ts).
  const run = (withContext: boolean) => {
    const cols = withContext ? `${COMMON}, order_id, reservation_id` : COMMON;
    let query;
    if (scope === "mine" || scope === "minePlatform") {
      query = supabase
        .from("conversations")
        .select(`${cols}, restaurants ( name )`)
        .eq("customer_id", scopeId);
      if (scope === "minePlatform") query = query.is("restaurant_id", null);
    } else if (scope === "staff") {
      query = supabase
        .from("conversations")
        .select(`${cols}, profiles!conversations_customer_id_fkey ( name, role )`)
        .eq("restaurant_id", scopeId);
    } else {
      query = supabase
        .from("conversations")
        .select(`${cols}, profiles!conversations_customer_id_fkey ( name, role )`)
        .is("restaurant_id", null);
    }
    return query.order("last_message_at", { ascending: false }).limit(50);
  };

  let { data, error } = await run(true);
  if (error && isMissingContextColumn(error)) ({ data, error } = await run(false));
  if (error) {
    console.error("[chat:list]", error.message);
    return [];
  }

  const rows = ((data ?? []) as unknown as {
    id: string;
    subject: string;
    status: "open" | "closed";
    restaurant_id: string | null;
    staff_unread: number;
    customer_unread: number;
    last_message_at: string;
    created_at: string;
    order_id?: string | null;
    reservation_id?: string | null;
    restaurants: { name: string } | null;
    profiles: { name: string; role: string } | null;
  }[])
    // A thread opened by a contact button and never written in is nobody's
    // conversation yet — see isUntouchedThread.
    .filter((row) => !isUntouchedThread(row));

  const [lastByThread, contexts] = await Promise.all([
    lastMessageOf(rows.map((r) => r.id)),
    resolveThreadContexts(
      rows.map((r) => ({
        id: r.id,
        subject: r.subject,
        orderId: r.order_id ?? null,
        reservationId: r.reservation_id ?? null,
      })),
    ),
  ]);
  const mine = scope === "mine" || scope === "minePlatform";
  // "The team" is whatever the platform is called in /a/settings — not the
  // default brand name frozen into a string literal. getBranding is
  // request-cached, so this costs nothing extra.
  const platform = (await getBranding()).name;

  return rows.map((row) => ({
    id: row.id,
    subject: row.subject,
    status: row.status,
    restaurantId: row.restaurant_id,
    peerName: mine
      ? (row.restaurants?.name ?? platform)
      : (row.profiles?.name ?? "Client"),
    peerRole: mine
      ? null
      : ((row.profiles?.role as ChatConversationSummary["peerRole"]) ?? "customer"),
    lastMessage: lastByThread.get(row.id)?.body ?? null,
    lastMessageAt: lastByThread.get(row.id)?.created_at ?? row.last_message_at,
    unread: mine ? row.customer_unread : row.staff_unread,
    context: contexts.get(row.id) ?? null,
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
      ? ((await restaurantName(thread.restaurantId)) ?? (await getBranding()).name)
      : ((await profileName(thread.customerId)) ?? "Client");

  // What the thread is about, linked for MY side: the customer's order page
  // or the back-office ticket for the same order.
  const contextRef =
    thread.orderId || thread.reservationId
      ? ((await resolveThreadContexts([thread])).get(thread.id) ?? null)
      : contextFromSubject(thread.subject);
  const context: ChatThreadContext | null = contextRef
    ? {
        ...contextRef,
        href: thread.restaurantId
          ? contextHref(contextRef, part.side === "initiator" ? "customer" : "staff")
          : null,
      }
    : null;

  return {
    id: thread.id,
    subject: thread.subject,
    status: thread.status as "open" | "closed",
    peerName,
    canPost: thread.status === "open",
    context,
    messages:((messages ?? []) as unknown as {
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
  const t = await getTranslator();
  const profile = await requireUser();
  const supabase = createAdminClient();
  const thread = await loadThread(conversationId);
  if (!thread) return { ok: false, error: t("ecu.chatNotFound") };

  const part = await participationIn(thread, profile);
  if (!part) return { ok: false, error: t("ecu.chatNotParticipant") };

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
  const t = await getTranslator();
  const profile = await requireUser();
  const supabase = createAdminClient();
  const thread = await loadThread(conversationId);
  if (!thread) return { ok: false, error: t("ecu.chatNotFound") };

  if (!(await participationIn(thread, profile))) {
    return { ok: false, error: t("ecu.chatNotParticipant") };
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
