import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notify";
import { requireCronAuth, stampHeartbeat } from "@/lib/cron";

/**
 * The order watchdog — four sweeps over the states where one side is
 * waiting on the other and nothing else in the system would ever act.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  1. UNACKNOWLEDGED ORDERS. A new order rings once at placement; a phone
 *     locked at the wrong moment meant the kitchen never knew. Orders still
 *     `pending` after 5 minutes ring again (same collapse tag + renotify =
 *     the banner re-buzzes instead of stacking), up to 5 times, 5 minutes
 *     apart. On the 3rd ring the ADMINS are told too — the platform is the
 *     only party left who can pick up a phone.
 *
 *  2. UNANSWERED FEE QUOTES. `awaiting_customer` is the one notification
 *     in the flow that blocks the kitchen until answered. One reminder to
 *     the customer after 15 minutes; if still unanswered an hour after the
 *     quote, the restaurant is told to call (the number is on the ticket).
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
const FEE_REMINDER_MINUTES = 15;
const FEE_ESCALATION_MINUTES = 60;
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
  const summary = { pendingNags: 0, feeReminders: 0, feeEscalations: 0, reviewPrompts: 0, dueAlerts: 0 };
  let schemaMissing = false;

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
          PAYMENT FIRST: an unpaid Mobile Money order is waiting on the
          CUSTOMER, not the kitchen. Ringing the restaurant about it — and
          escalating to the admins that "the restaurant is not responding" —
          pushes them to act on food they may not start. The one restaurant
          move before payment is quoting a delivery fee, so that still rings.
        */
        const awaitingPayment = order.payment_method === "mobile_money" && !order.is_paid;
        const needsQuote = order.type === "delivery" && !order.delivery_fee_set_at;
        if (awaitingPayment && !needsQuote) continue;

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

  /* ── 2. Unanswered fee quotes ────────────────────────────────────────── */
  {
    const remindCutoff = new Date(now - FEE_REMINDER_MINUTES * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("orders")
      .select("id, reference, customer_id, restaurant_id, delivery_fee, fee_reminder_at, fee_escalated_at, delivery_fee_set_at, restaurants ( name )")
      .eq("status", "awaiting_customer")
      .not("customer_id", "is", null)
      .lt("delivery_fee_set_at", remindCutoff);

    if (missingColumn(error)) {
      schemaMissing = true;
    } else if (error) {
      console.error("[order-nag] fee query failed", error.message);
    } else {
      for (const order of data ?? []) {
        const restaurantName =
          (order.restaurants as unknown as { name?: string } | null)?.name ?? undefined;

        if (!order.fee_reminder_at) {
          // The same action-required copy as the quote itself — same collapse
          // tag, so the banner is refreshed and re-buzzes, not duplicated.
          await notify({
            event: "order_status",
            tone: "warning",
            customerId: order.customer_id as string,
            href: `/orders/${order.id}`,
            params: {
              status: "awaiting_customer",
              reference: order.reference as string,
              restaurantName,
              deliveryFee: (order.delivery_fee as number) ?? undefined,
            },
          });
          await supabase
            .from("orders")
            .update({ fee_reminder_at: new Date().toISOString() })
            .eq("id", order.id)
            .eq("status", "awaiting_customer");
          summary.feeReminders++;
          continue;
        }

        const quotedAgo = now - Date.parse(order.delivery_fee_set_at as string);
        if (!order.fee_escalated_at && quotedAgo > FEE_ESCALATION_MINUTES * 60 * 1000) {
          await notify({
            event: "order_delayed",
            tone: "warning",
            restaurantId: order.restaurant_id as string,
            href: `/m/orders/${order.id}`,
            params: {
              reference: order.reference as string,
              status: "awaiting_customer",
              audience: "staff",
            },
          });
          await supabase
            .from("orders")
            .update({ fee_escalated_at: new Date().toISOString() })
            .eq("id", order.id)
            .eq("status", "awaiting_customer");
          summary.feeEscalations++;
        }
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

  if (schemaMissing) {
    console.error("[order-nag] one or more 0044 columns are missing — run migration 0044. Affected sweeps skipped.");
  }

  await stampHeartbeat("order-nag", summary);
  return NextResponse.json({ ...summary, schemaMissing });
}
