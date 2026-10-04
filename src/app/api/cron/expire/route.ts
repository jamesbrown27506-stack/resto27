import { NextResponse } from "next/server";
import { runSubscriptionExpiry } from "@/lib/data/subscription-lifecycle";
import { runScheduledPayouts, sweepRateLimits } from "@/lib/wallet/scheduled-payouts";
import { requireCronAuth, stampHeartbeat } from "@/lib/cron";

/**
 * Subscription lifecycle — the daily pass subscription-lifecycle.ts was
 * written for ("called by /api/cron/expire and by nothing else") and that
 * nothing ever called: the 7/3/1-day reminder ladder, grace handling, and
 * expiry notices all existed as dead code until this route was scheduled.
 *
 * Daily via vercel.json; the run is idempotent (the module dedupes its own
 * reminders), so a manual re-trigger is always safe.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  const summary = await runSubscriptionExpiry();
  // The nightly money jobs ride on the one daily cron (no new schedule to
  // gate in SQL, no extra Vercel call): Enterprise scheduled payouts, and
  // the sweep of spent rate-limit windows (0074).
  const payouts = await runScheduledPayouts();
  await sweepRateLimits();
  await stampHeartbeat("subscription-expiry", { ...summary, payouts });

  return NextResponse.json({ ...summary, payouts });
}
