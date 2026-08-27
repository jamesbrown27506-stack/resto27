import { NextResponse } from "next/server";
import { runSubscriptionExpiry } from "@/lib/data/subscription-lifecycle";
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
  await stampHeartbeat("subscription-expiry", summary);

  return NextResponse.json(summary);
}
