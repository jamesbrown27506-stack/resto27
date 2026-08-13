import { headers } from "next/headers";

/**
 * In-memory sliding-window rate limiter for server actions.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY IN MEMORY, AND WHY THAT IS ENOUGH.
 *
 *  A per-process Map is not shared across instances and forgets everything on
 *  restart. That is fine for this app's threat model: the actions it guards
 *  (auth, checkout, chat, broadcast) are not a distributed-consensus problem,
 *  and a limiter that slows an attacker to a crawl per instance is a limiter.
 *  A Redis-backed version is a drop-in upgrade later — the call sites only
 *  see `{ ok, retryAfterMs }`.
 *
 *  IDENTIFIER: signed-in callers pass their profile id — a suspended account
 *  must not be able to keep hammering behind a rotating IP. Anonymous callers
 *  (auth, the contact form) fall back to the first x-forwarded-for hop, which
 *  the proxy controls.
 * ─────────────────────────────────────────────────────────────────────────
 */

const store = new Map<string, number[]>();
// Opportunistic sweep threshold — prevents the map growing without bound.
const SWEEP_AT = 5000;

async function ipIdentifier(): Promise<string> {
  try {
    const h = await headers();
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

/**
 * Allow `limit` calls per `windowMs`, keyed by `key` + identifier.
 * Returns ok=false once the window is full, without recording the call.
 */
export async function rateLimit(opts: {
  /** What is being limited — "auth:signin", "chat:send", "checkout:place". */
  key: string;
  limit: number;
  windowMs: number;
  /** Signed-in callers pass their profile id; anonymous callers omit it. */
  identifier?: string;
}): Promise<RateLimitResult> {
  const id = opts.identifier ?? (await ipIdentifier());
  const mapKey = `${opts.key}:${id}`;
  const now = Date.now();

  let timestamps = store.get(mapKey) ?? [];
  // Drop everything older than the window.
  timestamps = timestamps.filter((t) => now - t < opts.windowMs);

  if (timestamps.length >= opts.limit) {
    const oldest = timestamps[0]!;
    return { ok: false, retryAfterMs: opts.windowMs - (now - oldest) };
  }

  timestamps.push(now);
  store.set(mapKey, timestamps);

  if (store.size > SWEEP_AT) {
    for (const [k, v] of store) {
      const fresh = v.filter((t) => now - t < opts.windowMs);
      if (fresh.length === 0) store.delete(k);
      else store.set(k, fresh);
    }
  }

  return { ok: true, retryAfterMs: 0 };
}
