import { describe, expect, it } from "vitest";
import {
  BUDGET_MEDIAN,
  buildGuideCatalog,
  doualaClock,
  guideDescription,
  guideFact,
  guideFaq,
  guideIntro,
  guideMetaTitle,
  guideSlug,
  guideTitle,
  isDrink,
  latestClosing,
  relatedGuides,
  type GuideDish,
  type GuideRestaurant,
} from "./seo-guides";

const week = (opensAt: string | null, closesAt: string | null) =>
  Array.from({ length: 7 }, (_, weekday) => ({ weekday, opensAt, closesAt }));

function restaurant(overrides: Partial<GuideRestaurant> & Pick<GuideRestaurant, "id" | "name" | "quartier">): GuideRestaurant {
  return {
    slug: overrides.id,
    rating: 0,
    reviewCount: 0,
    acceptsDelivery: true,
    acceptsPickup: true,
    deliveryEstimateMin: 40,
    minDeliveryFee: 0,
    maxDeliveryFee: 0,
    depositAmount: 0,
    hours: week("10:00", "21:00"),
    ...overrides,
  };
}

const MAMI = restaurant({ id: "mami", name: "Mami Chop", quartier: "Ndogbong", deliveryEstimateMin: 30 });
const ROYAL = restaurant({ id: "royal", name: "Royal Eats", quartier: "Bonapriso", rating: 4.6, reviewCount: 12, hours: week("11:00", "23:30") });
const WHITE = restaurant({ id: "white", name: "White House", quartier: "Bonapriso", rating: 4.2, reviewCount: 3, acceptsDelivery: false, depositAmount: 5000 });

const DISHES: GuideDish[] = [
  { restaurantId: "mami", name: "Ndolé", price: 2000 },
  { restaurantId: "mami", name: "Eru & Water Fufu", price: 2500 },
  { restaurantId: "mami", name: "Folere / Jus de bissap", price: 500 },
  { restaurantId: "royal", name: "Poulet DG", price: 6000 },
  { restaurantId: "royal", name: "Poisson braisé", price: 7000 },
  { restaurantId: "white", name: "Riz sauce tomate", price: 1500 },
  { restaurantId: "white", name: "Koki", price: 2500 },
  { restaurantId: "white", name: "Café", price: 300 },
];

const catalog = (now = new Date(2026, 8, 12, 12, 0)) =>
  buildGuideCatalog({ restaurants: [MAMI, ROYAL, WHITE], dishes: DISHES, now });

describe("guide slugs", () => {
  it("uses the words people search, in French", () => {
    expect(guideSlug("pas-cher", "douala")).toBe("restaurants-pas-chers-douala");
    expect(guideSlug("livraison", "bonamoussadi")).toBe("livraison-repas-bonamoussadi");
    expect(guideSlug("meilleurs", "douala")).toBe("meilleurs-restaurants-douala");
  });

  it("makes per-quartier guides only for the intents searched per quartier", () => {
    const { guides } = catalog();
    const slugs = guides.map((g) => g.slug);
    expect(slugs).toContain("restaurants-pas-chers-bonapriso");
    expect(slugs).toContain("livraison-repas-ndogbong");
    // "restaurant douala akwa ouvert actuellement" is searched per quartier.
    expect(slugs).toContain("restaurants-ouverts-actuellement-bonapriso");
    expect(slugs).not.toContain("restaurants-ouverts-dimanche-bonapriso");
  });
});

describe("prices", () => {
  it("leaves drinks out, accents included", () => {
    expect(isDrink("Folere / Jus de bissap")).toBe(true);
    expect(isDrink("Café")).toBe(true);
    expect(isDrink("Poulet DG")).toBe(false);
    // Water fufu is a meal, not a glass of water.
    expect(isDrink("Eru & Water Fufu")).toBe(false);
  });

  it("ranks cheap restaurants by their median meal, not their cheapest drink", () => {
    const { guides, ctx } = catalog();
    const cheap = guides.find((g) => g.slug === "restaurants-pas-chers-douala")!;
    expect(cheap.restaurants.map((r) => r.id)).toEqual(["white", "mami"]);
    expect(cheap.restaurants.every((r) => (ctx.medianByRestaurant.get(r.id) ?? 0) <= BUDGET_MEDIAN)).toBe(true);
    // White House's 300 FCFA coffee is not its cheapest meal.
    expect(ctx.minByRestaurant.get("white")).toBe(1500);
  });
});

describe("the quality gate", () => {
  it("indexes a guide only when at least two restaurants match", () => {
    const { guides } = catalog();
    expect(guides.find((g) => g.slug === "livraison-repas-douala")!.indexable).toBe(true);
    // Only Mami Chop is in Ndogbong.
    expect(guides.find((g) => g.slug === "livraison-repas-ndogbong")!.indexable).toBe(false);
  });

  it("never links to a guide that is kept out of the index", () => {
    const { guides } = catalog();
    const current = guides.find((g) => g.slug === "restaurants-pas-chers-douala")!;
    expect(relatedGuides(guides, current).every((g) => g.indexable)).toBe(true);
  });
});

