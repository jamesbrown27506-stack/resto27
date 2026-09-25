/**
 * What a conversation is ABOUT — an order, a reservation, or nothing in
 * particular. Pure rules, no Supabase: chat-actions.ts ("use server") and the
 * chat context module (server-only) both lean on these, and neither is
 * pleasant to import into a test.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  TWO STORAGE SHAPES, ONE READING.
 *
 *  Migration 0061 gives conversations real `order_id` / `reservation_id`
 *  columns. Production may lag the migrations (see CLAUDE.md), so until it
 *  runs the reference rides in the thread SUBJECT instead — "Commande
 *  CMD-4F2A91". The subject is written in French on purpose: it is stored
 *  data seen by both sides, like every other server-written string for
 *  customers and managers.
 *
 *  Reading therefore has two sources. A real column wins (it can be linked);
 *  the subject is the fallback (it can only be shown). Both produce the same
 *  `ChatContextRef`, so the screens never learn which one they got.
 * ─────────────────────────────────────────────────────────────────────────
 */

export type ChatContextKind = "order" | "reservation";

export interface ChatContextRef {
  kind: ChatContextKind;
  /** The row id — null when only the subject survived (pre-0061). */
  id: string | null;
  /** CMD-XXXXXX / RES-XXXX, as printed on tickets and in notifications. */
  reference: string;
}

const SUBJECT_PREFIX: Record<ChatContextKind, string> = {
  order: "Commande",
  reservation: "Réservation",
};

/** The subject stored on a thread opened from an order or a reservation. */
export function contextSubject(ref: { kind: ChatContextKind; reference: string }): string {
  return `${SUBJECT_PREFIX[ref.kind]} ${ref.reference}`;
}

/**
 * Recover the context from a subject written by contextSubject(). Anything
 * else — a customer's own free-text subject — is not a context, even when it
 * happens to mention a reference: "Problème avec CMD-1234 et CMD-5678" names
 * two orders and links neither.
 */
export function contextFromSubject(subject: string | null | undefined): ChatContextRef | null {
  const match = /^(Commande|Réservation) ((?:CMD|RES)-[A-Z0-9]+)$/.exec((subject ?? "").trim());
  if (!match) return null;
  const kind: ChatContextKind = match[1] === "Commande" ? "order" : "reservation";
  // A "Commande RES-…" is not something we ever wrote; refuse to guess.
  if ((kind === "order") !== match[2]!.startsWith("CMD-")) return null;
  return { kind, id: null, reference: match[2]! };
}

/**
 * Where the context chip links to, per side. The customer's order has its own
 * page; a reservation lives in the list of bookings on both sides. A context
 * that survived only in the subject has no id and so no order link.
 */
export function contextHref(ref: ChatContextRef, side: "customer" | "staff"): string | null {
  if (ref.kind === "order") {
    if (!ref.id) return null;
    return side === "customer" ? `/orders/${ref.id}` : `/m/orders/${ref.id}`;
  }
  return side === "customer" ? "/reservations" : "/m/reservations";
}

/**
 * A thread nobody has written in yet.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  "CONTACTER" OPENS THE THREAD BEFORE ANYONE HAS SAID ANYTHING.
 *
 *  The contact buttons create (or reuse) the conversation and navigate into
 *  it, so the composer has somewhere to post. A person who then changes their
 *  mind leaves an empty row behind — and without this, that row would sit in
 *  the OTHER side's inbox as a conversation with no message in it, which
 *  reads as a bug or, worse, as the customer having written and the text
 *  having been lost.
 *
 *  An empty thread is therefore left out of every LIST. It stays reachable by
 *  id (the opener lands on ?c=<id>), it is reused by the next tap on the same
 *  button, and the first message makes it appear on both sides.
 *
 *  Detected without a counter: a new row takes `created_at` and
 *  `last_message_at` from the same now() default, so they are equal to the
 *  microsecond until a message moves `last_message_at`.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function isUntouchedThread(row: { created_at: string; last_message_at: string }): boolean {
  const created = Date.parse(row.created_at);
  const last = Date.parse(row.last_message_at);
  if (Number.isNaN(created) || Number.isNaN(last)) return false;
  return row.created_at === row.last_message_at || created === last;
}
