import { describe, expect, it } from "vitest";
import {
  canMarkNoShowYet,
  deadlinePassed,
  halfwayReached,
  holdsTableNow,
  noShowAllowedFrom,
  paymentHoldDeadline,
  requestAnswerDeadline,
  sittingEnd,
} from "./timing";

/**
 * The board shows these instants and the reservation clock enforces them, so
 * a change here moves both at once — which is the point, and why each rule is
 * pinned by the sentence the product owner used for it.
 */

const iso = (s: string) => new Date(s).toISOString();

describe("requestAnswerDeadline", () => {
  it("is the admin's limit after creation when the slot is far away", () => {
    const d = requestAnswerDeadline(
      { createdAt: "2026-09-25T08:00:00Z", reservedFor: "2026-09-26T19:00:00Z" },
      120,
    );
    expect(d?.toISOString()).toBe(iso("2026-09-25T10:00:00Z"));
  });

  it("is one hour before the slot when that comes first", () => {
    const d = requestAnswerDeadline(
      { createdAt: "2026-09-25T17:00:00Z", reservedFor: "2026-09-25T19:00:00Z" },
      120,
    );
    expect(d?.toISOString()).toBe(iso("2026-09-25T18:00:00Z"));
  });

  it("still leaves a short window for a last-minute request, never past the slot", () => {
    // 40 minutes out: the one-hour cutoff is already behind us.
    const d = requestAnswerDeadline(
      { createdAt: "2026-09-25T18:20:00Z", reservedFor: "2026-09-25T19:00:00Z" },
      120,
    );
    expect(d?.toISOString()).toBe(iso("2026-09-25T18:35:00Z"));

    const tight = requestAnswerDeadline(
      { createdAt: "2026-09-25T18:55:00Z", reservedFor: "2026-09-25T19:00:00Z" },
      120,
    );
    expect(tight?.toISOString()).toBe(iso("2026-09-25T19:00:00Z"));
  });

  it("returns null on unreadable input rather than expiring the row", () => {
    expect(requestAnswerDeadline({ createdAt: "nope", reservedFor: "2026-09-25T19:00:00Z" }, 120)).toBeNull();
  });
});

describe("paymentHoldDeadline", () => {
  it("holds an accepted, unpaid table for one hour after the decision", () => {
    const d = paymentHoldDeadline({
      decidedAt: "2026-09-25T09:00:00Z",
      createdAt: "2026-09-25T08:00:00Z",
      reservedFor: "2026-09-26T19:00:00Z",
    });
    expect(d?.toISOString()).toBe(iso("2026-09-25T10:00:00Z"));
  });

  it("releases one hour before the slot when that comes first", () => {
    const d = paymentHoldDeadline({
      decidedAt: "2026-09-25T17:30:00Z",
      createdAt: "2026-09-25T17:00:00Z",
      reservedFor: "2026-09-25T19:00:00Z",
    });
    expect(d?.toISOString()).toBe(iso("2026-09-25T18:00:00Z"));
  });

  it("falls back to the creation time when no decision was stamped", () => {
    const d = paymentHoldDeadline({
      decidedAt: null,
      createdAt: "2026-09-25T08:00:00Z",
      reservedFor: "2026-09-26T19:00:00Z",
    });
    expect(d?.toISOString()).toBe(iso("2026-09-25T09:00:00Z"));
  });
});

describe("deadlinePassed / halfwayReached", () => {
  const deadline = new Date("2026-09-25T10:00:00Z");

  it("passes exactly at the deadline", () => {
    expect(deadlinePassed(deadline, "2026-09-25T09:59:59Z")).toBe(false);
    expect(deadlinePassed(deadline, "2026-09-25T10:00:00Z")).toBe(true);
    expect(deadlinePassed(null, "2030-01-01T00:00:00Z")).toBe(false);
  });

  it("reminds once half the wait is gone", () => {
    expect(halfwayReached("2026-09-25T08:00:00Z", deadline, "2026-09-25T08:59:00Z")).toBe(false);
    expect(halfwayReached("2026-09-25T08:00:00Z", deadline, "2026-09-25T09:00:00Z")).toBe(true);
  });
});

describe("no-show grace", () => {
  it("allows a no-show only fifteen minutes after the booked time", () => {
    expect(noShowAllowedFrom("2026-09-25T19:00:00Z")?.toISOString()).toBe(iso("2026-09-25T19:15:00Z"));
    expect(canMarkNoShowYet("2026-09-25T19:00:00Z", "2026-09-25T19:14:59Z")).toBe(false);
    expect(canMarkNoShowYet("2026-09-25T19:00:00Z", "2026-09-25T19:15:00Z")).toBe(true);
  });
});

describe("floor hold", () => {
  const booking = { status: "confirmed", reservedFor: "2026-09-25T19:00:00Z", durationMin: 60 };

  it("shows the table reserved from 30 minutes before until the sitting ends", () => {
    expect(holdsTableNow(booking, "2026-09-25T18:29:00Z")).toBe(false);
    expect(holdsTableNow(booking, "2026-09-25T18:30:00Z")).toBe(true);
    expect(holdsTableNow(booking, "2026-09-25T19:59:00Z")).toBe(true);
    expect(holdsTableNow(booking, "2026-09-25T20:00:00Z")).toBe(false);
  });

  it("ignores pending and finished bookings", () => {
    expect(holdsTableNow({ ...booking, status: "pending" }, "2026-09-25T19:10:00Z")).toBe(false);
    expect(holdsTableNow({ ...booking, status: "completed" }, "2026-09-25T19:10:00Z")).toBe(false);
    expect(holdsTableNow({ ...booking, status: "awaiting_payment" }, "2026-09-25T19:10:00Z")).toBe(true);
    expect(holdsTableNow({ ...booking, status: "seated" }, "2026-09-25T19:10:00Z")).toBe(true);
  });

  it("ends the sitting after the booking's own duration", () => {
    expect(sittingEnd("2026-09-25T19:00:00Z", 90)?.toISOString()).toBe(iso("2026-09-25T20:30:00Z"));
  });
});
