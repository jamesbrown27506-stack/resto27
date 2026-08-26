import { describe, expect, it } from "vitest";
import {
  floorIsUnmanaged,
  fullSlots,
  seatableTables,
  slotIsFull,
  slotWindow,
  SLOT_WINDOW_AFTER_MIN,
  SLOT_WINDOW_BEFORE_MIN,
} from "./availability";

/**
 * These assertions ARE the contract between the booking form and the server.
 *
 * The form greys a slot out and `createOwnReservation` refuses one, and both
 * now call this module — so a change here that loosens the rule silently
 * oversells the dining room, and one that tightens it silently loses bookings
 * the restaurant could have taken. Neither shows up in a type check.
 */

const at = (iso: string) => new Date(iso);

describe("seatableTables", () => {
  const floor = [
    { capacity: 2, status: "free" },
    { capacity: 4, status: "free" },
    { capacity: 8, status: "out_of_service" },
    { capacity: 6, status: "occupied" },
  ];

  it("counts only tables big enough for the party", () => {
    expect(seatableTables(floor, 2)).toBe(3); // the 2, 4 and 6 tops
    expect(seatableTables(floor, 5)).toBe(1); // only the 6 top
  });

  it("never counts an out-of-service table, however big", () => {
    // The 8-top would fit a party of eight; it is not capacity.
    expect(seatableTables(floor, 8)).toBe(0);
  });

  it("counts an OCCUPIED table — it is capacity, just busy right now", () => {
    // Whether it is free at 20:00 is the overlap question, not this one.
    expect(seatableTables([{ capacity: 4, status: "occupied" }], 4)).toBe(1);
  });
});

describe("floorIsUnmanaged", () => {
  it("is true when no tables are configured", () => {
    // A walk-in place must not have its bookings refused by a floor plan
    // nobody filled in.
    expect(floorIsUnmanaged([])).toBe(true);
  });

  it("is false the moment there is a floor", () => {
    expect(floorIsUnmanaged([{ capacity: 2, status: "free" }])).toBe(false);
  });
});

describe("slotWindow", () => {
  it("holds the table from before the sitting to after it", () => {
    const w = slotWindow(at("2026-09-01T19:00:00.000Z"));
    expect(w.start).toBe("2026-09-01T18:30:00.000Z");
    expect(w.end).toBe("2026-09-01T20:30:00.000Z");
    expect(SLOT_WINDOW_BEFORE_MIN).toBe(30);
    expect(SLOT_WINDOW_AFTER_MIN).toBe(90);
  });
});

describe("slotIsFull", () => {
  const floor = [
    { capacity: 4, status: "free" },
    { capacity: 4, status: "free" },
  ];

  it("is never full where no floor is configured", () => {
    const many = Array.from({ length: 50 }, () => at("2026-09-01T19:00:00.000Z"));
    expect(slotIsFull(at("2026-09-01T19:00:00.000Z"), many, [], 4)).toBe(false);
  });

  it("is full when no table can seat the party at all", () => {
    // A different refusal from "that hour is taken", and the caller says so
    // differently — but from the grid's point of view the slot is unusable.
    expect(slotIsFull(at("2026-09-01T19:00:00.000Z"), [], floor, 9)).toBe(true);
  });

  it("fills once holding bookings reach capacity", () => {
    const slot = at("2026-09-01T19:00:00.000Z");
    expect(slotIsFull(slot, [at("2026-09-01T19:00:00.000Z")], floor, 4)).toBe(false);
    expect(
      slotIsFull(slot, [at("2026-09-01T19:00:00.000Z"), at("2026-09-01T19:30:00.000Z")], floor, 4),
    ).toBe(true);
  });

  it("counts a booking that merely OVERLAPS the window", () => {
    const slot = at("2026-09-01T19:00:00.000Z");
    // 18:30 and 20:30 are the window's edges and both count; 18:29 does not.
    expect(slotIsFull(slot, [at("2026-09-01T18:30:00.000Z"), at("2026-09-01T20:30:00.000Z")], floor, 4)).toBe(true);
    expect(slotIsFull(slot, [at("2026-09-01T18:29:00.000Z"), at("2026-09-01T20:31:00.000Z")], floor, 4)).toBe(false);
  });

  it("gets fuller as the party grows, because fewer tables fit it", () => {
    const mixed = [
      { capacity: 2, status: "free" },
      { capacity: 6, status: "free" },
    ];
    const slot = at("2026-09-01T19:00:00.000Z");
    const one = [at("2026-09-01T19:00:00.000Z")];
    // Two tables fit a couple, so one booking does not fill the hour…
    expect(slotIsFull(slot, one, mixed, 2)).toBe(false);
    // …but only the 6-top fits a party of five, and it is taken.
    expect(slotIsFull(slot, one, mixed, 5)).toBe(true);
  });
});

describe("fullSlots", () => {
  const floor = [{ capacity: 4, status: "free" }];
  const toInstant = (slot: string) => at(`2026-09-01T${slot}:00.000Z`);

  it("names only the slots that cannot be taken", () => {
    const holding = [at("2026-09-01T19:00:00.000Z")];
    const full = fullSlots(["12:00", "18:30", "19:00", "21:00"], toInstant, holding, floor, 4);
    // 18:30 and 19:00 fall inside the one booking's window; 12:00 and 21:00 do not.
    expect(full).toEqual(["18:30", "19:00"]);
  });

  it("returns nothing at all for an unmanaged floor", () => {
    expect(fullSlots(["19:00"], toInstant, [at("2026-09-01T19:00:00.000Z")], [], 4)).toEqual([]);
  });
});
