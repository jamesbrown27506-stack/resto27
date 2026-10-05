"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/branch";
import { rateLimit } from "@/lib/rate-limit";
import { initiatePaymentAttempt, checkPaymentAttempt, settlePayment } from "@/lib/payments/collect";
import { normalisePhone } from "@/lib/payments/camerpay/client";
import { notify } from "@/lib/notify";
import { sendGuestDiningPush } from "@/lib/push";
import { diningFeatureAllowed } from "@/lib/dining/access";
import { billDue, type SplitMode } from "@/lib/dining/bill";
import type { PaymentInstruction } from "@/lib/payments/camerpay/notification";
import { getTranslator } from "@/lib/i18n/locale-server";
import { paymentErrorMessage } from "@/lib/payments/payment-error";
import { normaliseVoucherCode } from "@/lib/reservations/voucher";
import { voucherErrorKey } from "@/lib/reservations/voucher-errors";
import { isPushServiceEndpoint } from "@/lib/push-endpoint";

/*
  ─────────────────────────────────────────────────────────────────────────
   TABLE SERVICE V2 (0068) — A TABLE HOLDS MANY BILLS.

   A dining_session is one BILL. Scanning a table offers "Seul" (a bill
   nobody else can join) or "Avec d'autres" (a group bill with a 4-character
   code the friends type after scanning). Strangers at a big table therefore
   each get their own bill, and a waiter's order goes onto whichever bill he
   picks — never a separate ticket beside them.

   Guests can browse and send dishes BEFORE the waiter confirms them; the
   dishes wait. The waiter confirms presence once per bill, and anyone who
   joins a confirmed bill with its code is approved automatically.

   Payment is per part: online (everything, my dishes, equal split, an
   amount, optional tip — each with the gateway's payment fee) or the rest in
   cash, recorded by staff. The database (start_dining_payment,
   settle_dining_payment, record_dining_cash) is the only place amounts are
   decided; this file validates, authorises and notifies.

   GUEST-FACING ERRORS ARE TRANSLATED through getTranslator() (tbg./ons.
   keys); staff-facing ones use the est./ons. keys like the rest of the back
   office.
  ─────────────────────────────────────────────────────────────────────────
*/

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const tokenOk = (token: string) => /^[a-f0-9]{64}$/i.test(token);
const uuidOk = (value: string) => /^[0-9a-f-]{36}$/i.test(value);
const ACTIVE = ["awaiting_staff", "open", "payment_requested"] as const;
/** Online payments started this recently may still arrive (longest gateway window + 1 min). */
const IN_FLIGHT_MS = 16 * 60_000;

export type DiningAction = { ok: boolean; error?: string };

function one<T>(value: T | T[] | null | undefined): T | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

function functionMissing(error: { code?: string; message?: string } | null): boolean {
  return Boolean(error && (error.code === "42883" || error.code === "PGRST202"));
}

async function notifyDiningStaff(
  sessionId: string,
  kind: "access" | "order" | "message",
  guestName: string,
  preview?: string,
) {
  const db = createAdminClient();
  const { data } = await db
    .from("dining_sessions")
    .select("restaurant_id,restaurant_tables(number)")
    .eq("id", sessionId)
    .maybeSingle();
  const table = one(data?.restaurant_tables as unknown as { number?: string } | { number?: string }[] | null);
  if (!data?.restaurant_id) return;
  await notify({
    event: "table_service",
    tone: kind === "access" ? "warning" : "info",
    restaurantId: data.restaurant_id,
    href: `/m/table-order?session=${sessionId}`,
    params: { reference: table?.number ?? "—", customerName: guestName, tableServiceKind: kind, preview },
  });
}

async function notifyTableGuest(
  guestId: string,
  copy: { fr: { title: string; body: string }; en: { title: string; body: string } },
  persist = true,
) {
  const db = createAdminClient();
  const { data } = await db.from("dining_guests")
    .select("locale,session_id,dining_sessions!inner(restaurant_tables(public_token))")
    .eq("id", guestId).maybeSingle();
  if (!data) return;
  const session = one(data.dining_sessions);
  const table = one(session?.restaurant_tables);
  const language = data.locale === "en" ? "en" : "fr";
  const message = copy[language];
  if (persist) {
    const { error } = await db.from("dining_messages").insert({
      session_id: data.session_id,
      guest_id: guestId,
      sender_kind: "system",
      kind: "message",
      body: message.body.slice(0, 500),
    });
    if (error) console.error("[dining:guest-message]", error.message);
  }
  if (table?.public_token) {
    await sendGuestDiningPush(guestId, {
      title: message.title,
      body: message.body,
      href: `/table/${table.public_token}`,
      tag: `resto237:table:${guestId}`,
      lang: language,
      tone: "info",
      icon: "/app-icon-192.png",
      badge: "/notification-badge.png",
    });
  }
}

async function notifySessionGuests(
  sessionId: string,
  copy: { fr: { title: string; body: string }; en: { title: string; body: string } },
) {
  const { data } = await createAdminClient().from("dining_guests")
    .select("id").eq("session_id", sessionId).in("status", ["approved", "expired"]);
  await Promise.allSettled((data ?? []).map((guest) => notifyTableGuest(guest.id, copy)));
}

async function enterpriseRestaurant(restaurantId: string): Promise<boolean> {
  const db = createAdminClient();
  const { data } = await db.from("subscription_state").select("plan_id,state").eq("restaurant_id", restaurantId).maybeSingle();
  if (!data?.plan_id || !["active", "grace"].includes(data.state)) return false;
  const { data: plan } = await db.from("subscription_plans").select("tier").eq("id", data.plan_id).maybeSingle();
  return diningFeatureAllowed(plan?.tier ?? "", data.state);
}

/* ══ GUEST SIDE ═══════════════════════════════════════════════════════════ */

