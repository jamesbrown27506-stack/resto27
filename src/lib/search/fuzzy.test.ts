import { describe, expect, it } from "vitest";
import { containsQuery, editDistance, fuzzySearch, matchScore, normalizeText, soundKey } from "./fuzzy";

const DISHES = [
  "Ndolé",
  "Poulet DG",
  "Eru & Water Fufu",
  "Koki",
  "Achu & Soupe Jaune",
  "Poisson Braisé",
  "Foléré — Jus de bissap",
  "Mbongo Tchobi",
  "Fufu & Kati-Kati",
];

const best = (query: string) =>
  [...DISHES].sort((a, b) => matchScore(query, b) - matchScore(query, a))[0];

describe("normalizeText", () => {
  it("drops accents, case and punctuation", () => {
    expect(normalizeText("Foléré — Jus de BISSAP!")).toBe("folere jus de bissap");
    expect(normalizeText("Eru & Water Fufu")).toBe("eru et water fufu");
  });
});

describe("editDistance", () => {
  it("counts a swapped pair as one edit", () => {
    expect(editDistance("watre", "water")).toBe(1);
    expect(editDistance("koki", "koki")).toBe(0);
    expect(editDistance("pizza", "koki", 2)).toBeGreaterThan(2);
  });
});

describe("soundKey", () => {
  it("folds the spellings people swap", () => {
    expect(soundKey("achou")).toBe(soundKey("achu"));
    expect(soundKey("koky")).toBe(soundKey("koki"));
    expect(soundKey("ndolle")).toBe(soundKey("ndole"));
  });
});

describe("matchScore", () => {
  it("finds the dish people meant despite the typo", () => {
    expect(best("ndole")).toBe("Ndolé");
    expect(best("ndolle")).toBe("Ndolé");
    expect(best("koky")).toBe("Koki");
    expect(best("achou")).toBe("Achu & Soupe Jaune");
    expect(best("poulet dj")).toBe("Poulet DG");
    expect(best("eru watre fufu")).toBe("Eru & Water Fufu");
    expect(best("poison braise")).toBe("Poisson Braisé");
    expect(best("bisap")).toBe("Foléré — Jus de bissap");
    expect(best("mbongo chobi")).toBe("Mbongo Tchobi");
  });

  it("does not invent a match for something unrelated", () => {
    for (const dish of DISHES) expect(matchScore("pizza", dish)).toBeLessThan(0.65);
    expect(matchScore("burger", "Koki")).toBeLessThan(0.65);
  });
});

describe("fuzzySearch", () => {
  const items = DISHES.map((name) => ({ name }));

  it("returns exact matches only when there are some", () => {
    const result = fuzzySearch(items, "fufu", (i) => [i.name]);
    expect(result.exact.map((i) => i.name)).toEqual(["Eru & Water Fufu", "Fufu & Kati-Kati"]);
    expect(result.similar).toEqual([]);
  });

  it("is accent-insensitive for exact matches", () => {
    expect(containsQuery("Ndolé", "ndole")).toBe(true);
    expect(fuzzySearch(items, "braise", (i) => [i.name]).exact).toHaveLength(1);
  });

  it("offers close matches, best first, when nothing matches exactly", () => {
    const result = fuzzySearch(items, "kokki", (i) => [i.name]);
    expect(result.exact).toEqual([]);
    expect(result.similar[0].name).toBe("Koki");
  });

  it("returns everything for an empty query", () => {
    expect(fuzzySearch(items, "  ", (i) => [i.name]).exact).toHaveLength(DISHES.length);
  });
});
