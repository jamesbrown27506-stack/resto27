import { describe, expect, it } from "vitest";
import { OPTION_PRESETS, normaliseDishName, suggestDishes, templateProblem } from "./presets";

const preset = (key: string) => OPTION_PRESETS.find((p) => p.key === key)!;

const menu = [
  { id: "1", name: "Eru" },
  { id: "2", name: "Ndolé crevettes" },
  { id: "3", name: "Poulet DG" },
  { id: "4", name: "Jus de bissap" },
  { id: "5", name: "Poisson braisé" },
  { id: "6", name: "Beignets haricots" },
  { id: "7", name: "Béru" },
];

describe("option presets", () => {
  it("ignores accents and case", () => {
    expect(normaliseDishName("Ndolé Crevettes")).toBe("ndole crevettes");
  });

  it("suggests sides for sauces and leaf dishes, whole words only", () => {
    expect(suggestDishes(preset("sides"), menu)).toEqual(["1", "2"]);
  });

  it("suggests piment for grilled and sauced dishes, not drinks", () => {
    const ids = suggestDishes(preset("chili"), menu);
    expect(ids).toContain("3");
    expect(ids).toContain("5");
    expect(ids).not.toContain("4");
  });

  it("suggests nothing for a preset without keywords", () => {
    expect(suggestDishes(preset("portion"), menu)).toEqual([]);
  });

  it("ships only valid lists", () => {
    for (const p of OPTION_PRESETS) expect(templateProblem(p.template)).toBeNull();
  });

  it("rejects a list nobody could order from", () => {
    const base = preset("sides").template;
    expect(templateProblem({ ...base, name: " " })).toBe("name");
    expect(templateProblem({ ...base, options: [] })).toBe("options");
    expect(templateProblem({ ...base, minSelect: 2, maxSelect: 1 })).toBe("range");
    expect(templateProblem({ ...base, options: [{ name: "Garri", priceDelta: 1.5 }] })).toBe("price");
  });
});