export async function getTableLanding(tableToken: string) {
  if (!uuidOk(tableToken)) return null;
  const db = createAdminClient();
  const { data } = await db.from("restaurant_tables")
    .select("id,number,capacity,status,restaurant_id,restaurants(name,logo_url,status,is_accepting_orders)")
    .eq("public_token", tableToken).maybeSingle();
  const restaurant = one(data?.restaurants);
  if (!data || restaurant?.status !== "active" || !(await enterpriseRestaurant(data.restaurant_id))) return null;
  const [{ data: categories }, { data: items }, { data: feeSetting }, tips] = await Promise.all([
    db.from("menu_categories").select("id,name,sort_order").eq("restaurant_id", data.restaurant_id).eq("is_active", true).order("sort_order"),
    db.from("menu_items").select("id,category_id,name,description,price,image_url,is_available,track_stock,stock_quantity,sort_order").eq("restaurant_id", data.restaurant_id).order("sort_order"),
    db.from("settings").select("value").eq("key", "service_charge_percent").maybeSingle(),
    // Tolerated when 0068 has not run: tips simply stay off.
    db.from("restaurants").select("tips_enabled").eq("id", data.restaurant_id).maybeSingle(),
  ]);
  /*
    THIS RESTAURANT'S OPTIONS ONLY, read by its dish ids. These two reads
    used to have no filter at all: every option group and option on the
    platform came back and was filtered here — and once the platform passed
    PostgREST's row cap, this restaurant's sizes and sides were simply cut
    off the guest's menu. Every branch's copied menu made that sooner.
  */
  const dishIds = (items ?? []).map((x) => x.id);
  const { data: groups } = dishIds.length
    ? await db.from("menu_option_groups").select("id,menu_item_id,name,min_select,max_select,is_required,sort_order").in("menu_item_id", dishIds).order("sort_order")
    : { data: [] as { id: string; menu_item_id: string; name: string; min_select: number; max_select: number; is_required: boolean; sort_order: number }[] };
  const ownGroupIds = (groups ?? []).map((x) => x.id);
  const { data: options } = ownGroupIds.length
    ? await db.from("menu_options").select("id,group_id,name,price_delta,is_available,sort_order").in("group_id", ownGroupIds).order("sort_order")
    : { data: [] as { id: string; group_id: string; name: string; price_delta: number; is_available: boolean; sort_order: number }[] };
  // Customizable dishes (0069): the range, read on its own.
  const { data: pricing } = await db.from("menu_items").select("id,price_to_confirm,price_max").eq("restaurant_id", data.restaurant_id);
  const pricingById = new Map(((pricing ?? []) as { id: string; price_to_confirm: boolean | null; price_max: number | null }[]).map((p) => [p.id, p]));
  const pricedItems = (items ?? []).map((item) => ({
    ...item,
    price_to_confirm: Boolean(pricingById.get(item.id)?.price_to_confirm),
    price_max: pricingById.get(item.id)?.price_max ?? null,
  }));
  const itemIds = new Set((items ?? []).map((x) => x.id));
  const filteredGroups = (groups ?? []).filter((x) => itemIds.has(x.menu_item_id));
  const groupIds = new Set(filteredGroups.map((x) => x.id));
  return {
    table: { id: data.id, token: tableToken, number: data.number, capacity: data.capacity, status: data.status },
    restaurant,
    categories: categories ?? [],
    items: pricedItems,
    groups: filteredGroups,
    options: (options ?? []).filter((x) => groupIds.has(x.group_id)),
    serviceChargePercent: Number(feeSetting?.value ?? 0) || 0,
    tipsEnabled: Boolean((tips.data as { tips_enabled?: boolean } | null)?.tips_enabled),
  };
}

type JoinResult = { ok: boolean; error?: string; guestToken?: string; status?: string; code?: string | null };

/** "Seul" or "Avec d'autres": a new bill on this table, this device its first guest. */
export async function openTableBill(
  tableToken: string,
  displayName: string,
  kind: "solo" | "group",
  locale: "fr" | "en" = "fr",
): Promise<JoinResult> {
  const t = await getTranslator();
  if (!uuidOk(tableToken) || (kind !== "solo" && kind !== "group")) return { ok: false, error: t("tbg.err.tableUnavailable") };
  const limited = await rateLimit({ key: "dining:join", limit: 12, windowMs: 60 * 60_000 });
  if (!limited.ok) return { ok: false, error: t("tbg.err.tooManyJoin") };
  const name = displayName.trim().slice(0, 60);
  if (name.length < 2) return { ok: false, error: t("ons.err.nameRequired") };

  const raw = randomBytes(32).toString("hex");
  const db = createAdminClient();
  const { data, error } = await db.rpc("open_dining_bill", {
    p_table_token: tableToken, p_token_hash: hash(raw), p_display_name: name, p_kind: kind,
  });
  if (error) {
    console.error("[dining:open]", error.code ?? "", error.message);
    return { ok: false, error: t("tbg.err.tableUnavailable") };
  }
  const result = data as { status: string; sessionId: string; guestId: string; code: string | null };
  await db.from("dining_guests").update({ locale }).eq("id", result.guestId);
  await notifyDiningStaff(result.sessionId, "access", name,
    kind === "solo" ? "Nouvelle addition (seul)" : "Nouvelle addition de groupe");
  revalidatePath("/m/table-order");
  return { ok: true, guestToken: raw, status: result.status, code: result.code };
}

/** Join a friend's group bill on this table with its 4-character code. */
export async function joinTableBill(
  tableToken: string,
  code: string,
  displayName: string,
  locale: "fr" | "en" = "fr",
): Promise<JoinResult> {
  const t = await getTranslator();
  if (!uuidOk(tableToken)) return { ok: false, error: t("tbg.err.tableUnavailable") };
  // Tighter than opening: this is the one guest call that takes a guessable input.
  const limited = await rateLimit({ key: "dining:join-code", limit: 10, windowMs: 15 * 60_000 });
  if (!limited.ok) return { ok: false, error: t("tbg.err.tooManyJoin") };
  const name = displayName.trim().slice(0, 60);
  if (name.length < 2) return { ok: false, error: t("ons.err.nameRequired") };
  const cleanCode = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(cleanCode)) return { ok: false, error: t("ons.err.codeNotFound") };

  const raw = randomBytes(32).toString("hex");
  const db = createAdminClient();
  const { data, error } = await db.rpc("join_dining_bill", {
    p_table_token: tableToken, p_code: cleanCode, p_token_hash: hash(raw), p_display_name: name,
  });
  if (error) {
    if (!error.message.includes("code_not_found")) console.error("[dining:join-code]", error.code ?? "", error.message);
    return { ok: false, error: error.message.includes("code_not_found") ? t("ons.err.codeNotFound") : t("tbg.err.tableUnavailable") };
  }
  const result = data as { status: string; sessionId: string; guestId: string; code: string | null };
  await db.from("dining_guests").update({ locale }).eq("id", result.guestId);
  if (result.status === "pending") await notifyDiningStaff(result.sessionId, "access", name);
  revalidatePath("/m/table-order");
  return { ok: true, guestToken: raw, status: result.status, code: result.code };
}

async function guestContext(raw: string) {
  if (!tokenOk(raw)) return null;
  const { data, error } = await createAdminClient().from("dining_guests")
    .select("id,status,display_name,session_id,created_at,dining_sessions!inner(id,status,kind,join_code,label,presence_confirmed_at,deposit_credit,restaurant_id,table_id,order_id,closed_at,restaurant_tables(number,public_token),restaurants(name))")
    .eq("token_hash", hash(raw)).maybeSingle();
  if (error) console.error("[dining:guest-context]", error.code ?? "", error.message);
  return data;
}

type PaymentRow = {
  id: string; guest_id: string | null; method: string; split_mode: string;
  amount: number; tip: number; service_fee: number; status: string; created_at: string;
};

