import { describe, expect, it } from "vitest";
import { isManagerOrderHref, nextRingStart, ringingOrders, soonestDeadline } from "./pending-alarm";
import { SCHEDULED_LEAD_MINUTES } from "./deadline";

const T0 = Date.parse("2026-09-25T12:00:00Z");
const min = (n: number) => n * 60_000;
const at = (ms: number) => new Date(ms).toISOString();

describe("pending-order alarm", () => {
  it("rings for an ASAP order from placement until its deadline", () => {
    const order = { id: "a", createdAt: at(T0), scheduledFor: null };
    expect(ringingOrders([order], 15, T0)).toHaveLength(1);
    expect(ringingOrders([order], 15, T0 + min(14))).toHaveLength(1);
    // Past the time limit the sweep cancels it — the alarm stops asking.
    expect(ringingOrders([order], 15, T0 + min(15))).toHaveLength(0);
  });

  it("does not ring for a pre-order until its accept window opens", () => {
    const slot = T0 + min(24 * 60);
    const order = { id: "p", createdAt: at(T0), scheduledFor: at(slot) };
    expect(ringingOrders([order], 15, T0)).toHaveLength(0);
    const opens = slot - min(SCHEDULED_LEAD_MINUTES);
    expect(nextRingStart([order], 15, T0)).toBe(opens);
    expect(ringingOrders([order], 15, opens)).toHaveLength(1);
    expect(nextRingStart([order], 15, opens)).toBeNull();
  });

  it("orders the ring list and the deadline by urgency", () => {
    const older = { id: "old", createdAt: at(T0), scheduledFor: null };
    const newer = { id: "new", createdAt: at(T0 + min(5)), scheduledFor: null };
    const now = T0 + min(6);
    expect(ringingOrders([newer, older], 15, now).map((o) => o.id)).toEqual(["old", "new"]);
    expect(soonestDeadline([newer, older], 15, now)?.getTime()).toBe(T0 + min(15));
    expect(soonestDeadline([], 15, now)).toBeNull();
  });

  it("recognises order links and nothing else", () => {
    expect(isManagerOrderHref("/m/orders/123")).toBe(true);
    expect(isManagerOrderHref("/m/orders")).toBe(true);
    expect(isManagerOrderHref("/m/orders?x=1")).toBe(true);
    expect(isManagerOrderHref("/m/ordersheet")).toBe(false);
    expect(isManagerOrderHref("/orders/123")).toBe(false);
    expect(isManagerOrderHref(null)).toBe(false);
  });
});

import { audibleOrders, nextRingInterval, ringIntervalMs, SEEN_PAUSE_MS } from "./pending-alarm";

describe("ring rhythm", () => {
  it("escalates 10 s → 5 s → 3 s with the wait", () => {
    expect(ringIntervalMs(0)).toBe(10_000);
    expect(ringIntervalMs(2 * 60_000)).toBe(10_000);
    expect(ringIntervalMs(3 * 60_000)).toBe(5_000);
    expect(ringIntervalMs(9 * 60_000)).toBe(5_000);
    expect(ringIntervalMs(10 * 60_000)).toBe(3_000);
  });

  it("pauses seen orders for three minutes, never new ones", () => {
    const now = Date.parse("2026-09-25T12:10:00Z");
    const a = { id: "a", createdAt: "2026-09-25T12:00:00Z", scheduledFor: null };
    const b = { id: "b", createdAt: "2026-09-25T12:09:00Z", scheduledFor: null };
    const seen = new Map([["a", now - 60_000]]);
    expect(audibleOrders([a, b], seen, now).map((o) => o.id)).toEqual(["b"]);
    expect(audibleOrders([a, b], seen, now - 60_000 + SEEN_PAUSE_MS).map((o) => o.id)).toEqual(["a", "b"]);
  });

  it("rings at the pace of the longest-waiting audible order", () => {
    const now = Date.parse("2026-09-25T12:10:00Z");
    const old = { id: "a", createdAt: "2026-09-25T11:59:00Z", scheduledFor: null };
    const fresh = { id: "b", createdAt: "2026-09-25T12:09:30Z", scheduledFor: null };
    expect(nextRingInterval([old, fresh], 15, now)).toBe(3_000);
    expect(nextRingInterval([fresh], 15, now)).toBe(10_000);
    expect(nextRingInterval([], 15, now)).toBeNull();
  });
});
