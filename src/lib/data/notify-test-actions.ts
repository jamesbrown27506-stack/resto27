"use server";

import { requireRole } from "@/lib/auth/session";
import { notify, type NotifyEvent, type NotifyParams, type NotifyTone } from "@/lib/notify";
import { writeAudit } from "./platform-actions";

/**
 * The notification tester behind Diagnostics → Notifications.
 *
 * One button per event sends a REAL notification through the exact same
 * writer real events use (lib/notify.ts) — same copy, same tone, same deep
 * link, same preference gating. The only difference from production: it is
 * addressed to the signed-in admin, like sendTestEmail, never to a real
 * customer.
 *
 * The sample data lives HERE, server-side. The client sends only a key, so a
 * crafted request cannot invent its own copy or target anyone but the caller
 * (requireRole + profileId = session, the same rule as every admin action).
 */

export type NotifyTestKey =
  | "new_order"
  | "order_status"
  | "cancelled_by_customer"
  | "cancelled_by_restaurant"
  | "low_stock"
  | "loyalty"
  | "reservation"
  | "reservation_confirmed"
  | "reservation_declined"
  | "review"
  | "review_reply"
  | "moderation"
  | "billing"
  | "billing_paid"
  | "billing_refund"
  | "approval"
  | "suspension"
  | "account"
  | "new_subscription"
  | "support"
  | "broadcast";

interface TestDef {
  event: NotifyEvent;
  tone?: NotifyTone;
  href: string;
  params: NotifyParams;
}

/**
 * Sample data per test. Amounts in XAF, references look like the real ones
 * (CMD-/RES- + 6 chars) so the delivered copy reads exactly as it would in
 * production. href is the page the real recipient would land on.
 */
const TESTS: Record<NotifyTestKey, TestDef> = {
  new_order: {
    event: "new_order",
    tone: "success",
    href: "/m/orders",
    params: { reference: "CMD-TEST01", customerName: "Test Client", amount: 8500 },
  },
  order_status: {
    event: "order_status",
    href: "/orders",
    params: { status: "confirmed", reference: "CMD-TEST01", restaurantName: "Test Restaurant", deliveryFee: 1000 },
  },
  cancelled_by_customer: {
    event: "order_cancelled",
    tone: "warning",
    href: "/m/orders",
    params: { reference: "CMD-TEST01", cancelledBy: "customer" },
  },
  cancelled_by_restaurant: {
    event: "order_cancelled",
    tone: "error",
    href: "/orders",
    params: { reference: "CMD-TEST01", restaurantName: "Test Restaurant", cancelledBy: "restaurant", reason: "Stock épuisé" },
  },
  low_stock: {
    event: "low_stock",
    tone: "warning",
    href: "/m/menu",
    params: { itemName: "Poulet DG", count: 2 },
  },
  loyalty: {
    event: "loyalty",
    tone: "success",
    href: "/loyalty",
    params: { points: 50, reference: "CMD-TEST01" },
  },
  reservation: {
    event: "reservation",
    href: "/m/reservations",
    params: { reference: "RES-TEST01", customerName: "Test Client", partySize: 4 },
  },
  reservation_confirmed: {
    event: "reservation_decision",
    tone: "success",
    href: "/reservations",
    params: { status: "confirmed", reference: "RES-TEST01", restaurantName: "Test Restaurant" },
  },
  reservation_declined: {
    event: "reservation_decision",
    tone: "error",
    href: "/reservations",
    params: { status: "cancelled", reference: "RES-TEST01", restaurantName: "Test Restaurant", reason: "Complet" },
  },
  review: {
    event: "review",
    href: "/m/reviews",
    params: { rating: 4, customerName: "Test Client" },
  },
  review_reply: {
    event: "review_reply",
    href: "/reviews",
    params: { restaurantName: "Test Restaurant", reply: "Merci pour votre avis !" },
  },
  moderation: {
    event: "moderation",
    tone: "warning",
    href: "/a/reviews",
    params: { restaurantName: "Test Restaurant", rating: 2 },
  },
  billing: {
    event: "billing",
    href: "/m/billing",
    params: { detail: "Votre plan passe à Business à partir du mois prochain." },
  },
  billing_paid: {
    event: "billing_paid",
    tone: "success",
    href: "/m/billing",
    params: { invoiceNumber: "INV-2026-001", amount: 25000 },
  },
  billing_refund: {
    event: "billing_refund",
    href: "/m/billing",
    params: { reference: "INV-2026-001", amount: 5000, reason: "Test de remboursement" },
  },
  approval: {
    event: "approval",
    tone: "success",
    href: "/m",
    params: { restaurantName: "Test Restaurant", status: "active" },
  },
  suspension: {
    event: "approval",
    tone: "error",
    href: "/m",
    params: { restaurantName: "Test Restaurant", status: "suspended" },
  },
  account: {
    event: "account",
    tone: "success",
    href: "/a/users",
    params: { status: "active" },
  },
  new_subscription: {
    event: "new_subscription",
    href: "/a/subscriptions",
    params: { restaurantName: "Test Restaurant", planName: "Business" },
  },
  support: {
    event: "support",
    href: "/a/support",
    params: { customerName: "Test Client", subject: "Problème de paiement" },
  },
  broadcast: {
    event: "broadcast",
    href: "/a/notifications",
    params: { subject: "Test broadcast", bodyText: "Ceci est un message de test de la plateforme." },
  },
};