export async function getGuestDiningState(raw: string) {
  const ctx = await guestContext(raw);
  if (!ctx) return null;
  const session = one(ctx.dining_sessions);
  if (!session) return null;
  const db = createAdminClient();
  // Two literal selects (not a template) so the query types stay precise.
  const roundsQuery = (withRange: boolean) => withRange
    ? db.from("dining_rounds")
        .select("id,guest_id,status,subtotal,notes,created_at,dining_round_items(id,name,quantity,unit_price,options_label,status,rejection_reason,price_to_confirm,price_max)")
        .eq("session_id", session.id).order("created_at")
    : db.from("dining_rounds")
        .select("id,guest_id,status,subtotal,notes,created_at,dining_round_items(id,name,quantity,unit_price,options_label,status,rejection_reason)")
        .eq("session_id", session.id).order("created_at");
  const [roundsResult, { data: messages }, { data: order }, { data: guests }, { data: payments }, reviewed] = await Promise.all([
    roundsQuery(true),
    db.from("dining_messages").select("id,guest_id,sender_kind,kind,body,created_at")
      .eq("session_id", session.id).or(`guest_id.eq.${ctx.id},guest_id.is.null`)
      .order("created_at", { ascending: false }).limit(100),
    session.order_id
      ? db.from("orders").select("id,reference,status,subtotal,total,service_charge,tip_amount,discount_amount,is_paid,payment_method,order_items(name,quantity,unit_price,options_label)").eq("id", session.order_id).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from("dining_guests").select("id,display_name,status").eq("session_id", session.id).order("created_at"),
    db.from("dining_payments").select("id,guest_id,method,split_mode,amount,tip,service_fee,status,created_at")
      .eq("session_id", session.id).in("status", ["pending", "succeeded"]).order("created_at"),
    db.from("reviews").select("id").eq("dining_guest_id", ctx.id).maybeSingle(),
  ]);

  // 0069 missing: read the rounds without the range columns.
  type RoundItem = { id: string; name: string; quantity: number; unit_price: number; options_label: string | null; status: string; rejection_reason: string | null; price_to_confirm?: boolean | null; price_max?: number | null };
  type Round = { id: string; guest_id: string | null; status: string; subtotal: number; notes: string | null; created_at: string; dining_round_items: RoundItem[] };
  const rounds = (roundsResult.error ? (await roundsQuery(false)).data : roundsResult.data) as Round[] | null;
  const paymentRows = (payments ?? []) as PaymentRow[];
  const now = Date.now();
  const due = billDue(Number(order?.subtotal ?? 0), Number(session.deposit_credit ?? 0));
  const paid = paymentRows.filter((p) => p.status === "succeeded").reduce((sum, p) => sum + p.amount, 0);
  const inFlight = paymentRows
    .filter((p) => p.status === "pending" && now - Date.parse(p.created_at) < IN_FLIGHT_MS)
    .reduce((sum, p) => sum + p.amount, 0);
  type RoundRow = { id: string; guest_id: string | null; status: string; dining_round_items: { unit_price: number; quantity: number; status: string }[] };
  const myDishes = ((rounds ?? []) as RoundRow[])
    .filter((round) => round.guest_id === ctx.id)
    .flatMap((round) => round.dining_round_items)
    .filter((item) => item.status === "accepted")
    .reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
  const myPaidForMine = paymentRows
    .filter((p) => p.guest_id === ctx.id && p.split_mode === "mine" &&
      (p.status === "succeeded" || now - Date.parse(p.created_at) < IN_FLIGHT_MS))
    .reduce((sum, p) => sum + p.amount, 0);

  return {
    guest: { id: ctx.id, name: ctx.display_name, status: ctx.status },
    session: {
      id: session.id,
      status: session.status,
      kind: (session.kind ?? "group") as "solo" | "group",
      code: session.join_code as string | null,
      label: session.label as string | null,
      presenceConfirmed: Boolean(session.presence_confirmed_at),
      depositCredit: Number(session.deposit_credit ?? 0),
      closedAt: session.closed_at as string | null,
      tableNumber: one(session.restaurant_tables)?.number ?? null,
    },
    rounds: rounds ?? [],
    guests: guests ?? [],
    messages: (messages ?? []).reverse(),
    order: order ?? null,
    payments: paymentRows,
    bill: {
      due,
      paid,
      inFlight,
      remaining: Math.max(0, due - paid - inFlight),
      mine: Math.max(0, myDishes - myPaidForMine),
    },
    reviewed: Boolean(reviewed.data),
  };
}

export async function submitGuestRound(raw: string, input: { lines: { menuItemId: string; quantity: number; optionIds: string[] }[]; notes?: string }): Promise<DiningAction> {
  const t = await getTranslator();
  const limited = await rateLimit({ key: "dining:order", limit: 10, windowMs: 15 * 60_000, identifier: hash(raw).slice(0, 24) });
  if (!limited.ok) return { ok: false, error: t("tbg.err.waitOrder") };
  const { error } = await createAdminClient().rpc("submit_dining_round", {
    p_token_hash: hash(raw), p_lines: input.lines, p_notes: input.notes?.slice(0, 500) ?? null,
  });
  if (error) {
    console.error("[dining:round]", error.message);
    return {
      ok: false,
      error: error.message.includes("session_not_open")
        ? t("tbg.err.sessionClosed")
        : error.message.includes("guest_not_approved")
          ? t("tbg.err.accessInactive")
          : error.message.includes("item_unavailable")
            ? t("tbg.err.itemUnavailable")
            : t("tbg.err.roundFailed"),
    };
  }
  const ctx = await guestContext(raw);
  if (ctx) {
    await notifyDiningStaff(ctx.session_id, "order", ctx.display_name,
      ctx.status === "pending" ? "Commande en attente de confirmation de présence" : undefined);
  }
  revalidatePath("/m/table-order");
  return { ok: true };
}

const REQUESTS = {
  call_waiter: "Merci de venir à notre table.",
  water: "De l’eau, s’il vous plaît.",
  cutlery: "Des couverts, s’il vous plaît.",
  bill: "Nous aimerions l’addition.",
  missing_item: "Il manque un article.",
  allergy: "Nous avons besoin d’aide pour une allergie.",
  help: "Nous avons besoin d’aide.",
} as const;

