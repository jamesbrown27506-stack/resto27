import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import { contextFromSubject, contextSubject, type ChatContextKind, type ChatContextRef } from "@/lib/chat/context";

/**
 * Server reads behind the "contact" buttons — who may open a thread with
 * whom, about what, and which thread to reuse.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  PLAIN SERVER MODULE, NOT "use server".
 *
 *  Everything here takes ids as trusted input: the relationship check answers
 *  "has customer X ever ordered at branch Y?" for any X and Y it is handed.
 *  Exported from a "use server" file, that would be a public endpoint that
 *  lets anyone probe who eats where. chat-actions.ts resolves the caller from
 *  the session first and only then asks these questions.
 * ─────────────────────────────────────────────────────────────────────────
 */

/**
 * 0061 not applied yet. Both shapes — 42703 on reads, PGRST204 on writes —
 * see lib/data/missing-column.test.ts for why one code is not enough.
 */
export function isMissingContextColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const known = error.code === "42703" || error.code === "PGRST204";
  const message = error.message ?? "";
  return known && (message.includes("order_id") || message.includes("reservation_id"));
}

/** An order or reservation, with the two parties it links. */
export interface ContextRow {
  kind: ChatContextKind;
  id: string;
  reference: string;
  restaurantId: string;
  customerId: string | null;
}

export async function fetchContextRow(kind: ChatContextKind, id: string): Promise<ContextRow | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from(kind === "order" ? "orders" : "reservations")
    .select("id, reference, restaurant_id, customer_id")
    .eq("id", id)
    .maybeSingle();
  const row = data as { id: string; reference: string; restaurant_id: string; customer_id: string | null } | null;
  if (!row) return null;
  return {
    kind,
    id: row.id,
    reference: row.reference,
    restaurantId: row.restaurant_id,
    customerId: row.customer_id,
  };
}

/**
 * THE RELATIONSHIP RULE — may this branch write to this customer first?
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  A RESTAURANT MAY ONLY OPEN A THREAD WITH SOMEONE WHO CAME TO IT.
 *
 *  A customer may write to any restaurant in the app. The reverse is not
 *  symmetrical on purpose: without a rule, every tenant could page through
 *  the whole customer base and message it — a marketing channel nobody
 *  opted into, delivered with a push notification. So a branch may start a
 *  conversation only with a customer linked to THAT branch by at least one
 *  order (any status — a cancelled order is still a customer with a question)
 *  or one reservation.
 *
 *  Table service (dining_sessions) counts through its order: guests at a
 *  table are anonymous tokens, and the only profile a dining session can
 *  name is the customer on the order it produced — which the order probe
 *  already finds.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function hasCustomerRelationship(restaurantId: string, customerId: string): Promise<boolean> {
  const supabase = createAdminClient();
  const [orders, reservations] = await Promise.all([
    supabase
      .from("orders")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .eq("customer_id", customerId)
      .limit(1),
    supabase
      .from("reservations")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .eq("customer_id", customerId)
      .limit(1),
  ]);
  return (orders.data?.length ?? 0) > 0 || (reservations.data?.length ?? 0) > 0;
}

/**
 * The customer to show the "Écrire au client" button for, or null for a
 * guest / table order with no account behind it. Scoped by branch, so an id
 * pasted from another tenant answers null.
 */
export async function fetchOrderCustomerId(restaurantId: string, orderId: string): Promise<string | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("orders")
    .select("customer_id")
    .eq("restaurant_id", restaurantId)
    .eq("id", orderId)
    .maybeSingle();
  return (data as { customer_id: string | null } | null)?.customer_id ?? null;
}

/**
 * The open thread between this pair about this context, if there is one.
 *
 *  · with a context — the thread about exactly that order / reservation, so
 *    "Commande CMD-1" and "Commande CMD-2" stay two conversations with two
 *    chips instead of one thread whose header lies about half of it;
 *  · without — the most recent open thread with that restaurant, whatever it
 *    is about: "Contacter" on the restaurant page continues the conversation
 *    already in progress rather than starting a parallel one.
 *
 * Before 0061 the context lives in the subject, so that is what is matched.
 */
