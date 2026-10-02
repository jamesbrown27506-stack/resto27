import { describe, expect, it } from "vitest";
import { effectiveCourse, inferCourse, majorityCourse } from "./course";

describe("inferCourse", () => {
  it("reads drinks and desserts from the dish name, whatever the section", () => {
    expect(inferCourse("Foléré — Jus de bissap", "Plats principaux")).toBe("drink");
    expect(inferCourse("Coca-Cola 33 cl")).toBe("drink");
    expect(inferCourse("Glace vanille")).toBe("dessert");
    expect(inferCourse("Gâteau au chocolat")).toBe("dessert");
  });

  it("does not take Water Fufu for a drink", () => {
    expect(inferCourse("Eru & Water Fufu", "Plats principaux")).toBe("main");
    expect(inferCourse("Eru & Water Fufu")).toBe("main");
  });

  it("falls back to the restaurant's section", () => {
    expect(inferCourse("Spécialité maison", "Boissons")).toBe("drink");
    expect(inferCourse("Spécialité maison", "Desserts")).toBe("dessert");
    expect(inferCourse("Avocat crevettes", "Entrées")).toBe("light");
    expect(inferCourse("Ndolé", "Plats principaux")).toBe("main");
  });

  it("recognises light meals by name, and calls everything else a main dish", () => {
    expect(inferCourse("BHB")).toBe("light");
    expect(inferCourse("Omelette spaghetti")).toBe("light");
    expect(inferCourse("Poulet DG")).toBe("main");
    expect(inferCourse("Achu & Soupe Jaune")).toBe("main");
  });
});

describe("effectiveCourse", () => {
  it("lets the restaurant's own choice win", () => {
    expect(effectiveCourse({ course: "light", name: "Poulet DG" })).toBe("light");
    expect(effectiveCourse({ course: "nonsense", name: "Jus d'orange" })).toBe("drink");
    expect(effectiveCourse({ course: null, name: "Koki", categoryName: "Entrées" })).toBe("light");
  });
});

describe("majorityCourse", () => {
  it("takes what most kitchens call the dish, and main when there is nothing to go on", () => {
    expect(majorityCourse(["drink", "drink", "main"])).toBe("drink");
    expect(majorityCourse([])).toBe("main");
    expect(majorityCourse(["light", "main"])).toBe("light");
  });
});
