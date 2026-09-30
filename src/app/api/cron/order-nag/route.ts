import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notify";
import { requireCronAuth, stampHeartbeat } from "@/lib/cron";
import { orderDeadline } from "@/lib/orders/deadline";
import { getTimeLimits } from "@/lib/orders/time-limit-settings";
import { releaseOrderHoldings } from "@/lib/orders/cancellation-effects";
import { resolveAttemptOutcome, confirmationWindowMs } from "@/lib/payments/collect";
import { awardDeliveryPoints } from "@/lib/orders/award-points";
import { AUTO_CLOSE_HOURS, prepNudgeDue, PAID_NOT_STARTED_MINUTES } from "@/lib/orders/stage-watch";

/**
 * The order watchdog — four sweeps over the states where one side is
 * waiting on the other and nothing else in the system would ever act.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  0. THE TIME LIMIT (0059). The admin's `order_response_minutes` (default
 *     15) bounds both waits: a `pending` order the restaurant never accepted,
 *     and an `awaiting_customer` order the customer never paid. Past it the
 *     order is cancelled, its stock and points are given back, and both sides
 *     are told. Before cancelling an unpaid order, any payment attempt still
 *     open on it is resolved with CamerPay first — a PIN approved at the last
 *     second must pay the order, not trigger a refund.
 *
 *  1. UNACKNOWLEDGED ORDERS. A new order rings once at placement; a phone
 *     locked at the wrong moment meant the kitchen never knew. Orders still
 *     `pending` after 5 minutes ring again (same collapse tag + renotify =
 *     the banner re-buzzes instead of stacking), up to 5 times, 5 minutes
 *     apart. On the 3rd ring the ADMINS are told too — the platform is the
 *     only party left who can pick up a phone.
 *
 *  2. UNPAID ACCEPTED ORDERS. `awaiting_customer` is the one notification
 *     in the flow that blocks the kitchen until answered. One reminder to
 *     the customer halfway through the time limit; sweep 0 ends it after.
 *
 *  3. REVIEW PROMPTS. A delivered order gets one invitation to rate, a few
 *     hours later, only if no review exists — the pipeline was starved at
 *     the top of the funnel because the app never asked.
 *
 *  4. SCHEDULED ORDERS COMING DUE. The new-order push fires at placement,
 *     maybe a day early; nothing fired again at prep time. 45 minutes
 *     before the slot, the branch is reminded with the slot time in the
 *     title.
 *
 *  Every sweep is deduped by its own 0044 stamp column, so each order gets
 *  each alert exactly once (the pending ladder counts to its cap). On a
 *  pre-0044 database the sweeps skip with one log line rather than storm.
 * ─────────────────────────────────────────────────────────────────────────
 */

export const dynamic = "force-dynamic";

const PENDING_NAG_MINUTES = 5;
const PENDING_NAG_MAX = 5;
const PENDING_ADMIN_ESCALATION_AT = 3;
const REVIEW_PROMPT_AFTER_HOURS = 2;
const REVIEW_PROMPT_WINDOW_HOURS = 26;
const DUE_ALERT_LEAD_MINUTES = 45;