export async function sendGuestDiningMessage(raw: string, kind: keyof typeof REQUESTS | "message", body?: string): Promise<DiningAction> {
  const t = await getTranslator();
  const ctx = await guestContext(raw);
  const session = one(ctx?.dining_sessions);
  // A guest not yet confirmed may still CALL the waiter — that is how they
  // get confirmed. Everything else waits for the confirmation too.
  const allowed = ctx && session && ["awaiting_staff", "open", "payment_requested"].includes(session.status) &&
    (ctx.status === "approved" || (ctx.status === "pending" && kind === "call_waiter"));
  if (!ctx || !allowed) return { ok: false, error: t("tbg.err.accessInactive") };
  const text = (kind === "message" ? body : REQUESTS[kind])?.trim().slice(0, 500);
  if (!text) return { ok: false, error: t("tbg.err.writeFirst") };
  const limited = await rateLimit({ key: "dining:message", limit: 12, windowMs: 5 * 60_000, identifier: ctx.id });
  if (!limited.ok) return { ok: false, error: t("tbg.err.waitRequest") };
  const { error } = await createAdminClient().from("dining_messages").insert({
    session_id: ctx.session_id, guest_id: ctx.id, sender_kind: "guest", kind, body: text,
  });
  if (error) return { ok: false, error: t("tbg.err.messageFailed") };
  await notifyDiningStaff(ctx.session_id, "message", ctx.display_name, text);
  revalidatePath("/m/table-order");
  return { ok: true };
}

/**
 * Pay part — or all — of the bill online.
 *
 * The share, tip and fee are recomputed by start_dining_payment under a lock
 * (the phone's preview is only a preview), the Mobile Money request is then
 * sent for exactly that total, and settlement goes through the same resolver
 * as every other payment (poll, webhook, reconciler).
 */
export async function startGuestPayment(
  raw: string,
  input: { mode: SplitMode; amount?: number; parts?: number; tip?: number; phone: string },
): Promise<DiningAction & { status?: "pending" | "succeeded"; attemptId?: string; instruction?: PaymentInstruction; total?: number }> {
  const t = await getTranslator();
  const ctx = await guestContext(raw);
  const session = one(ctx?.dining_sessions);
  if (!ctx || ctx.status !== "approved" || !session || !["open", "payment_requested"].includes(session.status)) {
    return { ok: false, error: t("tbg.err.visitInactive") };
  }
  if (!["all", "mine", "equal", "amount"].includes(input.mode)) return { ok: false, error: t("tbg.err.preparePayment") };
  const phone = normalisePhone(input.phone);
  if (!phone) return { ok: false, error: t("tbg.err.badPhone") };
  const limited = await rateLimit({ key: "dining:pay", identifier: ctx.id, limit: 6, windowMs: 10 * 60_000 });
  if (!limited.ok) return { ok: false, error: t("tbg.err.waitRequest") };

  const db = createAdminClient();
  const { data, error } = await db.rpc("start_dining_payment", {
    p_token_hash: hash(raw),
    p_mode: input.mode,
    p_amount: input.mode === "amount" ? Math.round(Number(input.amount) || 0) : null,
    p_parts: input.mode === "equal" ? Math.round(Number(input.parts) || 0) : null,
    p_tip: Math.max(0, Math.round(Number(input.tip) || 0)),
    p_phone: phone,
  });
  if (error) {
    const m = error.message ?? "";
    if (!/nothing_to_pay|payment_in_progress|nothing_mine|invalid_amount|invalid_parts|tip_too_large/.test(m)) {
      console.error("[dining:pay:start]", error.code ?? "", m);
    }
    return {
      ok: false,
      error: m.includes("nothing_to_pay") ? t("ons.err.nothingToPay")
        : m.includes("payment_in_progress") ? t("tbg.err.paymentActive")
          : m.includes("nothing_mine") ? t("ons.err.nothingMine")
            : m.includes("invalid_amount") ? t("ons.err.invalidAmount")
              : m.includes("invalid_parts") ? t("ons.err.invalidParts")
                : m.includes("tip_too_large") ? t("ons.err.tipTooLarge")
                  : t("tbg.err.preparePayment"),
    };
  }
  const quote = data as { paymentId: string; total: number; reference: string; restaurantId: string };

  const table = one(session.restaurant_tables);
  const initiated = await initiatePaymentAttempt({
    kind: "dining",
    restaurantId: quote.restaurantId,
    diningPaymentId: quote.paymentId,
    reference: quote.reference,
    phone,
    amount: quote.total,
    returnPath: table?.public_token ? `/table/${table.public_token}` : "/",
    customer: { name: ctx.display_name },
  });
  if (!initiated.ok || !initiated.attemptId) {
    await db.from("dining_payments").update({ status: "failed" }).eq("id", quote.paymentId).eq("status", "pending");
    return { ok: false, error: paymentErrorMessage(initiated, t, "tbg.err.paymentFailed") };
  }
  await db.from("dining_payments").update({ attempt_id: initiated.attemptId }).eq("id", quote.paymentId);

  if (initiated.status === "pending") {
    return { ok: true, status: "pending", attemptId: initiated.attemptId, instruction: initiated.instruction, total: quote.total };
  }
  const settled = await settlePayment(initiated.attemptId);
  revalidatePath("/m/table-order");
  return settled.ok
    ? { ok: true, status: "succeeded", total: quote.total }
    : { ok: false, error: paymentErrorMessage(settled, t, "tbg.err.paymentFailed") };
}

export async function checkGuestPayment(raw: string, attemptId: string) {
  const t = await getTranslator();
  const ctx = await guestContext(raw);
  if (!ctx || !uuidOk(attemptId)) return { ok: false as const, error: t("tbg.err.paymentNotFound") };
  const db = createAdminClient();
  const { data: attempt } = await db.from("payment_attempts").select("raw_response").eq("id", attemptId).maybeSingle();
  const paymentId = (attempt?.raw_response as { diningPaymentId?: string } | null)?.diningPaymentId;
  if (!paymentId) return { ok: false as const, error: t("tbg.err.paymentNotFound") };
  const { data: payment } = await db.from("dining_payments").select("id,session_id").eq("id", paymentId).maybeSingle();
  if (!payment || payment.session_id !== ctx.session_id) return { ok: false as const, error: t("tbg.err.paymentNotFound") };

  const result = await checkPaymentAttempt(attemptId);
  if (result.status === "failed") {
    // Frees the share at once for another try instead of waiting out the window.
    await db.from("dining_payments").update({ status: "failed" }).eq("id", paymentId).eq("status", "pending");
  }
  if (result.status === "succeeded") revalidatePath("/m/table-order");
  return {
    ok: result.ok,
    status: result.status,
    instruction: result.instruction,
    error: result.ok ? undefined : paymentErrorMessage(result, t, "tbg.err.paymentNotFound"),
  };
}

/**
 * Rate the visit — and, optionally, tell us about the platform itself.
 *
 * An anonymous table guest has no account, so the review carries their
 * display name and the visit's order, and is unique per guest device
 * (reviews_dining_guest_idx). Only someone who actually ate on this bill may
 * write one, up to 30 days after the visit.
 */
