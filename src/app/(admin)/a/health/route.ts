import { NextResponse } from "next/server";

/**
 * Public health endpoint (§14.5) — JSON, not a screen.
 *
 * The `lastReconcilerRun` field is the point of this route. `pg_net` is
 * fire-and-forget and will never tell you the sweep failed (B.3), so the only
 * way to notice a reconciler that stopped three weeks ago is to surface its
 * last run somewhere a monitor can poll. A reconciler you believe is running
 * but isn't is worse than no reconciler at all.
 *
 * Fixture values until P6 wires the real checks.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const checks = {
    database: { ok: true, latencyMs: 12 },
    gateway: { ok: true, latencyMs: 184 },
    storage: { ok: true },
  };

  // Fixture: 6 minutes ago. Real value comes from the row the reconciler
  // stamps on every pass.
  const lastReconcilerRun = new Date(Date.now() - 6 * 60_000).toISOString();

  // Stale if the 10-minute sweep has not reported in over 30 minutes.
  const reconcilerStale = Date.now() - new Date(lastReconcilerRun).getTime() > 30 * 60_000;

  const healthy = Object.values(checks).every((c) => c.ok) && !reconcilerStale;

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
