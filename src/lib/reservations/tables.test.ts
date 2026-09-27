import { describe, expect, it } from "vitest";
import { arrivalsAt, chooseTables, floorSeats, seatPartyAt, slotVerdict, type PlanTable } from "./tables";

const floor: PlanTable[] = [
  { id: "t2", capacity: 2, status: "available", zone: "Salle" },
  { id: "t4", capacity: 4, status: "available", zone: "Salle" },
  { id: "t6a", capacity: 6, status: "available", zone: "Terrasse" },
  { id: "t6b", capacity: 6, status: "available", zone: "Terrasse" },
  { id: "t8", capacity: 8, status: "available", zone: "Salle" },
  { id: "off", capacity: 10, status: "out_of_service", zone: "Salle" },
];

const ids = (tables: PlanTable[] | null) => tables?.map((t) => t.id).sort() ?? null;

describe("choosing tables for a party", () => {
  it("prefers the smallest single table that fits", () => {
    expect(ids(chooseTables(floor, 3))).toEqual(["t4"]);
    expect(ids(chooseTables(floor, 7))).toEqual(["t8"]);
  });

  it("combines the fewest tables with the least waste for a big group", () => {
    // 12: 6+6 wastes 0, beats 8+4 (0 too, but ties keep the first found) — both two tables.
    expect(chooseTables(floor, 12)?.length).toBe(2);
    expect(ids(chooseTables(floor, 14))).toEqual(["t6a", "t8"]);
    expect(ids(chooseTables(floor, 20))).toEqual(["t6a", "t6b", "t8"]);
  });

  it("never uses a table out of service", () => {
    expect(floorSeats(floor)).toBe(26);
    expect(chooseTables(floor, 27)).toBeNull();
  });

  it("honours a zone preference when it can, and drops it when it cannot", () => {
    expect(ids(chooseTables(floor, 5, "Terrasse"))).toEqual(["t6a"]);
    expect(ids(chooseTables(floor, 14, "Terrasse"))).toEqual(["t6a", "t8"]);
  });
});

describe("availability as a simulation", () => {
  const at = new Date("2026-10-03T19:00:00Z");
  const booking = (partySize: number, tableIds?: string[], start = at) => ({ start, durationMin: 60, partySize, tableIds });

  it("lets assigned bookings keep their tables", () => {
    const bookings = [booking(6, ["t8"])];
    expect(ids(seatPartyAt({ tables: floor, bookings, at, durationMin: 60, partySize: 8 }))).toEqual(["t2", "t6a"]);
  });

  it("gives unassigned bookings the tables the rule would, largest first", () => {
    const bookings = [booking(8), booking(6)];
    // 8 → t8, 6 → t6a; a party of 6 still finds t6b.
    expect(ids(seatPartyAt({ tables: floor, bookings, at, durationMin: 60, partySize: 6 }))).toEqual(["t6b"]);
    // but a party of 13 no longer fits on 2 + 4 + 6.
    expect(seatPartyAt({ tables: floor, bookings, at, durationMin: 60, partySize: 13 })).toBeNull();
  });

  it("ignores bookings that do not overlap the sitting", () => {
    const bookings = [booking(20, undefined, new Date("2026-10-03T21:00:00Z"))];
    expect(seatPartyAt({ tables: floor, bookings, at, durationMin: 60, partySize: 20 })).not.toBeNull();
  });

  it("caps arrivals per slot", () => {
    const bookings = [booking(2), booking(2)];
    expect(arrivalsAt(at, bookings)).toBe(2);
    expect(slotVerdict({ tables: floor, bookings, at, durationMin: 60, partySize: 2, maxArrivals: 2 })).toBe("arrivals");
    expect(slotVerdict({ tables: floor, bookings, at, durationMin: 60, partySize: 2, maxArrivals: 3 })).toBe("ok");
  });

  it("never fills an unmanaged floor on tables", () => {
    expect(slotVerdict({ tables: [], bookings: [booking(50)], at, durationMin: 60, partySize: 40 })).toBe("ok");
  });
});
