import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { readHeartbeat } from "@/lib/cron";

/**
 * Public health endpoint (§14.5) — JSON, not a screen.
 *
 * The `lastReconcilerRun` field is the point of this route. `pg_net` is
 * fire-and-forget and will never tell you the sweep failed (B.3), so the only
 * way to notice a reconciler that stopped three weeks ago is to surface its
 * last run somewhere a monitor can poll. A reconciler you believe is running
 * but isn't is worse than no reconciler at all.
 *
 * REAL CHECKS NOW, honest answers included. The previous version returned
 * fixtures — hardcoded `ok: true` and a fabricated reconciler timestamp six
 * minutes in the past — so a monitor pointed here stayed green through a
 * database outage and through the reconciler never having run at all, which
 * is precisely the failure the docblock above warns about. A reconciler
 * that has NEVER stamped a heartbeat reports stale, not healthy.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  // Database: one timed head-count on a small table via the admin client.
  const database: { ok: boolean; latencyMs?: number } = { ok: false };
  try {
    const supabase = createAdminClient();
    const startedAt = Date.now();
    const { error } = await supabase
      .from("settings")
      .select("key", { count: "exact", head: true })
      .limit(1);
    database.ok = !error;
    database.latencyMs = Date.now() - startedAt;
  } catch {
    // ok stays false.
  }

  // The gateway is deliberately not probed — a health poller that costs a
  // real CamerPay call per tick is a bill, not a check. Reported honestly
  // as unprobed rather than fabricated as fine.
  const checks = {
    database,
    gateway: { ok: null as boolean | null, note: "not probed" },
  };

  const lastReconcilerRun = await readHeartbeat("reconciler");

  // Stale if the 10-minute sweep has not reported in over 30 minutes —
  // and "never ran" (or 0044 unapplied) is the stalest answer of all.
  const reconcilerStale =
    lastReconcilerRun === null ||
    Date.now() - new Date(lastReconcilerRun).getTime() > 30 * 60_000;

  const healthy = database.ok && !reconcilerStale;

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      checks,
      lastReconcilerRun,
      reconcilerStale,
      timestamp: new Date().toISOString(),
    },
    {
      status: healthy ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}
