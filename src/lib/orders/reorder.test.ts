import { describe, expect, it } from "vitest";
import { rebuildReorderLines, type ReorderMenuItem } from "./reorder";

const size = {
  id: "g-size",
  name: "Taille",
  isRequired: true,
  minSelect: 1,
  maxSelect: 1,
  options: [
    { id: "o-small", name: "Petite", priceDelta: 0, isAvailable: true },
    { id: "o-large", name: "Grande", priceDelta: 1000, isAvailable: true },
  ],
};

const menu: ReorderMenuItem[] = [
  { id: "pizza", name: "Pizza", price: 5000, isAvailable: true, prepMinutes: 20, trackStock: false, stockQuantity: null, optionGroups: [size] },
  { id: "jus", name: "Jus", price: 1000, isAvailable: true, prepMinutes: 2, trackStock: true, stockQuantity: 3, optionGroups: [] },
  { id: "old", name: "Ndolé", price: 3000, isAvailable: false, prepMinutes: 15, trackStock: false, stockQuantity: null, optionGroups: [] },
];

describe("rebuildReorderLines", () => {
  it("matches options by name and prices from today's menu", () => {
    const { lines, skipped } = rebuildReorderLines(
      [{ menuItemId: "pizza", name: "Pizza", quantity: 2, options: "grande" }],
      menu,
    );
    expect(skipped).toEqual([]);
    expect(lines[0]).toMatchObject({ menuItemId: "pizza", basePrice: 5000, quantity: 2 });
    expect(lines[0].options.map((o) => o.optionId)).toEqual(["o-large"]);
  });

  it("skips gone, unavailable and no-longer-satisfiable lines, naming them", () => {
    const { lines, skipped } = rebuildReorderLines(
      [
        { menuItemId: "deleted", name: "Poisson", quantity: 1 },
        { menuItemId: "old", name: "Ndolé", quantity: 1 },
        { menuItemId: "pizza", name: "Pizza", quantity: 1, options: "Moyenne" },
        { menuItemId: "pizza", name: "Pizza nue", quantity: 1, options: null },
      ],
      menu,
    );
    expect(lines).toEqual([]);
    expect(skipped).toEqual(["Poisson", "Ndolé", "Pizza", "Pizza nue"]);
  });

  it("caps the quantity at the remaining stock", () => {
    const { lines } = rebuildReorderLines([{ menuItemId: "jus", name: "Jus", quantity: 10 }], menu);
    expect(lines[0].quantity).toBe(3);
  });
});
