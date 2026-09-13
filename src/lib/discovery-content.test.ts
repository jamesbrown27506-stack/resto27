import { describe, expect, it } from "vitest";
import { cuisineTitle, discoveryFaq, discoveryIntro, frenchArticle, isDiscoveryIndexable } from "./discovery-content";

const money = (amount: number) => `${amount} FCFA`;

describe("dish questions", () => {
  it("uses the article a French speaker puts before the dish", () => {
    expect(frenchArticle("Ndolé")).toBe("le ");
    expect(frenchArticle("Eru & Water Fufu")).toBe("l'");
    expect(frenchArticle("Grillades")).toBe("les ");
    // No elision before h: "les haricots", never "l'haricots".
    expect(frenchArticle("Haricots rouges")).toBe("les ");
    expect(frenchArticle("Sauce jaune")).toBe("la ");
  });

  it("answers where to eat a dish and what it costs, from the menus", () => {
    const faq = discoveryFaq({
      kind: "food",
      name: "Poulet DG",
      fr: true,
      restaurants: [
        { name: "Mami Chop", quartier: "Ndogbong", acceptsDelivery: true, minPrice: 2000 },
        { name: "Vabalon", quartier: "Bonamoussadi", acceptsDelivery: false, minPrice: 2500 },
      ],
      dishOffers: [
        { restaurant: "Vabalon", quartier: "Bonamoussadi", price: 5000 },
        { restaurant: "Mami Chop", quartier: "Ndogbong", price: 4000 },
      ],
      money,
    });
    expect(faq[0].question).toBe("Où manger le poulet DG à Douala ?");
    expect(faq[0].answer).toBe("Sur Resto237, 2 restaurants proposent ce plat : Mami Chop (Ndogbong, 4000 FCFA) et Vabalon (Bonamoussadi, 5000 FCFA).");
    expect(faq[1]).toEqual({ question: "Combien coûte le poulet DG à Douala ?", answer: "De 4000 FCFA à 5000 FCFA selon le restaurant, d'après les menus publiés sur Resto237." });
    expect(faq[2].answer).toContain("l'un des restaurants qui le proposent livre à domicile");
  });

  it("answers where to eat in a quartier, with prices", () => {
    const faq = discoveryFaq({
      kind: "neighbourhood",
      name: "Bonapriso",
      fr: true,
      restaurants: [{ name: "Royal Eats", quartier: "Bonapriso", acceptsDelivery: false, minPrice: 1000 }],
      dishOffers: [],
      money,
    });
    expect(faq[0].question).toBe("Où manger à Bonapriso, Douala ?");
    expect(faq[0].answer).toContain("Royal Eats (plats dès 1000 FCFA)");
    expect(faq[1].answer).toContain("Aucun pour l'instant");
  });
});

describe("copy and quality gate", () => {
  it("gives the seeded spelling Ndokotti the copy written for Ndokoti", () => {
    expect(discoveryIntro("neighbourhood", "ndokotti", "Ndokotti", true)).toContain("carrefours les plus fréquentés");
  });

  it("keeps a one-restaurant page with no written copy out of the index", () => {
    expect(isDiscoveryIndexable("food", "plantain-frit", 1)).toBe(false);
    expect(isDiscoveryIndexable("food", "ndole", 1)).toBe(true);
    expect(isDiscoveryIndexable("food", "plantain-frit", 2)).toBe(true);
    expect(isDiscoveryIndexable("food", "ndole", 0)).toBe(false);
  });

  it("titles cuisine pages the way people search them", () => {
    expect(cuisineTitle("camerounaise", "Camerounaise", true)).toBe("Restaurants camerounais à Douala");
    expect(cuisineTitle("thai", "Thaï", true)).toBe("Thaï à Douala");
  });
});