export async function submitVisitReview(
  raw: string,
  input: { rating: number; body?: string; platformRating?: number | null; platformBody?: string },
): Promise<DiningAction> {
  const t = await getTranslator();
  const ctx = await guestContext(raw);
  const session = one(ctx?.dining_sessions);
  if (!ctx || !session || !["approved", "expired"].includes(ctx.status) || !session.order_id) {
    return { ok: false, error: t("tbg.err.visitInactive") };
  }
  if (session.closed_at && Date.now() - Date.parse(session.closed_at) > 30 * 86_400_000) {
    return { ok: false, error: t("tbg.err.visitInactive") };
  }
  const rating = Math.round(Number(input.rating));
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { ok: false, error: t("ons.err.ratingRange") };
  const limited = await rateLimit({ key: "dining:review", identifier: ctx.id, limit: 4, windowMs: 60 * 60_000 });
  if (!limited.ok) return { ok: false, error: t("tbg.err.tryLater") };

  const db = createAdminClient();
  const { error } = await db.from("reviews").insert({
    restaurant_id: session.restaurant_id,
    customer_id: null,
    order_id: session.order_id,
    customer_name: ctx.display_name,
    rating,
    body: (input.body ?? "").trim().slice(0, 2000),
    dining_guest_id: ctx.id,
  });
  if (error) {
    if (error.code === "23505") return { ok: false, error: t("ons.err.alreadyReviewed") };
    console.error("[dining:review]", error.code ?? "", error.message);
    return { ok: false, error: t("ons.err.reviewFailed") };
  }

  const platformBody = (input.platformBody ?? "").trim();
  const platformRating = Number(input.platformRating);
  if (platformBody || (Number.isInteger(platformRating) && platformRating >= 1 && platformRating <= 5)) {
    const { error: feedbackError } = await db.from("platform_feedback").insert({
      source: "dining",
      rating: Number.isInteger(platformRating) && platformRating >= 1 && platformRating <= 5 ? platformRating : null,
      body: (platformBody || "—").slice(0, 2000),
      restaurant_id: session.restaurant_id,
      dining_guest_id: ctx.id,
    });
    if (feedbackError) console.error("[dining:platform-feedback]", feedbackError.message);
  }

  await notify({
    event: "review",
    tone: "info",
    restaurantId: session.restaurant_id,
    href: "/m/reviews",
    params: { rating, customerName: ctx.display_name, reference: session.order_id },
  });
  revalidatePath("/m/reviews");
  return { ok: true };
}

export async function saveGuestDiningPush(raw: string, input: { endpoint: string; p256dh: string; auth: string }): Promise<DiningAction> {
  const t = await getTranslator();
  const ctx = await guestContext(raw);
  const session = one(ctx?.dining_sessions);
  if (!ctx || !session || !["pending", "approved"].includes(ctx.status) || !(ACTIVE as readonly string[]).includes(session.status)) {
    return { ok: false, error: t("tbg.err.visitInactive") };
  }
  const endpoint = input.endpoint.trim();
  if (!isPushServiceEndpoint(endpoint) ||
      !/^[A-Za-z0-9_+/=-]{40,}$/.test(input.p256dh) ||
      !/^[A-Za-z0-9_+/=-]{8,}$/.test(input.auth)) {
    return { ok: false, error: t("tbg.err.badSubscription") };
  }
  const limited = await rateLimit({ key: "dining:push", identifier: ctx.id, limit: 10, windowMs: 60 * 60_000 });
  if (!limited.ok) return { ok: false, error: t("tbg.err.tryLater") };
  const { error } = await createAdminClient().from("dining_guest_push_subscriptions")
    .upsert({ guest_id: ctx.id, endpoint, p256dh: input.p256dh, auth: input.auth, updated_at: new Date().toISOString() }, { onConflict: "endpoint" });
  if (error) {
    console.error("[dining:guest-push]", error.message);
    return { ok: false, error: t("tbg.err.alertsFailed") };
  }
  return { ok: true };
}

export async function saveGuestDiningNativePush(raw: string, token: string, platform: "android" | "ios"): Promise<DiningAction> {
  const t = await getTranslator();
  const ctx = await guestContext(raw);
  const session = one(ctx?.dining_sessions);
  if (!ctx || !session || !["pending", "approved"].includes(ctx.status) || !(ACTIVE as readonly string[]).includes(session.status)) {
    return { ok: false, error: t("tbg.err.visitInactive") };
  }
  if (!["android", "ios"].includes(platform) || !/^[A-Za-z0-9_:.-]{20,4096}$/.test(token)) {
    return { ok: false, error: t("tbg.err.badSubscription") };
  }
  const limited = await rateLimit({ key: "dining:native-push", identifier: ctx.id, limit: 20, windowMs: 60 * 60_000 });
  if (!limited.ok) return { ok: false, error: t("tbg.err.tryLater") };
  const { error } = await createAdminClient().from("dining_guest_fcm_subscriptions").upsert({
    guest_id: ctx.id, token, platform, updated_at: new Date().toISOString(),
  }, { onConflict: "token" });
  if (error) {
    console.error("[dining:native-push]", error.message);
    return { ok: false, error: t("tbg.err.alertsFailed") };
  }
  return { ok: true };
}

/**
 * The guest leaves before the waiter confirmed them — scanned the wrong
 * table, or their friends already had a bill.
 *
 * Conditional on `status = 'pending'` (compare-and-swap): a waiter's decision
 * in the same instant stands. A bill this guest opened and nobody else is on
 * is withdrawn with them, so the floor is not left with an empty request.
 */
export async function withdrawTableAccess(raw: string): Promise<DiningAction> {
  const t = await getTranslator();
  if (!tokenOk(raw)) return { ok: false, error: t("tbg.err.cancelFailed") };
  const limited = await rateLimit({ key: "dining:withdraw", limit: 10, windowMs: 10 * 60_000, identifier: hash(raw).slice(0, 24) });
  if (!limited.ok) return { ok: false, error: t("tbg.err.tryLater") };
  const db = createAdminClient();
  const { data, error } = await db.from("dining_guests")
    .update({ status: "expired" })
    .eq("token_hash", hash(raw))
    .eq("status", "pending")
    .select("id, session_id, display_name")
    .maybeSingle();
  if (error || !data) {
    if (error) console.error("[dining:withdraw]", error.message);
    return { ok: false, error: t("tbg.err.cancelFailed") };
  }
  // Their unconfirmed dishes go with them.
  const { data: rounds } = await db.from("dining_rounds").select("id").eq("guest_id", data.id).eq("status", "pending");
  const roundIds = (rounds ?? []).map((r) => r.id as string);
  if (roundIds.length) {
    await db.from("dining_round_items").update({ status: "rejected", rejection_reason: "Demande retirée par le client" })
      .in("round_id", roundIds).eq("status", "pending");
    await db.from("dining_rounds").update({ status: "rejected" }).in("id", roundIds).eq("status", "pending");
  }
  const { count } = await db.from("dining_guests").select("id", { count: "exact", head: true })
    .eq("session_id", data.session_id).in("status", ["pending", "approved"]);
  if (!count) {
    await db.from("dining_sessions").update({ status: "cancelled", closed_at: new Date().toISOString() })
      .eq("id", data.session_id).eq("status", "awaiting_staff");
  }
  const { error: messageError } = await db.from("dining_messages").insert({
    session_id: data.session_id, guest_id: data.id, sender_kind: "system", kind: "message",
    body: `Demande d’accès retirée par ${String(data.display_name ?? "le client").slice(0, 60)}`,
  });
  if (messageError) console.error("[dining:withdraw-message]", messageError.message);
  revalidatePath("/m/table-order");
  return { ok: true };
}