function missingColumn(error: { code?: string } | null): boolean {
  return Boolean(error && (error.code === "42703" || error.code === "PGRST204"));
}

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  const supabase = createAdminClient();
  const now = Date.now();
  const summary = {
    expired: 0,
    pendingNags: 0,
    feeReminders: 0,
    reviewPrompts: 0,
    dueAlerts: 0,
    stageNudges: 0,
    autoClosed: 0,
  };
  let schemaMissing = false;
  const { orderMinutes } = await getTimeLimits();

  /* ── 0. The time limit ───────────────────────────────────────────────── */
  {
    // Nothing younger than the limit can be past it: prefilter in SQL, decide
    // per order with the same orderDeadline() the screens show.
    const candidates = new Date(now - orderMinutes * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("orders")
      .select("id, reference, restaurant_id, customer_id, status, type, payment_method, is_paid, created_at, scheduled_for, restaurants ( name )")
      .in("status", ["pending", "awaiting_customer"])
      .eq("is_paid", false)
      .lt("created_at", candidates)
      .limit(100);

    if (error) {
      console.error("[order-nag] time-limit query failed", error.message);
    } else if ((data ?? []).length > 0) {
      const rows = data ?? [];
      const awaiting = rows.filter((o) => o.status === "awaiting_customer").map((o) => o.id as string);
      const acceptedAt = new Map<string, string>();
      if (awaiting.length > 0) {
        const { data: history } = await supabase
          .from("order_status_history")
          .select("order_id, created_at")
          .in("order_id", awaiting)
          .eq("status", "awaiting_customer")
          .order("created_at", { ascending: true });
        for (const h of history ?? []) {
          if (!acceptedAt.has(h.order_id as string)) acceptedAt.set(h.order_id as string, h.created_at as string);
        }
      }

      for (const order of rows) {
        const deadline = orderDeadline(
          {
            status: order.status as string,
            createdAt: order.created_at as string,
            scheduledFor: order.scheduled_for as string | null,
            acceptedAt: acceptedAt.get(order.id as string) ?? null,
          },
          orderMinutes,
        );
        if (!deadline || deadline.getTime() > now) continue;

        if (order.status === "awaiting_customer") {
          // Settle any payment still open on it before giving up on it.
          const { data: attempts } = await supabase
            .from("payment_attempts")
            .select("id, created_at, provider, raw_response")
            .eq("raw_response->>orderId", order.id as string)
            .eq("status", "pending");
          let paidMeanwhile = false;
          let stillInFlight = false;
          for (const attempt of attempts ?? []) {
            const outcome = await resolveAttemptOutcome(attempt.id as string);
            if (outcome.status === "succeeded") paidMeanwhile = true;
            else if (
              outcome.status === "pending" &&
              // An Orange ask accepted after the dial is being held open for
              // the report: the order must not be cancelled under it.
              (outcome.error === "dialClaimAccepted" ||
                now - Date.parse(attempt.created_at as string) <
                  confirmationWindowMs(String(attempt.provider ?? "camerpay"), attempt.raw_response))
            ) {
              stillInFlight = true;
            }
          }
          // A prompt still live on the phone gets its five minutes (ten when the
          // customer has to dial an Orange code themselves).
          if (paidMeanwhile || stillInFlight) continue;
        }

        const lapsedPending = order.status === "pending";
        const reason = lapsedPending
          ? "Le restaurant n'a pas confirmé la commande dans le délai."
          : "Le paiement n'a pas été reçu dans le délai.";
        const { data: cancelled } = await supabase
          .from("orders")
          .update({ status: "cancelled", cancelled_reason: reason, cancelled_at: new Date().toISOString() })
          .eq("id", order.id)
          .eq("status", order.status)
          .eq("is_paid", false)
          .select("id")
          .maybeSingle();
        if (!cancelled) continue;

        await supabase.from("order_status_history").insert({
          order_id: order.id,
          status: "cancelled",
          by_name: "Resto237",
          note: `Time limit (${orderMinutes} min) — ${lapsedPending ? "not accepted" : "not paid"}`,
        });
        await releaseOrderHoldings(order.id as string);

        const restaurantName = (order.restaurants as unknown as { name?: string } | null)?.name ?? undefined;
        if (order.customer_id) {
          await notify({
            event: "order_cancelled",
            tone: "warning",
            customerId: order.customer_id as string,
            href: `/orders/${order.id}`,
            params: {
              reference: order.reference as string,
              restaurantName,
              cancelledBy: "timeout",
              reason: lapsedPending
                ? `${restaurantName ?? "Le restaurant"} n'a pas confirmé votre commande à temps.`
                : "Le paiement n'a pas été reçu à temps.",
              audience: "customer",
            },
          });
        }
        await notify({
          event: "order_cancelled",
          tone: "warning",
          restaurantId: order.restaurant_id as string,
          href: `/m/orders/${order.id}`,
          params: {
            reference: order.reference as string,
            cancelledBy: "timeout",
            audience: "staff",
            reason: lapsedPending
              ? `Non acceptée en ${orderMinutes} minutes — annulée automatiquement.`
              : `Le client n'a pas payé en ${orderMinutes} minutes — annulée automatiquement.`,
          },
        });
        summary.expired++;
      }
    }
  }

  /* ── 1. Unacknowledged pending orders ────────────────────────────────── */
  {
    const nagCutoff = new Date(now - PENDING_NAG_MINUTES * 60 * 1000).toISOString();
    const dueHorizon = new Date(now + DUE_ALERT_LEAD_MINUTES * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("orders")
      .select("id, reference, restaurant_id, total, delivery_name, pending_alert_count, pending_alert_at, scheduled_for, type, payment_method, is_paid, delivery_fee_set_at")
      .eq("status", "pending")
      .lt("created_at", nagCutoff)
      .lt("pending_alert_count", PENDING_NAG_MAX)
      // A pre-order for tomorrow is not "unacknowledged" — it is early. It
      // enters the ladder once its prep window opens (sweep 4's horizon).
      .or(`scheduled_for.is.null,scheduled_for.lt.${dueHorizon}`);

    if (missingColumn(error)) {
      schemaMissing = true;
    } else if (error) {
      console.error("[order-nag] pending query failed", error.message);
    } else {
      for (const order of data ?? []) {
        /*
          EVERY `pending` ORDER IS WAITING ON THE RESTAURANT.

          In the payment-first flow nothing is paid before the restaurant
          accepts, so "unpaid" never meant "waiting on the customer" here.
          The old skip for unpaid Mobile Money orders silenced every PICKUP
          order (no fee to quote) — the kitchen was never rung, not at
          placement and not here, and the customer waited indefinitely.
        */
        const lastAlert = order.pending_alert_at ? Date.parse(order.pending_alert_at as string) : 0;
        if (now - lastAlert < PENDING_NAG_MINUTES * 60 * 1000) continue;

        const count = (order.pending_alert_count as number) + 1;
        await notify({
          event: "new_order",
          tone: "warning",
          restaurantId: order.restaurant_id as string,
          href: `/m/orders/${order.id}`,
          params: {
            reference: order.reference as string,
            customerName: (order.delivery_name as string | null) ?? undefined,
            amount: order.total as number,
            reminder: true,
          },
        });

        if (count === PENDING_ADMIN_ESCALATION_AT) {
          await notify({
            event: "broadcast",
            tone: "error",
            admins: true,
            href: `/a/restaurants`,
            params: {
              reference: `unacked:${order.restaurant_id}`,
              subject: `Order ${order.reference} unacknowledged`,
              bodyText: `Order ${order.reference} has been waiting ${count * PENDING_NAG_MINUTES}+ minutes with no response from the restaurant. Call them — the customer is waiting.`,
            },
          });
        }

        await supabase
          .from("orders")
          .update({ pending_alert_count: count, pending_alert_at: new Date().toISOString() })
          .eq("id", order.id)
          .eq("status", "pending");
        summary.pendingNags++;
      }
    }
  }

  /* ── 2. Accepted orders the customer has not paid ─────────────────── */
  {
    // Halfway through the time limit, one reminder with the same collapse tag
    // as the original request, so the banner re-buzzes instead of stacking.
    const halfway = Math.max(1, Math.floor(orderMinutes / 2));
    const { data, error } = await supabase
      .from("orders")
      .select("id, reference, customer_id, restaurant_id, total, delivery_fee, fee_reminder_at, restaurants ( name )")
      .eq("status", "awaiting_customer")
      .eq("is_paid", false)
      .not("customer_id", "is", null)
      .is("fee_reminder_at", null)
      .limit(100);

    if (missingColumn(error)) {
      schemaMissing = true;
    } else if (error) {
      console.error("[order-nag] payment reminder query failed", error.message);
    } else if ((data ?? []).length > 0) {
      const ids = (data ?? []).map((o) => o.id as string);
      const { data: history } = await supabase
        .from("order_status_history")
        .select("order_id, created_at")
        .in("order_id", ids)
        .eq("status", "awaiting_customer");
      const acceptedAt = new Map<string, number>();
      for (const h of history ?? []) {
        const at = Date.parse(h.created_at as string);
        const known = acceptedAt.get(h.order_id as string);
        if (known === undefined || at < known) acceptedAt.set(h.order_id as string, at);
      }

      for (const order of data ?? []) {
        const accepted = acceptedAt.get(order.id as string);
        if (!accepted || now - accepted < halfway * 60 * 1000) continue;
        const payBy = new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Douala", hour: "2-digit", minute: "2-digit" })
          .format(new Date(accepted + orderMinutes * 60 * 1000));

        await notify({
          event: "order_status",
          tone: "warning",
          customerId: order.customer_id as string,
          // `?pay=1` marks "please pay" for the customer's in-app chime.
          href: `/orders/${order.id}?pay=1`,
          params: {
            status: "awaiting_customer",
            reference: order.reference as string,
            restaurantName: (order.restaurants as unknown as { name?: string } | null)?.name ?? undefined,
            deliveryFee: (order.delivery_fee as number) ?? undefined,
            amount: order.total as number,
            whenLabel: payBy,
          },
        });
        await supabase
          .from("orders")
          .update({ fee_reminder_at: new Date().toISOString() })
          .eq("id", order.id)
          .eq("status", "awaiting_customer");
        summary.feeReminders++;
      }
    }
  }

  /* ── 3. Review prompts for yesterday's delivered orders ──────────────── */
  {
    const newest = new Date(now - REVIEW_PROMPT_AFTER_HOURS * 60 * 60 * 1000).toISOString();
    const oldest = new Date(now - REVIEW_PROMPT_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("orders")
      .select("id, reference, customer_id, restaurants ( name )")
      .eq("status", "delivered")
      .not("customer_id", "is", null)
      .is("review_prompt_at", null)
      .gte("delivered_at", oldest)
      .lte("delivered_at", newest)
      .limit(200);

    if (missingColumn(error)) {
      schemaMissing = true;
    } else if (error) {
      console.error("[order-nag] review query failed", error.message);
    } else if ((data ?? []).length > 0) {
      const orderIds = (data ?? []).map((o) => o.id as string);
      const { data: reviewed } = await supabase
        .from("reviews")
        .select("order_id")
        .in("order_id", orderIds);
      const alreadyReviewed = new Set(((reviewed ?? []) as { order_id: string }[]).map((r) => r.order_id));

      for (const order of data ?? []) {
        // One prompt per order, and none at all if they already rated it.
        // The stamp is written either way so the order leaves the scan.
        if (!alreadyReviewed.has(order.id as string)) {
          await notify({
            event: "review_prompt",
            tone: "info",
            customerId: order.customer_id as string,
            href: `/orders/${order.id}`,
            params: {
              reference: order.reference as string,
              restaurantName:
                (order.restaurants as unknown as { name?: string } | null)?.name ?? undefined,
            },
          });
          summary.reviewPrompts++;
        }
        await supabase
          .from("orders")
          .update({ review_prompt_at: new Date().toISOString() })
          .eq("id", order.id);
      }
    }
  }

  /* ── 4. Scheduled orders whose prep window opened ────────────────────── */
  {
    const horizon = new Date(now + DUE_ALERT_LEAD_MINUTES * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("orders")
      .select("id, reference, restaurant_id, total, delivery_name, scheduled_for")
      .in("status", ["pending", "confirmed"])
      .not("scheduled_for", "is", null)
      .is("due_alert_at", null)
      .gte("scheduled_for", new Date(now - 60 * 60 * 1000).toISOString())
      .lte("scheduled_for", horizon);

    if (missingColumn(error)) {
      schemaMissing = true;
    } else if (error) {
      console.error("[order-nag] scheduled query failed", error.message);
    } else {
      for (const order of data ?? []) {
        const whenLabel = new Intl.DateTimeFormat("fr-FR", {
          timeZone: "Africa/Douala",
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(order.scheduled_for as string));

        await notify({
          event: "new_order",
          tone: "warning",
          restaurantId: order.restaurant_id as string,
          href: `/m/orders/${order.id}`,
          params: {
            reference: order.reference as string,
            customerName: (order.delivery_name as string | null) ?? undefined,
            amount: order.total as number,
            whenLabel,
          },
        });
        await supabase
          .from("orders")
          .update({ due_alert_at: new Date().toISOString() })
          .eq("id", order.id);
        summary.dueAlerts++;
      }
    }
  }

  /* ── 5. Forgotten steps: remind, never move forward (0065) ─────────── */
  {
    const { data, error } = await supabase
      .from("orders")
      .select("id, reference, restaurant_id, status, type, stage_nudge_status, stage_nudge_count, restaurants ( delivery_estimate_min )")
      .in("status", ["confirmed", "preparing"])
      .gt("created_at", new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString())
      .limit(200);

    if (missingColumn(error)) {
      console.error("[order-nag] stage_nudge columns missing — run migration 0065. Stage sweep skipped.");
    } else if (error) {
      console.error("[order-nag] stage query failed", error.message);
    } else if ((data ?? []).length > 0) {
      const ids = (data ?? []).map((o) => o.id as string);
      const { data: history } = await supabase
        .from("order_status_history")
        .select("order_id, status, created_at")
        .in("order_id", ids)
        .in("status", ["confirmed", "preparing"])
        .order("created_at", { ascending: true });
      // When each order ENTERED its current step (first history row for it).
      const enteredAt = new Map<string, number>();
      for (const h of history ?? []) {
        const key = `${h.order_id}:${h.status}`;
        if (!enteredAt.has(key)) enteredAt.set(key, Date.parse(h.created_at as string));
      }

      for (const order of data ?? []) {
        const status = order.status as "confirmed" | "preparing";
        const since = enteredAt.get(`${order.id}:${status}`);
        if (!since) continue;
        const sentForThisStep = order.stage_nudge_status === status ? Number(order.stage_nudge_count ?? 0) : 0;
        const estimate = Number((order.restaurants as unknown as { delivery_estimate_min?: number } | null)?.delivery_estimate_min) || 30;

        let nudge: number | null = null;
        if (status === "confirmed" && sentForThisStep === 0 && now - since >= PAID_NOT_STARTED_MINUTES * 60_000) {
          nudge = 1;
        } else if (status === "preparing") {
          nudge = prepNudgeDue({ enteredAt: since, now, estimateMinutes: estimate, alreadySent: sentForThisStep });
        }
        if (nudge === null) continue;

        const minutes = Math.round((now - since) / 60_000);
        await notify({
          event: "order_delayed",
          tone: "warning",
          restaurantId: order.restaurant_id as string,
          href: `/m/orders/${order.id}`,
          params: { reference: order.reference as string, status, audience: "staff", count: minutes },
        });
        if (status === "preparing" && nudge >= 2) {
          await notify({
            event: "broadcast",
            tone: "error",
            admins: true,
            href: "/a/restaurants",
            params: {
              reference: `stuck:${order.id}`,
              subject: `Order ${order.reference} stuck in preparation`,
              bodyText: `Order ${order.reference} has been "preparing" for ${minutes} minutes — twice the restaurant's usual time. The customer paid; check with the restaurant.`,
            },
          });
        }
        await supabase
          .from("orders")
          .update({ stage_nudge_status: status, stage_nudge_count: nudge })
          .eq("id", order.id)
          .eq("status", status);
        summary.stageNudges++;
      }
    }
  }

  /* ── 6. Last step never pressed: finish the order (0065) ─────────────── */
  {
    const oldestPossible = new Date(now - AUTO_CLOSE_HOURS.paid * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("orders")
      .select("id, reference, restaurant_id, customer_id, type, is_paid, subtotal, shipped_at, created_at, table_number, restaurants ( name )")
      .eq("status", "shipped")
      .or(`shipped_at.lt.${oldestPossible},and(shipped_at.is.null,created_at.lt.${oldestPossible})`)
      .limit(100);

    if (error) {
      console.error("[order-nag] auto-close query failed", error.message);
    } else {
      for (const order of data ?? []) {
        const unpaidTable = order.type === "dine_in" && !order.is_paid;
        const hours = unpaidTable ? AUTO_CLOSE_HOURS.unpaidTable : AUTO_CLOSE_HOURS.paid;
        const since = Date.parse((order.shipped_at ?? order.created_at) as string);
        if (now - since < hours * 60 * 60 * 1000) continue;

        const note = unpaidTable
          ? "Clôturée automatiquement — paiement non enregistré"
          : order.type === "dine_in"
            ? "Clôturée automatiquement (table libérée)"
            : order.type === "pickup"
              ? "Marquée récupérée automatiquement"
              : "Marquée livrée automatiquement";
        const { data: closed, error: closeError } = await supabase.rpc("auto_close_served_order", {
          p_order_id: order.id,
          p_note: note,
        });
        if (closeError) {
          // 42883 / PGRST202: migration 0065 not applied yet.
          console.error("[order-nag] auto-close failed", order.id, closeError.code, closeError.message);
          break;
        }
        if (!closed) continue;

        await awardDeliveryPoints({
          id: order.id as string,
          subtotal: Number(order.subtotal),
          reference: order.reference as string,
          customer_id: (order.customer_id as string | null) ?? null,
          restaurant_id: order.restaurant_id as string,
        });
        if (order.customer_id) {
          await notify({
            event: "order_status",
            tone: "info",
            customerId: order.customer_id as string,
            href: `/orders/${order.id}`,
            params: {
              status: "delivered",
              reference: order.reference as string,
              restaurantName: (order.restaurants as unknown as { name?: string } | null)?.name ?? undefined,
              orderType: order.type as "delivery" | "pickup" | "dine_in",
              autoClosed: true,
            },
          });
        }
        if (unpaidTable) {
          await notify({
            event: "order_delayed",
            tone: "warning",
            restaurantId: order.restaurant_id as string,
            href: `/m/orders/${order.id}`,
            params: { reference: order.reference as string, status: "cancelled", audience: "staff", detail: order.table_number ?? undefined },
          });
        }
        summary.autoClosed++;
      }
    }
  }

  if (schemaMissing) {
    console.error("[order-nag] one or more 0044 columns are missing — run migration 0044. Affected sweeps skipped.");
  }

  await stampHeartbeat("order-nag", summary);
  return NextResponse.json({ ...summary, schemaMissing });
}
