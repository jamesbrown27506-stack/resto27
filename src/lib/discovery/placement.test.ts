import { describe, expect, it } from "vitest";
import {
  comparePlacement,
  pickMenuDishes,
  placementDay,
  placementOrder,
  placementTier,
  rotationKey,
  type PlacementInput,
} from "./placement";

const base: Omit<PlacementInput, "id" | "tier"> = { openNow: true, hasPhoto: true, rating: 0, reviewCount: 0 };

describe("placementTier", () => {
  it("places a current paid plan by its tier", () => {
    expect(placementTier({ tier: "enterprise", state: "active", isTrialing: false })).toBe("enterprise");
    expect(placementTier({ tier: "professional", state: "grace", isTrialing: false })).toBe("professional");
  });

  it("places a lapsed, cancelled or trial plan as Starter", () => {
    expect(placementTier({ tier: "enterprise", state: "locked", isTrialing: false })).toBe("starter");
    expect(placementTier({ tier: "enterprise", state: "cancelled", isTrialing: false })).toBe("starter");
    expect(placementTier({ tier: "enterprise", state: "active", isTrialing: true })).toBe("starter");
  });

  it("places a restaurant with no subscription as Starter", () => {
    expect(placementTier(null)).toBe("starter");
    expect(placementTier({ tier: "mystery", state: "active", isTrialing: false })).toBe("starter");
  });
});

describe("comparePlacement", () => {
  const day = "2026-10-02";

  it("never puts a paying restaurant after a free one, whatever else is true", () => {
    const free = { ...base, id: "free", tier: "starter" as const, rating: 5, reviewCount: 40 };
    const paid = { ...base, id: "paid", tier: "professional" as const, openNow: false, hasPhoto: false };
    const top = { ...base, id: "top", tier: "enterprise" as const, openNow: false, hasPhoto: false };
    const order = [free, paid, top].sort((a, b) => comparePlacement(a, b, day)).map((r) => r.id);
    expect(order).toEqual(["top", "paid", "free"]);
  });

  it("within a plan: open, then photo, then rating", () => {
    const closed = { ...base, id: "closed", tier: "starter" as const, openNow: false, rating: 5, reviewCount: 3 };
    const noPhoto = { ...base, id: "noPhoto", tier: "starter" as const, hasPhoto: false, rating: 5, reviewCount: 3 };
    const rated = { ...base, id: "rated", tier: "starter" as const, rating: 4.5, reviewCount: 3 };
    const unrated = { ...base, id: "unrated", tier: "starter" as const };
    const order = [closed, noPhoto, unrated, rated].sort((a, b) => comparePlacement(a, b, day)).map((r) => r.id);
    expect(order).toEqual(["rated", "unrated", "noPhoto", "closed"]);
  });

  it("ignores a rating that rests on no review", () => {
    const ghost = { ...base, id: "ghost", tier: "starter" as const, rating: 5, reviewCount: 0 };
    const real = { ...base, id: "real", tier: "starter" as const, rating: 3, reviewCount: 2 };
    expect(comparePlacement(ghost, real, day)).toBeGreaterThan(0);
  });
});

describe("rotation", () => {
  it("is stable within a day and changes between days", () => {
    expect(rotationKey("abc", "2026-10-02")).toBe(rotationKey("abc", "2026-10-02"));
    const ids = Array.from({ length: 12 }, (_, i) => `r${i}`);
    const order = (day: string) =>
      [...placementOrder(ids.map((id) => ({ ...base, id, tier: "starter" })), day).entries()]
        .sort((a, b) => a[1] - b[1])
        .map(([id]) => id)
        .join(",");
    expect(order("2026-10-02")).toBe(order("2026-10-02"));
    expect(order("2026-10-02")).not.toBe(order("2026-10-03"));
  });

  it("turns over at midnight in Douala, not in UTC", () => {
    expect(placementDay(new Date("2026-10-02T22:59:00Z"))).toBe("2026-10-02");
    expect(placementDay(new Date("2026-10-02T23:01:00Z"))).toBe("2026-10-03");
  });
});

describe("pickMenuDishes", () => {
  const placement = new Map([
    ["paid", 0],
    ["free", 1],
  ]);

  it("leads every round with the better-placed restaurant and never repeats a dish name", () => {
    const dishes = [
      { id: "f1", name: "Ndolé", restaurantId: "free", hasPhoto: true },
      { id: "f2", name: "Koki", restaurantId: "free", hasPhoto: true },
      { id: "p1", name: "Ndolé", restaurantId: "paid", hasPhoto: true },
      { id: "p2", name: "Eru", restaurantId: "paid", hasPhoto: true },
    ];
    const picked = pickMenuDishes(dishes, placement, "2026-10-02", 6);
    expect(picked[0].restaurantId).toBe("paid");
    const names = picked.map((d) => d.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    expect(names.sort()).toEqual(["eru", "koki", "ndolé"]);
  });

  it("prefers dishes with a photo and stops at the limit", () => {
    const dishes = [
      { id: "a", name: "A", restaurantId: "paid", hasPhoto: false },
      { id: "b", name: "B", restaurantId: "paid", hasPhoto: true },
      { id: "c", name: "C", restaurantId: "free", hasPhoto: true },
    ];
    const picked = pickMenuDishes(dishes, placement, "2026-10-02", 2);
    expect(picked.map((d) => d.id)).toEqual(["b", "c"]);
  });

  it("skips dishes of restaurants that are not listed", () => {
    const dishes = [{ id: "x", name: "X", restaurantId: "gone", hasPhoto: true }];
    expect(pickMenuDishes(dishes, placement, "2026-10-02", 6)).toEqual([]);
  });
});
