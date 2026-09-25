import { describe, expect, it } from "vitest";
import {
  floorIsUnmanaged,
  fullSlots,
  intervalsOverlap,
  lostInsertRace,
  normaliseDuration,
  overlapQueryRange,
  seatableTables,
  slotIsFull,
  type HoldingBooking,
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
const booking = (iso: string, durationMin: number | null = 60): HoldingBooking => ({
  start: at(iso),
  durationMin,
});

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

describe("normaliseDuration", () => {
  it("defaults to one hour and clamps to 15 minutes – 8 hours", () => {
    expect(normaliseDuration(undefined)).toBe(60);
    expect(normaliseDuration(null, 90)).toBe(90);
    expect(normaliseDuration("abc")).toBe(60);
    expect(normaliseDuration(5)).toBe(15);
    expect(normaliseDuration(900)).toBe(480);
    expect(normaliseDuration(75)).toBe(75);
  });
});

describe("intervalsOverlap", () => {
  const t = (iso: string) => Date.parse(iso);

  it("is a half-open overlap: back-to-back sittings do not collide", () => {
    // 19:00–20:00 and 20:00–21:00 share an edge, not a table.
    expect(intervalsOverlap(t("2026-09-01T19:00:00Z"), 60, t("2026-09-01T20:00:00Z"), 60)).toBe(false);
    // One minute longer and they do.
    expect(intervalsOverlap(t("2026-09-01T19:00:00Z"), 61, t("2026-09-01T20:00:00Z"), 60)).toBe(true);
  });

  it("is symmetric", () => {
    const a = t("2026-09-01T18:30:00Z");
    const b = t("2026-09-01T19:00:00Z");
    expect(intervalsOverlap(a, 60, b, 60)).toBe(true);
    expect(intervalsOverlap(b, 60, a, 60)).toBe(true);
  });
});

describe("slotIsFull", () => {
  const floor = [
    { capacity: 4, status: "free" },
    { capacity: 4, status: "free" },
  ];

  it("is never full where no floor is configured", () => {
    const many = Array.from({ length: 50 }, () => booking("2026-09-01T19:00:00.000Z"));
    expect(slotIsFull(at("2026-09-01T19:00:00.000Z"), 60, many, [], 4)).toBe(false);
  });

  it("is full when no table can seat the party at all", () => {
    // A different refusal from "that hour is taken", and the caller says so
    // differently — but from the grid's point of view the slot is unusable.
    expect(slotIsFull(at("2026-09-01T19:00:00.000Z"), 60, [], floor, 9)).toBe(true);
  });

  it("fills once overlapping bookings reach capacity", () => {
    const slot = at("2026-09-01T19:00:00.000Z");
    expect(slotIsFull(slot, 60, [booking("2026-09-01T19:00:00.000Z")], floor, 4)).toBe(false);
    expect(
      slotIsFull(slot, 60, [booking("2026-09-01T19:00:00.000Z"), booking("2026-09-01T19:30:00.000Z")], floor, 4),
    ).toBe(true);
  });

  it("uses each booking's OWN duration — a long sitting blocks a later slot", () => {
    const slot = at("2026-09-01T19:00:00.000Z");
    // Two bookings from 17:00: a one-hour one has left, a three-hour one has not.
    const short = [booking("2026-09-01T17:00:00.000Z", 60), booking("2026-09-01T17:00:00.000Z", 60)];
    const long = [booking("2026-09-01T17:00:00.000Z", 180), booking("2026-09-01T17:00:00.000Z", 180)];
    expect(slotIsFull(slot, 60, short, floor, 4)).toBe(false);
    expect(slotIsFull(slot, 60, long, floor, 4)).toBe(true);
  });

  it("uses the NEW sitting's duration forwards — a later booking only blocks if we would still be there", () => {
    const slot = at("2026-09-01T19:00:00.000Z");
    const later = [booking("2026-09-01T20:00:00.000Z"), booking("2026-09-01T20:00:00.000Z")];
    expect(slotIsFull(slot, 60, later, floor, 4)).toBe(false); // we leave at 20:00
    expect(slotIsFull(slot, 90, later, floor, 4)).toBe(true); // we are still eating at 20:00
  });

  it("falls back to the requested duration for a booking with none recorded", () => {
    const slot = at("2026-09-01T19:00:00.000Z");
    const legacy = [booking("2026-09-01T18:15:00.000Z", null), booking("2026-09-01T18:15:00.000Z", null)];
    expect(slotIsFull(slot, 60, legacy, floor, 4)).toBe(true); // 18:15–19:15 overlaps
    expect(slotIsFull(slot, 30, legacy, floor, 4)).toBe(false); // 18:15–18:45 does not
  });

  it("gets fuller as the party grows, because fewer tables fit it", () => {
    const mixed = [
      { capacity: 2, status: "free" },
      { capacity: 6, status: "free" },
    ];
    const slot = at("2026-09-01T19:00:00.000Z");
    const one = [booking("2026-09-01T19:00:00.000Z")];
    // Two tables fit a couple, so one booking does not fill the hour…
    expect(slotIsFull(slot, 60, one, mixed, 2)).toBe(false);
    // …but only the 6-top fits a party of five, and it is taken.
    expect(slotIsFull(slot, 60, one, mixed, 5)).toBe(true);
  });
});

describe("fullSlots", () => {
  const floor = [{ capacity: 4, status: "free" }];
  const toInstant = (slot: string) => at(`2026-09-01T${slot}:00.000Z`);

  it("names only the slots whose sitting would overlap a booking", () => {
    const holding = [booking("2026-09-01T19:00:00.000Z", 60)];
    const full = fullSlots(["12:00", "18:00", "18:30", "19:00", "19:30", "20:00"], toInstant, 60, holding, floor, 4);
    // 18:00–19:00 ends as the booking starts; 20:00 starts as it ends.
    expect(full).toEqual(["18:30", "19:00", "19:30"]);
  });

  it("returns nothing at all for an unmanaged floor", () => {
    expect(fullSlots(["19:00"], toInstant, 60, [booking("2026-09-01T19:00:00.000Z")], [], 4)).toEqual([]);
  });
});

describe("overlapQueryRange", () => {
  it("looks back the longest possible sitting and forward the new one", () => {
    const r = overlapQueryRange(at("2026-09-01T19:00:00.000Z"), at("2026-09-01T19:00:00.000Z"), 60);
    expect(r.start).toBe("2026-09-01T11:00:00.000Z");
    expect(r.end).toBe("2026-09-01T20:00:00.000Z");
  });
});

describe("lostInsertRace", () => {
  const floor = [{ capacity: 4, status: "free" }];
  const mine = {
    id: "b",
    createdAt: "2026-09-01T10:00:00.000Z",
    start: at("2026-09-01T19:00:00.000Z"),
    durationMin: 60,
  };

  it("withdraws only the later of two racing requests for the last table", () => {
    const earlier = { id: "a", createdAt: "2026-09-01T09:59:59.000Z", ...booking("2026-09-01T19:00:00.000Z") };
    expect(lostInsertRace(mine, [earlier, { ...mine }], floor, 4)).toBe(true);
    // Seen from the earlier request, the later one does not count.
    const asEarlier = { id: "a", createdAt: earlier.createdAt, start: earlier.start, durationMin: 60 };
    expect(lostInsertRace(asEarlier, [earlier, { ...mine }], floor, 4)).toBe(false);
  });

  it("breaks an exact created_at tie by id, so exactly one side withdraws", () => {
    const twin = { id: "a", createdAt: mine.createdAt, ...booking("2026-09-01T19:00:00.000Z") };
    expect(lostInsertRace(mine, [twin], floor, 4)).toBe(true); // "a" < "b" got in first
    expect(lostInsertRace({ ...mine, id: "a" }, [{ ...twin, id: "b" }], floor, 4)).toBe(false);
  });

  it("keeps the booking when there was room for both", () => {
    const two = [...floor, { capacity: 4, status: "free" }];
    const earlier = { id: "a", createdAt: "2026-09-01T09:00:00.000Z", ...booking("2026-09-01T19:00:00.000Z") };
    expect(lostInsertRace(mine, [earlier], two, 4)).toBe(false);
  });
});
