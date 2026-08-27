import { NextResponse } from "next/server";
import { runReconciliation } from "@/lib/payments/reconcile";
import { requireCronAuth, stampHeartbeat } from "@/lib/cron";

/**
 * The payment reconciler's trigger — the route half a dozen comments and
 * the admin UI referred to and that never existed.
 *
 * The settlement design DEPENDS on this sweep: initiatePaymentAttempt
 * leaves transport-failure attempts pending "for the reconciler's
 * abandonment horizon", the webhook swallows its own errors "because the
 * reconciler sweeps anything left unsettled", and /a/payments tells the
 * admin stuck rows are "swept every 10 min". Until this route was
 * scheduled, all three statements were false: a customer who approved on
 * the handset after closing the tab, whose callback was lost, stayed
 * unsettled forever.
 *
 * Scheduled every 10 minutes by vercel.json. The heartbeat it stamps is
 * what /a/health reads for `lastReconcilerRun` — previously a fixture.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  const summary = await runReconciliation();
  await stampHeartbeat("reconciler", summary);

  return NextResponse.json(summary);
}
