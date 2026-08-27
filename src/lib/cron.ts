import "server-only";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * The two things every cron route needs: the bearer check and the heartbeat.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  AUTH. Vercel Cron sends `Authorization: Bearer $CRON_SECRET` on its own
 *  when that env var is set; pg_cron + pg_net (0034 §9) sends the same header
 *  from the `cron_secret` settings row. Either scheduler works against the
 *  same check. An unset CRON_SECRET fails CLOSED — a sweep that anyone on the
 *  internet can trigger is worse than one that does not run.
 *
 *  HEARTBEAT. Every sweep stamps ops_heartbeats (0044) when it finishes, and
 *  /a/health reads the stamps instead of fabricating them. A sweep you
 *  believe is running but is not is the exact failure mode the health
 *  endpoint exists to catch — the stamp is what makes that catchable.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** 401 response when the bearer is missing or wrong, null when authorized. */
export function requireCronAuth(request: Request): NextResponse | null {
  const authHeader = request.headers.get("authorization");
  const token = process.env.CRON_SECRET;
  if (!token || authHeader !== `Bearer ${token}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

/**
 * Record that a sweep ran. Never throws — a heartbeat that could fail the
 * sweep it describes would be measuring the wrong thing. On a database where
 * 0044 has not been applied the insert fails quietly with one log line.
 */
export async function stampHeartbeat(key: string, detail?: unknown): Promise<void> {
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("ops_heartbeats").upsert(
      {
        key,
        ran_at: new Date().toISOString(),
        detail: detail === undefined ? null : detail,
      },
      { onConflict: "key" },
    );
    if (error) console.error(`[cron:${key}] heartbeat not recorded —`, error.message);
  } catch (thrown) {
    console.error(`[cron:${key}] heartbeat threw —`, (thrown as Error)?.message ?? thrown);
  }
}

/** When a sweep last ran, or null when it never has (or 0044 is unapplied). */
export async function readHeartbeat(key: string): Promise<string | null> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("ops_heartbeats")
      .select("ran_at")
      .eq("key", key)
      .maybeSingle();
    if (error) return null;
    return (data as { ran_at: string } | null)?.ran_at ?? null;
  } catch {
    return null;
  }
}
