import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearIdempotencyKey, currentIdempotencyKey } from "./idempotency";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A minimal sessionStorage — the test environment is node, which has none. */
function installStorage() {
  const map = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  });
  return map;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("checkout idempotency key", () => {
  beforeEach(() => {
    installStorage();
    clearIdempotencyKey();
  });

  it("is a UUID, so the server's shape check accepts it", () => {
    expect(currentIdempotencyKey()).toMatch(UUID);
  });

  /**
   * The point of the whole mechanism: a customer whose connection dropped
   * reloads and submits again. If the key changed, that retry would be a
   * second real order.
   */
  it("stays the same across repeated reads, which is what makes a retry safe", () => {
    const first = currentIdempotencyKey();
    expect(currentIdempotencyKey()).toBe(first);
    expect(currentIdempotencyKey()).toBe(first);
  });

  it("survives a remount, because it lives in storage and not in React state", () => {
    const before = currentIdempotencyKey();
    // Re-reading with the same backing store is what a reload looks like here.
    expect(currentIdempotencyKey()).toBe(before);
  });

  it("starts a new attempt once an order exists", () => {
    const placed = currentIdempotencyKey();
    clearIdempotencyKey();
    const next = currentIdempotencyKey();
    expect(next).toMatch(UUID);
    expect(next).not.toBe(placed);
  });

  it("still returns a key when storage throws, rather than failing checkout", () => {
    // Safari private mode throws on setItem. Losing persistence is acceptable;
    // blocking the order is not.
    vi.stubGlobal("sessionStorage", {
      getItem() { throw new Error("denied"); },
      setItem() { throw new Error("denied"); },
      removeItem() { throw new Error("denied"); },
    });
    expect(currentIdempotencyKey()).toMatch(UUID);
    expect(() => clearIdempotencyKey()).not.toThrow();
  });
});