/* ══ STAFF SIDE ═══════════════════════════════════════════════════════════ */

export async function getMyDiningNotifications(): Promise<boolean> {
  const { active, profile } = await requireCapability("orders.view");
  const { data } = await createAdminClient().from("notification_preferences")
    .select("in_app,push")
    .eq("restaurant_id", active.restaurantId)
    .eq("profile_id", profile.id)
    .eq("event_key", "table_service")
    .maybeSingle();
  return data ? Boolean(data.in_app || data.push) : true;
}

export async function setMyDiningNotifications(enabled: boolean): Promise<DiningAction> {
  const t = await getTranslator();
  const { active, profile } = await requireCapability("orders.view");
  const { error } = await createAdminClient().from("notification_preferences").upsert({
    restaurant_id: active.restaurantId,
    profile_id: profile.id,
    event_key: "table_service",
    in_app: enabled,
    email: false,
    push: enabled,
  }, { onConflict: "restaurant_id,profile_id,event_key" });
  if (error) {
    console.error("[dining:notifications]", error.message);
    return { ok: false, error: t("est.diningAlertPrefFailed") };
  }
  revalidatePath("/m/table-order");
  revalidatePath("/m/settings");
  return { ok: true };
}

/**
 * Every active bill of the branch, with what the floor needs to run it.
 *
 * GUARDED, AND THE BRANCH COMES FROM THE SESSION. This was an exported
 * function of a "use server" file with no check — a public endpoint that
 * returned any restaurant's open bills, guests, messages, table tokens and
 * join codes to anyone who knew (public) restaurant ids. The argument is
 * kept for the caller's sake but must name the caller's own active branch.
 */
export async function fetchDiningFloor(requestedRestaurantId: string) {
  const { active } = await requireCapability("orders.view");
  if (requestedRestaurantId !== active.restaurantId) return [];
  const restaurantId = active.restaurantId;
  const query = (extra: string) => createAdminClient().from("dining_sessions")
    .select(`id,status,kind,join_code,label,presence_confirmed_at,deposit_credit,reservation_id,opened_by_staff,order_id,created_at,payment_requested_at,restaurant_tables(id,number,public_token),dining_guests(id,display_name,status,created_at),dining_rounds(id,guest_id,status,subtotal,notes,created_at,added_by_staff,dining_round_items(id,name,quantity,unit_price,options_label,status,rejection_reason${extra})),dining_messages(id,guest_id,sender_kind,kind,body,created_at),dining_payments(id,guest_id,method,split_mode,amount,tip,service_fee,status,created_at),orders!dining_sessions_order_id_fkey(id,reference,status,subtotal,total,service_charge,is_paid,payment_method,order_items(id,name,quantity,unit_price,options_label))`)
    .eq("restaurant_id", restaurantId)
    .in("status", [...ACTIVE])
    .order("created_at");
  let { data, error } = await query(",price_to_confirm,price_max");
  // 0069 missing: the floor still loads, every dish at its fixed price.
  if (error) ({ data, error } = await query(""));
  if (error) {
    console.error("[dining:floor]", error.message);
    return [];
  }
  return data ?? [];
}

async function staffSession(sessionId: string, restaurantId: string) {
  if (!uuidOk(sessionId)) return null;
  const { data } = await createAdminClient().from("dining_sessions")
    .select("id,status,label,order_id")
    .eq("id", sessionId).eq("restaurant_id", restaurantId).maybeSingle();
  return data;
}

/** The waiter has seen the people behind this bill (or turns them away). */
export async function confirmDiningPresence(sessionId: string, approve: boolean): Promise<DiningAction> {
  const t = await getTranslator();
  const { active, profile } = await requireCapability("orders.advance");
  if (!(await enterpriseRestaurant(active.restaurantId))) return { ok: false, error: t("est.diningPackageRequired") };
  if (!(await staffSession(sessionId, active.restaurantId))) return { ok: false, error: t("est.tableSessionNotFound") };
  const { data, error } = await createAdminClient().rpc("confirm_dining_presence", {
    p_session_id: sessionId, p_staff_id: profile.id, p_approve: approve,
  });
  if (error) {
    console.error("[dining:presence]", error.code ?? "", error.message);
    return { ok: false, error: functionMissing(error) ? t("ons.err.migration0068") : t("est.guestAccessFailed") };
  }
  const guestIds = ((data as { guestIds?: string[] } | null)?.guestIds ?? []) as string[];
  await Promise.allSettled(guestIds.map((guestId) => notifyTableGuest(guestId, approve
    ? {
        fr: { title: "Présence confirmée", body: "Le serveur a confirmé votre présence. Vos plats partent en validation, vous pouvez commander et payer." },
        en: { title: "Presence confirmed", body: "The waiter confirmed you are at the table. Your dishes go for approval; you can order and pay." },
      }
    : {
        fr: { title: "Présence non confirmée", body: "Le restaurant n’a pas validé cette addition. Demandez de l’aide au personnel si vous êtes sur place." },
        en: { title: "Presence not confirmed", body: "The restaurant did not approve this bill. Ask staff for help if you are at the table." },
      })));
  revalidatePath("/m/table-order");
  return { ok: true };
}

export async function decideDiningGuest(guestId: string, approve: boolean): Promise<DiningAction> {
  const t = await getTranslator();
  const { active, profile } = await requireCapability("orders.advance");
  if (!(await enterpriseRestaurant(active.restaurantId))) return { ok: false, error: t("est.diningPackageRequired") };
  const db = createAdminClient();
  const { data: guest } = await db.from("dining_guests").select("id,status,session_id,dining_sessions!inner(restaurant_id)").eq("id", guestId).eq("status", "pending").maybeSingle();
  const session = one(guest?.dining_sessions);
  if (!guest || session?.restaurant_id !== active.restaurantId) return { ok: false, error: t("est.requestNotFound") };
  const { error } = await db.rpc("decide_dining_guest", { p_guest_id: guestId, p_staff_id: profile.id, p_approve: approve });
  if (error) {
    console.error("[dining:guest]", error.message);
    return { ok: false, error: t("est.guestAccessFailed") };
  }
  await notifyTableGuest(guestId, approve
    ? {
        fr: { title: "Présence confirmée", body: "Le serveur a confirmé votre présence. Vous pouvez commander et payer." },
        en: { title: "Presence confirmed", body: "The waiter confirmed you are at the table. You can order and pay." },
      }
    : {
        fr: { title: "Accès refusé", body: "Le restaurant n’a pas validé cette demande. Demandez de l’aide au personnel si vous êtes sur place." },
        en: { title: "Access declined", body: "The restaurant did not approve this request. Ask staff for help if you are at the table." },
      });
  revalidatePath("/m/table-order");
  return { ok: true };
}