export interface NotifyTestResult {
  ok: boolean;
  message: string;
}

/**
 * Which delivery channels a test should exercise. Bell and Realtime are the
 * SAME in-app row — Realtime is that row arriving live (toast + sound) while
 * the tab is open. They are offered separately because that is how the two
 * failure modes present: "the badge never bumped" vs "no toast played".
 *
 * This is a type only — a "use server" file cannot export runtime values,
 * so the default object lives in the client component that renders the chips.
 */
export interface NotifyTestChannels {
  /** Write the in-app row — the bell badge and its list. */
  bell: boolean;
  /** The same row arriving live: toast + sound while this tab is open. */
  realtime: boolean;
  /** SMTP email. */
  email: boolean;
  /** Native browser push — needs a subscribed device + HTTPS. */
  push: boolean;
}

/**
 * Deliver one test notification to the signed-in admin — restricted to the
 * channels the tester asked for, by the same preference rules as production.
 */
export async function sendTestNotification(
  key: NotifyTestKey,
  channels?: NotifyTestChannels,
): Promise<NotifyTestResult> {
  const admin = await requireRole("admin");

  const def = TESTS[key];
  if (!def) return { ok: false, message: "Unknown test." };

  const c = channels ?? { bell: true, realtime: true, email: true, push: true };
  const inApp = c.bell || c.realtime;
  if (!inApp && !c.email && !c.push) {
    return { ok: false, message: "Pick at least one channel to test." };
  }

  const result = await notify({
    event: def.event,
    tone: def.tone,
    profileId: admin.id,
    href: def.href,
    params: def.params,
    channels: { inApp, email: c.email, push: c.push },
  });

  const via: string[] = [];
  if (inApp) {
    via.push(c.bell && c.realtime ? "bell + realtime toast" : c.bell ? "bell" : "realtime toast");
  }
  if (c.email) via.push("email");
  if (c.push) via.push("web push");

  // It really did go out — audited like the email test (§9).
  await writeAudit(admin, {
    action: "notification.test",
    entityType: "settings",
    summary: `Test notification ${key} (${via.join(" + ")}) to ${admin.email} — ${result.delivered} in-app row`,
  });

  if (inApp && result.delivered === 0) {
    return { ok: false, message: "Nothing was delivered — no active profile matched." };
  }

  const notes: string[] = [];
  if (c.push) notes.push("web push fires only if a device is subscribed on this browser over HTTPS");
  if (c.email) notes.push("email fires only if SMTP is configured");
  if (inApp) notes.push("the in-app row carries the same copy, tone and deep link a real event would produce");

  return {
    ok: true,
    message: `Delivered via ${via.join(", ")}. ${notes.join("; ")}.`,
  };
}
