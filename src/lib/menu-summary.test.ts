import { describe, expect, it } from "vitest";
import { groupDishes, priceRangesByRestaurant } from "./menu-summary";

describe("groupDishes", () => {
  it("makes one tile per dish, counting each restaurant once", () => {
    const groups = groupDishes([
      { name: "Poulet DG", price: 4500, imageUrl: null, restaurantId: "a" },
      { name: "Poulet DG", price: 3500, imageUrl: "https://cdn.test/poulet.jpg", restaurantId: "b" },
      { name: "Poulet DG", price: 5000, imageUrl: null, restaurantId: "b" },
      { name: "Ndolé", price: 3000, imageUrl: "https://cdn.test/ndole.jpg", restaurantId: "a" },
    ], 6);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      name: "Poulet DG",
      restaurantCount: 2,
      minPrice: 3500,
      imageUrl: "https://cdn.test/poulet.jpg",
    });
  });

  it("puts dishes worth comparing first, then those with a photo", () => {
    const groups = groupDishes([
      { name: "Beignets", price: 500, imageUrl: null, restaurantId: "a" },
      { name: "Eru", price: 2500, imageUrl: "https://cdn.test/eru.jpg", restaurantId: "a" },
      { name: "Ndolé", price: 3000, imageUrl: null, restaurantId: "a" },
      { name: "Ndolé", price: 3200, imageUrl: null, restaurantId: "b" },
    ], 2);

    expect(groups.map((group) => group.name)).toEqual(["Ndolé", "Eru"]);
  });

  it("never advertises a free item as the starting price", () => {
    expect(groupDishes([{ name: "Eau", price: 0, imageUrl: null, restaurantId: "a" }], 6)[0].minPrice).toBeNull();
  });
});

describe("priceRangesByRestaurant", () => {
  it("keeps the cheapest and dearest priced dish of each restaurant", () => {
    const ranges = priceRangesByRestaurant([
      { restaurantId: "a", price: 2000 },
      { restaurantId: "a", price: 8000 },
      { restaurantId: "a", price: 0 },
      { restaurantId: "b", price: 3500 },
    ]);

    expect(ranges.get("a")).toEqual({ min: 2000, max: 8000 });
    expect(ranges.get("b")).toEqual({ min: 3500, max: 3500 });
    expect(ranges.has("c")).toBe(false);
  });
});

describe("groupDishes with placement", () => {
  const placement = new Map([
    ["paid", 0],
    ["free", 1],
  ]);

  it("leads with the dishes of the best-placed restaurant, whatever the count", () => {
    const groups = groupDishes([
      { name: "Ndolé", price: 3000, imageUrl: "https://cdn.test/n.jpg", restaurantId: "free" },
      { name: "Ndolé", price: 3200, imageUrl: "https://cdn.test/n2.jpg", restaurantId: "other" },
      { name: "Koki", price: 2000, imageUrl: "https://cdn.test/k.jpg", restaurantId: "paid" },
    ], 2, { placement });
    expect(groups.map((g) => g.name)).toEqual(["Koki", "Ndolé"]);
  });

  it("shows the best-placed restaurant's photo on the tile", () => {
    const [group] = groupDishes([
      { name: "Eru", price: 2500, imageUrl: "https://cdn.test/free.jpg", restaurantId: "free" },
      { name: "Eru", price: 2600, imageUrl: "https://cdn.test/paid.jpg", restaurantId: "paid" },
    ], 1, { placement });
    expect(group.imageUrl).toBe("https://cdn.test/paid.jpg");
  });

  it("rotates ties by day instead of running A to Z", () => {
    const dishes = ["Achu", "Ekwang", "Eru", "Grillades", "Koki", "Ndolé", "Poulet DG", "Poisson braisé"].map((name) => ({
      name,
      price: 2500,
      imageUrl: "https://cdn.test/x.jpg",
      restaurantId: "paid",
    }));
    const firstSix = (day: string) => groupDishes(dishes, 6, { placement, day }).map((g) => g.name).join();
    expect(firstSix("2026-10-02")).toBe(firstSix("2026-10-02"));
    const days = ["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"].map(firstSix);
    expect(new Set(days).size).toBeGreaterThan(1);
  });
});