export async function decideDiningItem(itemId: string, approve: boolean, reason?: string, unitPrice?: number): Promise<DiningAction> {
  const t = await getTranslator();
  const { active, profile } = await requireCapability("orders.advance");
  if (!approve && (!reason?.trim() || reason.trim().length < 5 || reason.trim().length > 240)) {
    return { ok: false, error: t("est.diningReasonRequired") };
  }
  const db = createAdminClient();
  const { data: item } = await db.from("dining_round_items")
    .select("id,dining_rounds!inner(session_id,dining_sessions!inner(restaurant_id))")
    .eq("id", itemId).eq("status", "pending").maybeSingle();
  const round = one(item?.dining_rounds);
  const session = one(round?.dining_sessions);
  if (!item || session?.restaurant_id !== active.restaurantId) return { ok: false, error: t("est.dishRequestNotFound") };

  const { data, error } = await db.rpc("decide_dining_item", {
    p_item_id: itemId,
    p_staff_id: profile.id,
    p_approve: approve,
    p_reason: approve ? null : reason?.trim(),
    // Customizable dish (0069): the waiter's price, checked against the range.
    ...(approve && unitPrice !== undefined ? { p_unit_price: Math.round(Number(unitPrice)) } : {}),
  });
  if (error) {
    console.error("[dining:item-decision]", error.message);
    return {
      ok: false,
      error: error.message.includes("insufficient_stock")
        ? t("est.notEnoughStock")
        : error.message.includes("guest_not_confirmed")
          ? t("ons.err.confirmPresenceFirst")
          : error.message.includes("price_required")
            ? t("est.customPricesRequired")
            : error.message.includes("price_out_of_range")
              ? t("est.customPriceOutOfRange")
              : t("est.dishUpdateFailed"),
    };
  }
  const result = data as { guestId: string | null; orderId?: string; reference?: string; created?: boolean; itemName: string; quantity: number; amount: number };
  if (result.guestId) {
    await notifyTableGuest(result.guestId, approve
      ? {
          fr: { title: "Plat accepté", body: `${result.quantity} × ${result.itemName} a été accepté et envoyé en cuisine.` },
          en: { title: "Dish accepted", body: `${result.quantity} × ${result.itemName} was accepted and sent to the kitchen.` },
        }
      : {
          fr: { title: "Plat indisponible", body: `${result.itemName} refusé : ${reason?.trim()}` },
          en: { title: "Dish declined", body: `${result.itemName} declined: ${reason?.trim()}` },
        });
  }
  if (approve && result.orderId && result.created) {
    await notify({
      event: "new_order", tone: "info", restaurantId: active.restaurantId,
      href: `/m/orders/${result.orderId}`,
      params: { reference: result.reference, customerName: "Salle", amount: result.amount },
    });
  }
  revalidatePath("/m/table-order");
  revalidatePath("/m/orders");
  revalidatePath("/m/kitchen");
  return { ok: true };
}

export async function decideDiningItems(itemIds: string[], approve: boolean, reason?: string): Promise<DiningAction & { succeeded: number; failedIds: string[] }> {
  const t = await getTranslator();
  if (!Array.isArray(itemIds) || itemIds.length === 0 || itemIds.length > 50 || new Set(itemIds).size !== itemIds.length) {
    return { ok: false, error: t("est.selectDishes"), succeeded: 0, failedIds: itemIds ?? [] };
  }
  if (!approve && (!reason?.trim() || reason.trim().length < 5 || reason.trim().length > 240)) {
    return { ok: false, error: t("est.diningReasonRequired"), succeeded: 0, failedIds: itemIds };
  }
  let succeeded = 0;
  const failedIds: string[] = [];
  let firstError: string | undefined;
  for (const id of itemIds) {
    const result = await decideDiningItem(id, approve, reason);
    if (result.ok) succeeded++;
    else {
      failedIds.push(id);
      firstError ??= result.error;
    }
  }
  return {
    ok: failedIds.length === 0,
    error: failedIds.length ? (succeeded === 0 && firstError ? firstError : t("est.dishesNotUpdated", { count: failedIds.length })) : undefined,
    succeeded,
    failedIds,
  };
}

/**
 * The waiter's order, onto a bill.
 *
 * `sessionId` adds to an existing bill; without it a new bill is opened on
 * the table first (a walk-in, or a guest without a phone) — so everything
 * eaten at a table is always on one of its bills, never a separate ticket.
 */
export async function staffOrderToBill(input: {
  tableId: string;
  sessionId?: string | null;
  label?: string;
  lines: { menuItemId: string; quantity: number; optionIds: string[]; unitPrice?: number }[];
  notes?: string;
}): Promise<DiningAction & { sessionId?: string; reference?: string; code?: string | null }> {
  const t = await getTranslator();
  const { active, profile } = await requireCapability("orders.advance");
  if (!(await enterpriseRestaurant(active.restaurantId))) return { ok: false, error: t("est.diningPackageRequired") };
  if (!Array.isArray(input.lines) || input.lines.length === 0 || input.lines.length > 40) return { ok: false, error: t("est.selectDishes") };
  const lines = input.lines.map((line) => ({
    menuItemId: String(line.menuItemId),
    quantity: Math.max(1, Math.min(50, Math.round(Number(line.quantity) || 1))),
    optionIds: (line.optionIds ?? []).map(String).slice(0, 20),
    ...(line.unitPrice !== undefined && Number.isFinite(Number(line.unitPrice)) ? { unitPrice: Math.round(Number(line.unitPrice)) } : {}),
  }));
  const db = createAdminClient();

  let sessionId = input.sessionId ?? null;
  let code: string | null = null;
  if (sessionId) {
    const session = await staffSession(sessionId, active.restaurantId);
    if (!session || session.status !== "open") return { ok: false, error: t("est.tableSessionNotFound") };
  } else {
    if (!uuidOk(input.tableId)) return { ok: false, error: t("est.tableSessionNotFound") };
    const { data: table } = await db.from("restaurant_tables").select("id").eq("id", input.tableId).eq("restaurant_id", active.restaurantId).maybeSingle();
    if (!table) return { ok: false, error: t("est.tableSessionNotFound") };
    const { data: opened, error: openError } = await db.rpc("staff_open_dining_bill", {
      p_table_id: input.tableId, p_staff_id: profile.id, p_label: (input.label ?? "").trim().slice(0, 60) || null, p_reservation_id: null,
    });
    if (openError) {
      console.error("[dining:staff-open]", openError.code ?? "", openError.message);
      return { ok: false, error: functionMissing(openError) ? t("ons.err.migration0068") : t("ons.err.billOpenFailed") };
    }
    sessionId = (opened as { sessionId: string }).sessionId;
    code = (opened as { code: string | null }).code;
  }

  const { data, error } = await db.rpc("staff_add_dining_items", {
    p_session_id: sessionId, p_staff_id: profile.id, p_lines: lines, p_notes: input.notes?.slice(0, 500) ?? null,
  });
  if (error) {
    console.error("[dining:staff-add]", error.code ?? "", error.message);
    return {
      ok: false,
      error: error.message.includes("insufficient_stock") ? t("est.notEnoughStock")
        : error.message.includes("item_unavailable") ? t("tbg.err.itemUnavailable")
          : error.message.includes("price_out_of_range") ? t("est.customPriceOutOfRange")
            : t("est.dishUpdateFailed"),
    };
  }
  const result = data as { orderId?: string; reference?: string; created?: boolean; total?: number };
  if (result.created && result.orderId) {
    await notify({
      event: "new_order", tone: "info", restaurantId: active.restaurantId,
      href: `/m/orders/${result.orderId}`,
      params: { reference: result.reference, customerName: "Salle", amount: result.total },
    });
  }
  await notifySessionGuests(sessionId!, {
    fr: { title: "Plats ajoutés à l’addition", body: "Le serveur a ajouté des plats à votre addition." },
    en: { title: "Dishes added to the bill", body: "The waiter added dishes to your bill." },
  });
  revalidatePath("/m/table-order");
  revalidatePath("/m/kitchen");
  revalidatePath("/m/orders");
  return { ok: true, sessionId: sessionId!, reference: result.reference, code };
}

