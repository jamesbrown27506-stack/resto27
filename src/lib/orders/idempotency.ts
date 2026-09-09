/**
 * The idempotency key for a checkout attempt, kept across reloads.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY IT IS STORED AND NOT JUST HELD IN STATE.
 *
 *  Disabling the submit button stops a double-tap. It cannot stop the failure
 *  that dominates on an unreliable connection: the request arrives, the order
 *  is created, and the RESPONSE is lost. The customer sees a spinner that
 *  never resolves, reloads the page, sees no order, and orders again.
 *
 *  By then the component has been remounted and any key held in React state
 *  is gone — so a key that lives only in state protects against exactly the
 *  case that was never the problem. Session storage survives the reload, so
 *  the retry carries the same key and the server returns the original order.
 *
 *  Cleared on success, so the next basket is a genuinely new order and a
 *  customer ordering the same meal twice in an evening is never blocked.
 *
 *  Every access is wrapped: Safari private mode throws on sessionStorage, and
 *  a checkout must not fail because a storage quota did. Losing the key
 *  degrades to the old behaviour rather than breaking the order.
 * ─────────────────────────────────────────────────────────────────────────
 */

const STORAGE_KEY = "resto237:checkout-idempotency";

function newKey(): string {
  // randomUUID needs a secure context; every browser that lacks it still has
  // getRandomValues, and the fallback keeps the same shape so the server's
  // UUID check passes either way.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The key for the attempt in progress, creating and storing one if needed. */
export function currentIdempotencyKey(): string {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) return stored;
    const fresh = newKey();
    sessionStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // Storage unavailable — still send a key, so at least the in-page retry
    // and the server-side race are covered.
    return newKey();
  }
}

/** Called once an order exists: the next basket starts a new attempt. */
export function clearIdempotencyKey(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do — a key we cannot clear expires with the tab.
  }
}
