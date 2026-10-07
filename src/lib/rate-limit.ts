import { headers } from "next/headers";

/**
 * Rate limiter for server actions — shared through the DATABASE (0074).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY IT LEFT MEMORY.
 *
 *  It used to be a per-process Map. On Vercel every request can land on a
 *  different, short-lived instance, so "5 sign-ins per 5 minutes" was really
 *  "5 per instance" — and a cold start forgot everything. For a 6-digit reset
 *  code or a 4-character table join code that is barely a limit at all.
 *
 *  Now every call increments one row per key per window in Postgres
 *  (`rate_limit_hit`, atomic), so every instance sees the same count. The
 *  window is FIXED (it resets on the boundary) rather than sliding: simpler,
 *  one row per key, and at worst it lets 2× the limit straddle a boundary.
 *
 *  FALLS BACK TO MEMORY when the database cannot answer (0074 not run, no
 *  credentials in tests, an outage) — a limiter that blocked every sign-in
 *  because its own table was missing would be the attack it guards against.
 *  The call sites only ever see `{ ok, retryAfterMs }`.
 *
 *  IDENTIFIER: signed-in callers pass their profile id — a suspended account
 *  must not be able to keep hammering behind a rotating IP. Anonymous callers
 *  fall back to the client IP: `x-real-ip` (set by Vercel's edge, not by the
 *  client), then the first x-forwarded-for hop.
 * ─────────────────────────────────────────────────────────────────────────
 */

const store = new Map<string, number[]>();
// Opportunistic sweep threshold — prevents the map growing without bound.
const SWEEP_AT = 5000;

async function ipIdentifier(): Promise<string> {
  try {
    const h = await headers();
    const real = h.get("x-real-ip");
    if (real) return `ip:${real.trim()}`;
    const fwd = h.get("x-forwarded-for");
    if (fwd) return `ip:${fwd.split(",")[0]!.trim()}`;
    return "ip:unknown";
  } catch {
    // headers() throws outside a request scope (build-time render) — fail open.
    return "ip:unknown";
  }
}

export interface RateLimitResult {
  ok: boolean;
  /** Milliseconds until the window clears, for a "try again later" message. */
  retryAfterMs: number;
}

/** The per-process fallback: a sliding window that does not record refusals. */
function memoryLimit(mapKey: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();

  let timestamps = store.get(mapKey) ?? [];
  // Drop everything older than the window.
  timestamps = timestamps.filter((t) => now - t < windowMs);

  if (timestamps.length >= limit) {
    const oldest = timestamps[0]!;
    return { ok: false, retryAfterMs: windowMs - (now - oldest) };
  }

  timestamps.push(now);
  store.set(mapKey, timestamps);

  if (store.size > SWEEP_AT) {
    for (const [k, v] of store) {
      const fresh = v.filter((t) => now - t < windowMs);
      if (fresh.length === 0) store.delete(k);
      else store.set(k, fresh);
    }
  }

  return { ok: true, retryAfterMs: 0 };
}

/** Remembers, per process, that the shared table is missing — one failed call, not one per request. */
let sharedUnavailableUntil = 0;

/** The shared count, or null when the database cannot give one. */
async function sharedLimit(mapKey: string, limit: number, windowMs: number): Promise<RateLimitResult | null> {
  if (!process.env.SUPABASE_SECRET_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  if (Date.now() < sharedUnavailableUntil) return null;

  try {
    // Imported lazily: the unit tests (no credentials) never load a client.
    const { createAdminClient } = await import("@/lib/supabase/server");
    const { data, error } = await createAdminClient().rpc("rate_limit_hit", {
      p_key: mapKey,
      p_limit: limit,
      p_window_ms: windowMs,
    });
    if (error) {
      // Not deployed yet (0074): stop asking for ten minutes.
      if (error.code === "PGRST202" || error.code === "42883" || error.code === "42P01") {
        sharedUnavailableUntil = Date.now() + 10 * 60_000;
      } else {
        console.error("[rate-limit] shared count failed", error.code ?? "", error.message);
      }
      return null;
    }
    const row = (Array.isArray(data) ? data[0] : data) as { allowed?: boolean; retry_after_ms?: number } | null;
    if (!row || typeof row.allowed !== "boolean") return null;
    return { ok: row.allowed, retryAfterMs: row.allowed ? 0 : Math.max(0, Number(row.retry_after_ms ?? 0)) };
  } catch (error) {
    console.error("[rate-limit] shared count threw", error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Allow `limit` calls per `windowMs`, keyed by `key` + identifier.
 */
export async function rateLimit(opts: {
  /** What is being limited — "auth:signin", "chat:send", "checkout:place". */
  key: string;
  limit: number;
  windowMs: number;
  /** Signed-in callers pass their profile id; anonymous callers omit it. */
  identifier?: string;
  /** Sensitive operations must not become unlimited across server instances. */
  failClosed?: boolean;
}): Promise<RateLimitResult> {
  const id = opts.identifier ?? (await ipIdentifier());
  const mapKey = `${opts.key}:${id}`;

  const shared = await sharedLimit(mapKey, opts.limit, opts.windowMs);
  if (shared) return shared;
  const sensitive = /^(auth|wallet|security|admins|payouts):/.test(opts.key);
  if (opts.failClosed || (sensitive && process.env.NODE_ENV === "production")) {
    return { ok: false, retryAfterMs: 60_000 };
  }
  return memoryLimit(mapKey, opts.limit, opts.windowMs);
}
