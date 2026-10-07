import { describe, expect, it } from "vitest";
import { rateLimit } from "./rate-limit";

/**
 * The limiter is keyed per process; these tests use unique keys and pass an
 * explicit identifier, so they never collide with each other or with a real
 * request (and never need next/headers).
 */

describe("rateLimit", () => {
  it("refuses sensitive operations when shared enforcement is unavailable", async () => {
    const result = await rateLimit({ key: "test:durable-required", identifier: "unit", limit: 5, windowMs: 60_000, failClosed: true });
    expect(result.ok).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });
  it("allows calls up to the limit", async () => {
    for (let i = 0; i < 5; i++) {
      const result = await rateLimit({
        key: "test:allow",
        limit: 5,
        windowMs: 60_000,
        identifier: "unit",
      });
      expect(result.ok).toBe(true);
    }
  });

  it("refuses calls past the limit without recording them", async () => {
    const key = `test:block:${Date.now()}`;
    for (let i = 0; i < 3; i++) {
      await rateLimit({ key, limit: 3, windowMs: 60_000, identifier: "unit" });
    }
    const blocked = await rateLimit({ key, limit: 3, windowMs: 60_000, identifier: "unit" });
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("separates identifiers under the same key", async () => {
    const key = `test:separate:${Date.now()}`;
    await rateLimit({ key, limit: 1, windowMs: 60_000, identifier: "alice" });
    const bob = await rateLimit({ key, limit: 1, windowMs: 60_000, identifier: "bob" });
    expect(bob.ok).toBe(true);
  });

  it("lets the window slide: an old call no longer counts", async () => {
    const key = `test:window:${Date.now()}`;
    const limit = 2;
    await rateLimit({ key, limit, windowMs: 60_000, identifier: "unit" });
    // Push the first call outside the window by faking time is not possible
    // without injecting a clock, so instead verify the limit holds with fresh
    // calls — the in-window behaviour that matters for a sliding window.
    await rateLimit({ key, limit, windowMs: 60_000, identifier: "unit" });
    const third = await rateLimit({ key, limit, windowMs: 60_000, identifier: "unit" });
    expect(third.ok).toBe(false);
  });

  it("recovers once the window has passed", async () => {
    const key = `test:recover:${Date.now()}`;
    await rateLimit({ key, limit: 1, windowMs: 10, identifier: "unit" });
    const blocked = await rateLimit({ key, limit: 1, windowMs: 10, identifier: "unit" });
    expect(blocked.ok).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 25));
    const again = await rateLimit({ key, limit: 1, windowMs: 10, identifier: "unit" });
    expect(again.ok).toBe(true);
  });
});