/** "The rest was paid in cash" — the exact figure the waiter saw, or refused. */
export async function recordDiningCash(sessionId: string, amount: number): Promise<DiningAction> {
  const t = await getTranslator();
  const { active, profile } = await requireCapability("payments.collect");
  if (!(await staffSession(sessionId, active.restaurantId))) return { ok: false, error: t("est.tableSessionNotFound") };
  const { error } = await createAdminClient().rpc("record_dining_cash", {
    p_session_id: sessionId, p_staff_id: profile.id, p_amount: Math.max(0, Math.round(Number(amount) || 0)),
  });
  if (error) {
    console.error("[dining:cash]", error.code ?? "", error.message);
    const m = error.message ?? "";
    return {
      ok: false,
      error: m.includes("undecided_dishes") ? t("tbg.err.itemsPending")
        : m.includes("payment_in_flight") ? t("ons.err.paymentInFlight")
          : m.includes("empty_bill") ? t("est.noBillToCollect")
            : t("est.billChanged"),
    };
  }
  await notifySessionGuests(sessionId, {
    fr: { title: "Addition réglée", body: "Le restaurant a enregistré le règlement de votre addition. Merci de votre visite !" },
    en: { title: "Bill settled", body: "The restaurant recorded payment of your bill. Thank you for visiting!" },
  });
  revalidatePath("/m/table-order");
  revalidatePath("/m/orders");
  revalidatePath("/m/tables");
  return { ok: true };
}

/** A bill with nothing on it (a mistaken scan, a party that left) is closed. */
export async function closeEmptyDiningBill(sessionId: string): Promise<DiningAction> {
  const t = await getTranslator();
  const { active, profile } = await requireCapability("orders.advance");
  if (!(await staffSession(sessionId, active.restaurantId))) return { ok: false, error: t("est.tableSessionNotFound") };
  const { error } = await createAdminClient().rpc("close_empty_dining_bill", { p_session_id: sessionId, p_staff_id: profile.id });
  if (error) {
    console.error("[dining:close-empty]", error.code ?? "", error.message);
    return { ok: false, error: error.message.includes("bill_not_empty") ? t("ons.err.billNotEmpty") : t("est.billChanged") };
  }
  revalidatePath("/m/table-order");
  revalidatePath("/m/tables");
  return { ok: true };
}

/**
 * A booking voucher presented at the table: seats the booking and takes its
 * deposit off this bill (redeem_reservation_voucher, one transaction).
 */
export async function applyVoucherToBill(sessionId: string, code: string): Promise<DiningAction & { credit?: number }> {
  const t = await getTranslator();
  const { active, profile } = await requireCapability("reservations.seat");
  if (!(await staffSession(sessionId, active.restaurantId))) return { ok: false, error: t("est.tableSessionNotFound") };
  const { data, error } = await createAdminClient().rpc("redeem_reservation_voucher", {
    p_code: normaliseVoucherCode(code), p_staff_id: profile.id, p_session_id: sessionId, p_open_table_id: null,
  });
  if (error) {
    const key = voucherErrorKey(error.message ?? "");
    if (key === "ons.err.voucherFailed") console.error("[dining:voucher]", error.code ?? "", error.message);
    return { ok: false, error: t(key) };
  }
  const result = data as { credit: number; customerId: string | null; reference: string };
  if (result.customerId) {
    await notify({
      event: "reservation_status", tone: "info", customerId: result.customerId, href: "/reservations",
      params: { reference: result.reference, restaurantName: active.restaurantName, status: "seated" },
    });
  }
  revalidatePath("/m/table-order");
  revalidatePath("/m/reservations");
  return { ok: true, credit: result.credit };
}

export async function sendStaffDiningMessage(sessionId: string, guestId: string, body: string): Promise<DiningAction> {
  const t = await getTranslator();
  const { active, profile } = await requireCapability("orders.view");
  const text = body.trim().slice(0, 500);
  if (!text) return { ok: false, error: t("tbg.err.writeFirst") };
  const db = createAdminClient();
  const { data: session } = await db.from("dining_sessions").select("id")
    .eq("id", sessionId).eq("restaurant_id", active.restaurantId)
    .in("status", [...ACTIVE]).maybeSingle();
  if (!session) return { ok: false, error: t("est.tableSessionNotFound") };
  const { data: guest } = await db.from("dining_guests").select("id")
    .eq("id", guestId).eq("session_id", sessionId).in("status", ["approved", "pending"]).maybeSingle();
  if (!guest) return { ok: false, error: t("est.chooseApprovedGuest") };
  const { error } = await db.from("dining_messages").insert({
    session_id: sessionId, guest_id: guestId, sender_kind: "staff",
    sender_staff_id: profile.id, kind: "message", body: text,
  });
  if (error) return { ok: false, error: t("est.messageNotSent") };
  await notifyTableGuest(guestId, {
    fr: { title: "Message du restaurant", body: text },
    en: { title: "Message from the restaurant", body: text },
  }, false);
  revalidatePath("/m/table-order");
  return { ok: true };
}
