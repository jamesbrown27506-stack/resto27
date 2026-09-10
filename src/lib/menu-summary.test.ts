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