export async function findOpenPairThread(input: {
  customerId: string;
  restaurantId: string;
  context: ContextRow | null;
}): Promise<string | null> {
  const supabase = createAdminClient();
  const base = () =>
    supabase
      .from("conversations")
      .select("id")
      .eq("customer_id", input.customerId)
      .eq("restaurant_id", input.restaurantId)
      .eq("status", "open")
      .order("last_message_at", { ascending: false })
      .limit(1);

  if (!input.context) {
    const { data } = await base().maybeSingle();
    return (data as { id: string } | null)?.id ?? null;
  }

  const column = input.context.kind === "order" ? "order_id" : "reservation_id";
  const { data, error } = await base().eq(column, input.context.id).maybeSingle();
  if (!error) {
    if (data) return (data as { id: string }).id;
    // A thread opened before 0061 ran carries the reference in its subject
    // only; it is still the same conversation.
  } else if (!isMissingContextColumn(error)) {
    console.error("[chat:findPair]", error.message);
    return null;
  }

  const { data: bySubject } = await base()
    .eq("subject", contextSubject(input.context))
    .maybeSingle();
  return (bySubject as { id: string } | null)?.id ?? null;
}

/**
 * Create the thread, empty. The first message is posted by whoever tapped the
 * button, through the ordinary sendMessage path — which is what notifies the
 * other side, so no notification fires for a thread nobody wrote in.
 */
export async function createPairThread(input: {
  customerId: string;
  restaurantId: string;
  context: ContextRow | null;
}): Promise<{ id: string } | { error: { code?: string; message?: string } | null }> {
  const supabase = createAdminClient();
  const subject = input.context ? contextSubject(input.context) : "";
  const row: Record<string, unknown> = {
    customer_id: input.customerId,
    restaurant_id: input.restaurantId,
    subject,
  };
  if (input.context?.kind === "order") row.order_id = input.context.id;
  if (input.context?.kind === "reservation") row.reservation_id = input.context.id;

  let { data, error } = await supabase.from("conversations").insert(row).select("id").single();
  if (error && isMissingContextColumn(error)) {
    // Pre-0061: the subject already carries the reference.
    delete row.order_id;
    delete row.reservation_id;
    ({ data, error } = await supabase.from("conversations").insert(row).select("id").single());
  }
  if (error || !data) return { error };
  return { id: (data as { id: string }).id };
}

/**
 * The context of each thread, for the inbox and the thread header. One pass:
 * the id columns (when 0061 ran), then one lookup per kind for references,
 * then the subject fallback for whatever is left.
 */
export async function resolveThreadContexts(
  threads: { id: string; subject: string; orderId?: string | null; reservationId?: string | null }[],
): Promise<Map<string, ChatContextRef>> {
  const out = new Map<string, ChatContextRef>();
  const orderIds = [...new Set(threads.map((t) => t.orderId).filter((v): v is string => Boolean(v)))];
  const reservationIds = [
    ...new Set(threads.map((t) => t.reservationId).filter((v): v is string => Boolean(v))),
  ];

  const supabase = createAdminClient();
  const [orders, reservations] = await Promise.all([
    orderIds.length
      ? supabase.from("orders").select("id, reference").in("id", orderIds)
      : Promise.resolve({ data: [] as { id: string; reference: string }[] }),
    reservationIds.length
      ? supabase.from("reservations").select("id, reference").in("id", reservationIds)
      : Promise.resolve({ data: [] as { id: string; reference: string }[] }),
  ]);
  const orderRef = new Map(((orders.data ?? []) as { id: string; reference: string }[]).map((r) => [r.id, r.reference]));
  const reservationRef = new Map(
    ((reservations.data ?? []) as { id: string; reference: string }[]).map((r) => [r.id, r.reference]),
  );

  for (const thread of threads) {
    if (thread.orderId && orderRef.has(thread.orderId)) {
      out.set(thread.id, { kind: "order", id: thread.orderId, reference: orderRef.get(thread.orderId)! });
      continue;
    }
    if (thread.reservationId && reservationRef.has(thread.reservationId)) {
      out.set(thread.id, {
        kind: "reservation",
        id: thread.reservationId,
        reference: reservationRef.get(thread.reservationId)!,
      });
      continue;
    }
    const fromSubject = contextFromSubject(thread.subject);
    if (fromSubject) out.set(thread.id, fromSubject);
  }
  return out;
}