describe("hours", () => {
  it("counts an overnight close as the latest of the week", () => {
    const hours = [
      { weekday: 5, opensAt: "18:00", closesAt: "02:00" },
      { weekday: 6, opensAt: "11:00", closesAt: "23:00" },
    ];
    expect(latestClosing(hours)).toMatchObject({ weekday: 5, closesAt: "02:00" });
  });

  it("reads the clock in Douala, an hour ahead of UTC", () => {
    const clock = doualaClock(new Date(Date.UTC(2026, 8, 12, 23, 30)));
    expect(clock.getHours()).toBe(0);
    expect(clock.getMinutes()).toBe(30);
    expect(clock.getDate()).toBe(13);
  });

  it("lists late-night restaurants from their real closing time", () => {
    const { guides } = catalog();
    const late = guides.find((g) => g.slug === "restaurants-ouverts-tard-douala")!;
    expect(late.restaurants.map((r) => r.id)).toEqual(["royal"]);
  });

  it("does not call a kitchen that closes at 22:00 'open after 10 pm'", () => {
    const closesAtTen = restaurant({ id: "ten", name: "Ten", quartier: "Akwa", hours: week("10:00:00", "22:00:00") });
    const { guides } = buildGuideCatalog({ restaurants: [closesAtTen], dishes: [], now: new Date(2026, 8, 12, 12, 0) });
    expect(guides.find((g) => g.slug === "restaurants-ouverts-tard-douala")!.restaurants).toEqual([]);
  });
});

describe("words on the page", () => {
  it("titles each guide as the search it answers", () => {
    const { guides } = catalog();
    const bySlug = (slug: string) => guides.find((g) => g.slug === slug)!;
    expect(guideTitle(bySlug("restaurants-pas-chers-bonapriso"), true)).toBe("Restaurants pas chers à Bonapriso, Douala");
    expect(guideTitle(bySlug("meilleurs-restaurants-douala"), true)).toBe("Meilleurs restaurants de Douala");
    expect(guideTitle(bySlug("livraison-repas-douala"), false)).toBe("Food delivery in Douala");
  });

  it("answers questions with real names and prices", () => {
    const { guides, ctx } = catalog();
    const cheap = guides.find((g) => g.slug === "restaurants-pas-chers-douala")!;
    const faq = guideFaq(cheap, ctx, true);
    expect(faq[0].question).toBe("Où manger pas cher à Douala ?");
    expect(faq[0].answer).toContain("White House (Bonapriso");
    expect(faq[0].answer).toContain("Mami Chop (Ndogbong");
    expect(faq.some((item) => item.question.startsWith("Combien coûte un repas"))).toBe(true);
  });

  it("dates the ranked lists in their title, and only those", () => {
    const { guides, ctx } = catalog();
    const bySlug = (slug: string) => guides.find((g) => g.slug === slug)!;
    expect(guideMetaTitle(bySlug("meilleurs-restaurants-douala"), ctx, true)).toBe("Meilleurs restaurants de Douala (septembre 2026)");
    expect(guideMetaTitle(bySlug("restaurants-pas-chers-douala"), ctx, false)).toBe("Cheap restaurants in Douala (September 2026)");
    expect(guideMetaTitle(bySlug("livraison-repas-douala"), ctx, true)).toBe("Livraison de repas à domicile à Douala");
  });

  it("names the top-rated restaurant from its reviews", () => {
    const { guides, ctx } = catalog();
    const best = guides.find((g) => g.slug === "meilleurs-restaurants-douala")!;
    expect(best.restaurants[0].id).toBe("royal");
    expect(guideFaq(best, ctx, true)[0].answer).toContain("Royal Eats (Bonapriso) arrive en tête avec 4,6/5 sur 12 avis");
  });

  /**
   * Found on the live data: hours are stored as "22:00:00", and with few
   * restaurants every range collapsed to "entre 2 500 FCFA et 2 500 FCFA" and
   * "de 30 à 30 minutes".
   */
  it("shows times without seconds and never a range whose two ends meet", () => {
    const a = restaurant({ id: "a", name: "A", quartier: "Akwa", deliveryEstimateMin: 30, minDeliveryFee: 1000, maxDeliveryFee: 1000, hours: week("10:00:00", "23:00:00") });
    const b = restaurant({ id: "b", name: "B", quartier: "Akwa", deliveryEstimateMin: 30, minDeliveryFee: 1000, maxDeliveryFee: 1000, hours: week("10:00:00", "22:30:00") });
    const { guides, ctx } = buildGuideCatalog({
      restaurants: [a, b],
      dishes: [
        { restaurantId: "a", name: "Ndolé", price: 2500 },
        { restaurantId: "b", name: "Eru", price: 2500 },
      ],
      now: new Date(2026, 8, 13, 12, 0),
    });
    const text = ["livraison-repas-douala", "restaurants-pas-chers-douala", "restaurants-ouverts-tard-douala", "restaurants-ouverts-dimanche-douala", "restaurants-ouverts-actuellement-douala"]
      .map((slug) => guides.find((g) => g.slug === slug)!)
      .flatMap((g) => [guideDescription(g, ctx, true), ...guideIntro(g, ctx, true), ...guideFaq(g, ctx, true).map((i) => i.answer), ...g.restaurants.map((r) => guideFact(g, r, ctx, true) ?? "")])
      .join(" ");
    expect(text).not.toMatch(/\d{2}:\d{2}:\d{2}/);
    expect(text).not.toMatch(/30 à 30/);
    expect(text).not.toMatch(/entre ([\d\s  ]+) FCFA et \1 FCFA/);
    expect(text).not.toMatch(/de ([\d\s  ]+) FCFA à \1 FCFA/);
    expect(text).toContain("23:00");
    expect(text).toContain("environ 30 minutes");
  });

  it("keeps every meta description to a snippet's length", () => {
    const { guides, ctx } = catalog();
    for (const guide of guides) {
      for (const fr of [true, false]) {
        expect(guideDescription(guide, ctx, fr).length).toBeLessThanOrEqual(200);
      }
    }
  });
});
