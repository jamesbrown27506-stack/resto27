/**
 * Guide pages — /explore/guide/{slug}.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY THESE PAGES EXIST.
 *
 *  Google autocomplete for Cameroon shows what people actually type when
 *  they look for somewhere to eat: "restaurant douala pas cher",
 *  "restaurant douala pas cher bonamoussadi", "restaurant douala menu",
 *  "livraison repas douala". The site had a page per quartier, per cuisine
 *  and per dish, but nothing answering the INTENT — cheap, delivered, open
 *  late, open on Sunday, best rated, bookable. Those searches landed on
 *  directories and old blog lists.
 *
 *  Each guide is one intent in one place (Douala, or a quartier for the
 *  intents people search per quartier). Every fact on it is computed from the
 *  live listings: prices from menus, times from opening hours, ratings from
 *  reviews. Nothing is written about a restaurant that its own data does not
 *  say, so the pages stay true as menus change.
 *
 *  THE QUALITY GATE. A guide with fewer than MIN_GUIDE_RESTAURANTS matches is
 *  still reachable, but it is `noindex` and absent from the sitemap. A
 *  "cheap restaurants in Kotto" page listing one restaurant is a doorway page
 *  in Google's eyes, and a few of those drag down the whole site. The same
 *  code makes the page indexable the day a second restaurant qualifies.
 * ─────────────────────────────────────────────────────────────────────────
 */
import { isOpenNow, type OpenHours } from "@/lib/format/hours";
import { formatMoney } from "@/lib/format/currency";
import { discoverySlug } from "@/lib/seo-config";
import { formatQuartier } from "@/lib/geo-cm";

export interface GuideRestaurant {
  id: string;
  slug: string;
  name: string;
  quartier: string;
  rating: number;
  reviewCount: number;
  acceptsDelivery: boolean;
  acceptsPickup: boolean;
  deliveryEstimateMin: number;
  minDeliveryFee: number;
  maxDeliveryFee: number;
  depositAmount: number;
  hours: OpenHours[];
}

export interface GuideDish {
  name: string;
  price: number;
  restaurantId: string;
}

export type GuideIntent =
  | "pas-cher"
  | "livraison"
  | "a-emporter"
  | "ouvert-maintenant"
  | "ouvert-tard"
  | "ouvert-dimanche"
  | "meilleurs"
  | "reserver";

export interface GuidePlace {
  kind: "city" | "quartier";
  slug: string;
  name: string;
}

export interface Guide {
  slug: string;
  intent: GuideIntent;
  place: GuidePlace;
  /** The restaurants that match, already in the order the page shows them. */
  restaurants: GuideRestaurant[];
  indexable: boolean;
}

export interface GuideContext {
  /** Wall-clock time in Douala — see `doualaClock`. */
  now: Date;
  /** Every priced meal on the platform, drinks excluded, ascending. */
  mealPrices: number[];
  minByRestaurant: Map<string, number>;
  medianByRestaurant: Map<string, number>;
}

export const GUIDE_CITY: GuidePlace = { kind: "city", slug: "douala", name: "Douala" };
export const MIN_GUIDE_RESTAURANTS = 2;
/** A restaurant counts as "pas cher" when its median meal is at or under this (FCFA). */
export const BUDGET_MEDIAN = 3000;
/**
 * Closing AFTER this, on at least one day, counts as "ouvert tard". Strictly
 * after: the page promises food "après 22 h", and a kitchen that closes at
 * 22:00 does not serve after 22 h.
 */
const LATE_CLOSE_MINUTES = 22 * 60;

/**
 * URL prefix per intent, and whether people search it per quartier. The
 * prefixes are the words of the searches themselves, in French: the slug is
 * what a searcher reads under the title.
 */
const INTENTS: Record<GuideIntent, { prefix: string; perQuartier: boolean }> = {
  "pas-cher": { prefix: "restaurants-pas-chers", perQuartier: true },
  livraison: { prefix: "livraison-repas", perQuartier: true },
  "a-emporter": { prefix: "restaurants-a-emporter", perQuartier: false },
  // "ouvert actuellement" is how the search is written ("restaurant douala
  // akwa ouvert actuellement"), and it is searched per quartier.
  "ouvert-maintenant": { prefix: "restaurants-ouverts-actuellement", perQuartier: true },
  "ouvert-tard": { prefix: "restaurants-ouverts-tard", perQuartier: false },
  "ouvert-dimanche": { prefix: "restaurants-ouverts-dimanche", perQuartier: false },
  meilleurs: { prefix: "meilleurs-restaurants", perQuartier: true },
  reserver: { prefix: "reserver-une-table", perQuartier: false },
};

export const GUIDE_INTENTS = Object.keys(INTENTS) as GuideIntent[];

export function guideSlug(intent: GuideIntent, placeSlug: string): string {
  return `${INTENTS[intent].prefix}-${placeSlug}`;
}

/* ── Facts ─────────────────────────────────────────────────────────────── */

/**
 * Drinks are left out of every price figure. Without this, a 500 FCFA bottle
 * of folere made a grill house look like the cheapest meal in the city.
 * Letter lookarounds rather than \b, which does not treat "é" as a letter.
 * No "water": water fufu is a meal.
 */
const DRINK = /(?<!\p{L})(jus|bissap|fol[eé]r[eé]|eau|sodas?|coca|fanta|bi[eè]res?|vins?|caf[eé]s?|th[eé]s?|boissons?|cocktails?|smoothies?|milkshakes?|juices?|beers?|wines?|teas?|coffees?|drinks?)(?!\p{L})/iu;

export function isDrink(name: string): boolean {
  return DRINK.test(name);
}

/**
 * Now, as a Date whose LOCAL getters read Douala wall-clock time.
 *
 * `isOpenNow` compares `getDay()`/`getHours()` against stored hours, which
 * are Douala times. The server runs in UTC, an hour behind, so without this
 * a restaurant closing at 23:00 showed as open until midnight.
 */
export function doualaClock(date: Date = new Date()): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Africa/Douala",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return new Date(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
}

function toMinutes(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}

/** Stored times carry seconds ("22:00:00"); people read "22:00". */
const clock = (time: string) => time.slice(0, 5);

/** Minutes after that day's midnight at which it closes; past 24h for overnight spans. */
function closingMinutes(day: OpenHours): number | null {
  if (!day.opensAt || !day.closesAt) return null;
  const open = toMinutes(day.opensAt);
  const close = toMinutes(day.closesAt);
  return close <= open ? close + 24 * 60 : close;
}

/** The latest closing time of the week, or null when no hours are set. */
export function latestClosing(hours: OpenHours[]): { weekday: number; closesAt: string; minutes: number } | null {
  let best: { weekday: number; closesAt: string; minutes: number } | null = null;
  for (const day of hours) {
    const minutes = closingMinutes(day);
    if (minutes === null) continue;
    if (!best || minutes > best.minutes) best = { weekday: day.weekday, closesAt: clock(day.closesAt!), minutes };
  }
  return best;
}

export function sundayHours(hours: OpenHours[]): OpenHours | null {
  return hours.find((day) => day.weekday === 0 && day.opensAt && day.closesAt) ?? null;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const index = (sorted.length - 1) * q;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

const round100 = (value: number) => Math.round(value / 100) * 100;

/** The usual price of a meal on the platform: quartiles and median, to the nearest 100 FCFA. */
export function priceSpread(ctx: GuideContext): { min: number; p25: number; median: number; p75: number } | null {
  if (!ctx.mealPrices.length) return null;
  return {
    min: ctx.mealPrices[0],
    p25: round100(quantile(ctx.mealPrices, 0.25)),
    median: round100(quantile(ctx.mealPrices, 0.5)),
    p75: round100(quantile(ctx.mealPrices, 0.75)),
  };
}

/* ── Building the guides ───────────────────────────────────────────────── */

const byName = (a: GuideRestaurant, b: GuideRestaurant) => a.name.localeCompare(b.name, "fr");

function select(intent: GuideIntent, pool: GuideRestaurant[], ctx: GuideContext): GuideRestaurant[] {
  switch (intent) {
    case "pas-cher": {
      const median = (r: GuideRestaurant) => ctx.medianByRestaurant.get(r.id) ?? 0;
      return pool.filter((r) => median(r) > 0 && median(r) <= BUDGET_MEDIAN).sort((a, b) => median(a) - median(b) || byName(a, b));
    }
    case "livraison":
      return pool
        .filter((r) => r.acceptsDelivery)
        .sort((a, b) => (a.deliveryEstimateMin || 999) - (b.deliveryEstimateMin || 999) || byName(a, b));
    case "a-emporter":
      return pool.filter((r) => r.acceptsPickup).sort(byName);
    case "ouvert-maintenant":
      return pool
        .filter((r) => r.hours.some((day) => day.opensAt && day.closesAt))
        .sort((a, b) => Number(isOpenNow(b.hours, ctx.now)) - Number(isOpenNow(a.hours, ctx.now)) || byName(a, b));
    case "ouvert-tard":
      return pool
        .filter((r) => (latestClosing(r.hours)?.minutes ?? 0) > LATE_CLOSE_MINUTES)
        .sort((a, b) => (latestClosing(b.hours)?.minutes ?? 0) - (latestClosing(a.hours)?.minutes ?? 0) || byName(a, b));
    case "ouvert-dimanche":
      return pool.filter((r) => sundayHours(r.hours)).sort(byName);
    case "meilleurs":
      return pool.filter((r) => r.reviewCount > 0).sort((a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount || byName(a, b));
    case "reserver":
      return [...pool].sort(byName);
  }
}

export function buildGuideCatalog(input: {
  restaurants: GuideRestaurant[];
  dishes: GuideDish[];
  now?: Date;
}): { guides: Guide[]; ctx: GuideContext } {
  const pricesBy = new Map<string, number[]>();
  for (const dish of input.dishes) {
    const price = Number(dish.price);
    if (!(price > 0) || isDrink(dish.name)) continue;
    const list = pricesBy.get(dish.restaurantId) ?? [];
    list.push(price);
    pricesBy.set(dish.restaurantId, list);
  }

  const minByRestaurant = new Map<string, number>();
  const medianByRestaurant = new Map<string, number>();
  for (const [id, prices] of pricesBy) {
    prices.sort((a, b) => a - b);
    minByRestaurant.set(id, prices[0]);
    medianByRestaurant.set(id, round100(quantile(prices, 0.5)));
  }

  const ctx: GuideContext = {
    now: input.now ?? doualaClock(),
    mealPrices: [...pricesBy.values()].flat().sort((a, b) => a - b),
    minByRestaurant,
    medianByRestaurant,
  };

  const quartiers = new Map<string, GuidePlace>();
  for (const r of input.restaurants) {
    const slug = discoverySlug(r.quartier);
    if (slug && slug !== GUIDE_CITY.slug && !quartiers.has(slug)) {
      quartiers.set(slug, { kind: "quartier", slug, name: formatQuartier(r.quartier) });
    }
  }

  const guides: Guide[] = [];
  const add = (intent: GuideIntent, place: GuidePlace, pool: GuideRestaurant[]) => {
    const restaurants = select(intent, pool, ctx);
    guides.push({ slug: guideSlug(intent, place.slug), intent, place, restaurants, indexable: restaurants.length >= MIN_GUIDE_RESTAURANTS });
  };

  for (const intent of GUIDE_INTENTS) {
    add(intent, GUIDE_CITY, input.restaurants);
    if (!INTENTS[intent].perQuartier) continue;
    for (const place of quartiers.values()) {
      add(intent, place, input.restaurants.filter((r) => discoverySlug(r.quartier) === place.slug));
    }
  }

  return { guides, ctx };
}

/**
 * The guides worth linking from a page: indexable ones only, same place first
 * (other intents), then the same intent elsewhere. A link to a noindex page
 * spends a crawl on a page Google is told to drop.
 */
export function relatedGuides(guides: Guide[], current: Pick<Guide, "slug" | "intent" | "place">, limit = 8): Guide[] {
  const others = guides.filter((g) => g.indexable && g.slug !== current.slug);
  const samePlace = others.filter((g) => g.place.slug === current.place.slug);
  const sameIntent = others.filter((g) => g.intent === current.intent && g.place.slug !== current.place.slug);
  const city = others.filter((g) => g.place.kind === "city" && g.place.slug !== current.place.slug && g.intent !== current.intent);
  return [...new Map([...samePlace, ...sameIntent, ...city].map((g) => [g.slug, g])).values()].slice(0, limit);
}

/* ── Words ─────────────────────────────────────────────────────────────── */

const DAYS_FR = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const DAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const money = (amount: number) => formatMoney(amount);

/*
  Ranges whose two ends meet read as machine output — "entre 2 500 FCFA et
  2 500 FCFA", "de 30 à 30 minutes" — and they do meet whenever the listings
  are few or alike. Each range below says the single value instead.
*/
function moneyBetween(low: number, high: number, fr: boolean): string {
  if (low === high) return fr ? `environ ${money(low)}` : `about ${money(low)}`;
  return fr ? `entre ${money(low)} et ${money(high)}` : `between ${money(low)} and ${money(high)}`;
}

function moneyFromTo(low: number, high: number, fr: boolean): string {
  if (low === high) return money(low);
  return fr ? `de ${money(low)} à ${money(high)}` : `from ${money(low)} to ${money(high)}`;
}

function placeLabel(place: GuidePlace): string {
  return place.kind === "city" ? place.name : `${place.name}, Douala`;
}

function atPlace(place: GuidePlace, fr: boolean): string {
  return `${fr ? "à" : "in"} ${placeLabel(place)}`;
}

function joinList(items: string[], fr: boolean): string {
  if (items.length <= 1) return items[0] ?? "";
  return items.slice(0, -1).join(", ") + (fr ? " et " : " and ") + items[items.length - 1];
}

function named(restaurants: GuideRestaurant[], fr: boolean, max = 4, detail?: (r: GuideRestaurant) => string | null): string {
  const shown = restaurants.slice(0, max).map((r) => {
    const extra = detail?.(r);
    return `${r.name} (${formatQuartier(r.quartier)}${extra ? `, ${extra}` : ""})`;
  });
  const rest = restaurants.length - shown.length;
  if (rest > 0) shown.push(fr ? `${rest} autre${rest > 1 ? "s" : ""}` : `${rest} more`);
  return joinList(shown, fr);
}

function nounCount(n: number, fr: boolean): string {
  return n === 1 ? (fr ? "1 restaurant" : "1 restaurant") : `${n} restaurants`;
}

function hhmm(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function etaRange(restaurants: GuideRestaurant[]): { min: number; max: number } | null {
  const etas = restaurants.map((r) => r.deliveryEstimateMin).filter((m) => m > 0);
  return etas.length ? { min: Math.min(...etas), max: Math.max(...etas) } : null;
}

function feeRange(restaurants: GuideRestaurant[]): { min: number; max: number } | null {
  const lows = restaurants.map((r) => r.minDeliveryFee).filter((f) => f > 0);
  const highs = restaurants.map((r) => r.maxDeliveryFee || r.minDeliveryFee).filter((f) => f > 0);
  return lows.length && highs.length ? { min: Math.min(...lows), max: Math.max(...highs) } : null;
}

export function guideTitle(guide: Guide, fr: boolean): string {
  const at = atPlace(guide.place, fr);
  switch (guide.intent) {
    case "pas-cher":
      return fr ? `Restaurants pas chers ${at}` : `Cheap restaurants ${at}`;
    case "livraison":
      return fr ? `Livraison de repas à domicile ${at}` : `Food delivery ${at}`;
    case "a-emporter":
      return fr ? `Restaurants à emporter ${at}` : `Takeaway restaurants ${at}`;
    case "ouvert-maintenant":
      return fr ? `Restaurants ouverts actuellement ${at}` : `Restaurants open now ${at}`;
    case "ouvert-tard":
      return fr ? `Restaurants ouverts tard le soir ${at}` : `Late-night restaurants ${at}`;
    case "ouvert-dimanche":
      return fr ? `Restaurants ouverts le dimanche ${at}` : `Restaurants open on Sunday ${at}`;
    case "meilleurs":
      return guide.place.kind === "city"
        ? fr ? "Meilleurs restaurants de Douala" : "Best restaurants in Douala"
        : fr ? `Meilleurs restaurants ${at}` : `Best restaurants ${at}`;
    case "reserver":
      return fr ? `Réserver une table au restaurant ${at}` : `Book a restaurant table ${at}`;
  }
}

/** A short label for links between guides. */
export function guideLinkLabel(guide: Guide, fr: boolean): string {
  return guideTitle(guide, fr);
}

/**
 * The <title>: the H1, plus the month on the ranked lists. The pages that
 * rank for "meilleurs restaurants Douala" put "mis à jour {mois}" in theirs,
 * and here the date is true — the list is recomputed on every request.
 */
export function guideMetaTitle(guide: Guide, ctx: GuideContext, fr: boolean): string {
  const title = guideTitle(guide, fr);
  if (guide.intent !== "meilleurs" && guide.intent !== "pas-cher") return title;
  const month = new Intl.DateTimeFormat(fr ? "fr-FR" : "en-GB", { month: "long", year: "numeric" }).format(ctx.now);
  return `${title} (${month})`;
}

export function guideDescription(guide: Guide, ctx: GuideContext, fr: boolean): string {
  const n = nounCount(guide.restaurants.length, fr);
  const at = atPlace(guide.place, fr);
  switch (guide.intent) {
    case "pas-cher": {
      const cheapest = Math.min(...guide.restaurants.map((r) => ctx.minByRestaurant.get(r.id) ?? Infinity));
      const from = Number.isFinite(cheapest) ? (fr ? ` (dès ${money(cheapest)})` : ` (from ${money(cheapest)})`) : "";
      return fr
        ? `Où manger pas cher ${at} ? ${n} classés par prix, avec le menu et le prix de chaque plat${from}. Livraison ou à emporter sur Resto237.`
        : `Where to eat cheaply ${at}? ${n} ranked by price, with the menu and the price of every dish${from}. Delivery or pickup on Resto237.`;
    }
    case "livraison": {
      const eta = etaRange(guide.restaurants);
      const time = !eta
        ? ""
        : eta.min === eta.max
          ? fr ? `, livrés en ${eta.min} min environ` : `, delivered in about ${eta.min} min`
          : fr ? `, livrés en ${eta.min} à ${eta.max} min` : `, delivered in ${eta.min}–${eta.max} min`;
      return fr
        ? `Commandez un repas en livraison ${at} : ${n}, menus et prix${time}, suivi de la commande en direct sur Resto237.`
        : `Order food for delivery ${at}: ${n}, menus and prices${time}, with live order tracking on Resto237.`;
    }
    case "a-emporter":
      return fr
        ? `Commandez en ligne et passez récupérer votre repas ${at} : ${n} proposent la vente à emporter, avec menus, prix et horaires sur Resto237.`
        : `Order online and pick up your meal ${at}: ${n} offer takeaway, with menus, prices and hours on Resto237.`;
    case "ouvert-maintenant":
      return fr
        ? `Quels restaurants sont ouverts actuellement ${at} ? Les horaires du jour de ${n}, leurs menus et leurs prix, et la commande en ligne sur Resto237.`
        : `Which restaurants are open now ${at}? Today's hours for ${n}, their menus and prices, and online ordering on Resto237.`;
    case "ouvert-tard": {
      const latest = latestAcross(guide.restaurants);
      const until = latest ? (fr ? `, jusqu'à ${latest.closesAt}` : `, until ${latest.closesAt}`) : "";
      return fr
        ? `Restaurants ouverts tard le soir ${at} : ${n} qui servent après 22 h${until}. Menus, prix et livraison sur Resto237.`
        : `Late-night restaurants ${at}: ${n} serving after 10 pm${until}. Menus, prices and delivery on Resto237.`;
    }
    case "ouvert-dimanche":
      return fr
        ? `Restaurants ouverts le dimanche ${at} : ${n} avec leurs horaires du dimanche, leurs menus et leurs prix. Commandez ou réservez sur Resto237.`
        : `Restaurants open on Sunday ${at}: ${n} with their Sunday hours, menus and prices. Order or book on Resto237.`;
    case "meilleurs":
      return fr
        ? `Les restaurants les mieux notés ${at} d'après les avis des clients : ${n} classés par note, avec menus, prix et livraison sur Resto237.`
        : `The best-rated restaurants ${at} according to customer reviews: ${n} ranked by rating, with menus, prices and delivery on Resto237.`;
    case "reserver":
      return fr
        ? `Réservez une table en ligne ${at} : ${n}, choix de la date, de l'heure et du nombre de personnes, confirmation par le restaurant. Menus et prix sur Resto237.`
        : `Book a table online ${at}: ${n}, pick the date, time and party size, and the restaurant confirms. Menus and prices on Resto237.`;
  }
}

function latestAcross(restaurants: GuideRestaurant[]): { closesAt: string; minutes: number } | null {
  let best: { closesAt: string; minutes: number } | null = null;
  for (const r of restaurants) {
    const latest = latestClosing(r.hours);
    if (latest && (!best || latest.minutes > best.minutes)) best = latest;
  }
  return best;
}

/** The editorial paragraphs under the H1 — every figure comes from the listings. */
export function guideIntro(guide: Guide, ctx: GuideContext, fr: boolean): string[] {
  const rs = guide.restaurants;
  const n = nounCount(rs.length, fr);
  const at = atPlace(guide.place, fr);
  const spread = priceSpread(ctx);

  switch (guide.intent) {
    case "pas-cher":
      return [
        fr
          ? `Bien manger ${at} sans se ruiner, c'est possible.${spread ? ` Sur les restaurants référencés par Resto237, un plat coûte le plus souvent ${moneyBetween(spread.p25, spread.p75, true)}.` : ""} Les adresses ci-dessous sont les plus abordables : leur prix médian reste sous ${money(BUDGET_MEDIAN)}, et elles sont classées de la moins chère à la plus chère.`
          : `Eating well ${at} without spending much is possible.${spread ? ` Across the restaurants on Resto237, a dish usually costs ${moneyBetween(spread.p25, spread.p75, false)}.` : ""} The places below are the most affordable: their median dish stays under ${money(BUDGET_MEDIAN)}, and they are ranked from cheapest up.`,
        fr
          ? "Chaque fiche affiche le menu complet avec le prix de chaque plat, boissons à part. Vous commandez en livraison ou à emporter, et vous voyez le total avant de valider."
          : "Every listing shows the full menu with the price of each dish, drinks aside. You order for delivery or pickup and see the total before you confirm.",
      ];
    case "livraison": {
      const eta = etaRange(rs);
      const fees = feeRange(rs);
      return [
        fr
          ? `${n} ${rs.length > 1 ? "livrent" : "livre"} ${at} via Resto237. Vous choisissez vos plats sur le menu, vous indiquez votre adresse, et vous suivez la commande en direct jusqu'à votre porte.`
          : `${n} ${rs.length > 1 ? "deliver" : "delivers"} ${at} through Resto237. Pick your dishes from the menu, give your address, and follow the order live to your door.`,
        [
          !eta
            ? ""
            : eta.min === eta.max
              ? fr ? `Le délai annoncé est d'environ ${eta.min} minutes.` : `The quoted delivery time is about ${eta.min} minutes.`
              : fr ? `Le délai annoncé va de ${eta.min} à ${eta.max} minutes selon le restaurant.` : `Quoted delivery times run from ${eta.min} to ${eta.max} minutes depending on the restaurant.`,
          fees
            ? fr ? `Les frais de livraison, fixés par chaque restaurant selon votre quartier, vont ${moneyFromTo(fees.min, fees.max, true)}.` : `Delivery fees, set by each restaurant according to your neighbourhood, run ${moneyFromTo(fees.min, fees.max, false)}.`
            : fr ? "Les frais de livraison sont fixés par chaque restaurant selon votre quartier et confirmés avant le paiement." : "Delivery fees are set by each restaurant according to your neighbourhood and confirmed before you pay.",
        ].filter(Boolean).join(" "),
      ];
    }
    case "a-emporter":
      return [
        fr
          ? `${n} ${at} ${rs.length > 1 ? "acceptent" : "accepte"} les commandes à emporter sur Resto237 : vous commandez en ligne, vous passez récupérer votre repas quand il est prêt, sans attendre sur place.`
          : `${n} ${at} ${rs.length > 1 ? "take" : "takes"} pickup orders on Resto237: you order online and collect your meal when it is ready, without waiting on site.`,
        fr
          ? "C'est la formule la plus pratique pour le déjeuner au bureau, ou pour éviter les frais de livraison. L'adresse de chaque restaurant figure sur sa fiche."
          : "It is the easiest option for a working lunch, or to avoid delivery fees. Each restaurant's address is on its listing.",
      ];
    case "ouvert-maintenant": {
      const open = rs.filter((r) => isOpenNow(r.hours, ctx.now));
      return [
        fr
          ? `Il est ${hhmm(ctx.now)} à Douala. ${open.length ? `${nounCount(open.length, true)} sur ${rs.length} ${open.length > 1 ? "sont ouverts" : "est ouvert"} en ce moment et ${open.length > 1 ? "apparaissent" : "apparaît"} en premier.` : "Aucun des restaurants ci-dessous n'est ouvert en ce moment."} Les horaires de chaque jour figurent sur chaque fiche.`
          : `It is ${hhmm(ctx.now)} in Douala. ${open.length ? `${nounCount(open.length, false)} out of ${rs.length} ${open.length > 1 ? "are" : "is"} open right now and listed first.` : "None of the restaurants below is open right now."} Each listing shows its hours for every day.`,
        fr
          ? "Un restaurant ouvert peut avoir mis ses commandes en pause, en cas d'affluence : la fiche l'indique avant que vous ne commandiez."
          : "An open restaurant can pause orders when it is busy: the listing says so before you order.",
      ];
    }
    case "ouvert-tard": {
      const latest = latestAcross(rs);
      return [
        fr
          ? `Envie de manger après 22 h ${at} ? Ces restaurants servent tard le soir au moins un jour par semaine${latest ? ` ; le plus tardif ferme à ${latest.closesAt}` : ""}.`
          : `Hungry after 10 pm ${at}? These restaurants serve late at least one day a week${latest ? `; the latest closes at ${latest.closesAt}` : ""}.`,
        fr
          ? "Les horaires changent d'un jour à l'autre : chaque carte indique le jour où le restaurant ferme le plus tard, et sa fiche donne toute la semaine."
          : "Hours vary through the week: each card shows the day a restaurant stays open latest, and its listing gives the full week.",
      ];
    }
    case "ouvert-dimanche":
      return [
        fr
          ? `Le dimanche, beaucoup de cuisines ${at} ferment ou tournent au ralenti. Ces restaurants restent ouverts ce jour-là ; leurs horaires du dimanche sont indiqués sur chaque carte.`
          : `On Sundays many kitchens ${at} close or slow down. These restaurants stay open that day; their Sunday hours are on each card.`,
        fr
          ? "Vous pouvez commander en livraison ou à emporter, ou réserver une table pour le déjeuner du dimanche."
          : "You can order for delivery or pickup, or book a table for Sunday lunch.",
      ];
    case "meilleurs":
      return [
        fr
          ? `Ce classement repose sur les notes et les avis laissés par les clients sur Resto237. Les restaurants ${at} sont triés par note moyenne, puis par nombre d'avis.`
          : `This ranking is built from the ratings and reviews customers leave on Resto237. Restaurants ${at} are sorted by average rating, then by number of reviews.`,
        fr
          ? "Il évolue à chaque nouvel avis. Ouvrez une fiche pour lire les avis en entier, avec les réponses du restaurant."
          : "It changes with every new review. Open a listing to read the reviews in full, with the restaurant's replies.",
      ];
    case "reserver": {
      const withDeposit = rs.filter((r) => r.depositAmount > 0).length;
      return [
        fr
          ? `Réservez une table ${at} directement en ligne : vous choisissez la date, l'heure et le nombre de personnes, et le restaurant confirme.`
          : `Book a table ${at} directly online: choose the date, time and party size, and the restaurant confirms.`,
        withDeposit
          ? fr ? `${nounCount(withDeposit, true)} sur ${rs.length} ${withDeposit > 1 ? "demandent" : "demande"} un acompte, indiqué avant que vous ne validiez.` : `${nounCount(withDeposit, false)} out of ${rs.length} ${withDeposit > 1 ? "ask" : "asks"} for a deposit, shown before you confirm.`
          : fr ? "Aucun de ces restaurants ne demande d'acompte pour réserver." : "None of these restaurants asks for a deposit to book.",
      ];
    }
  }
}

/** One line per restaurant card, specific to the guide's intent. */
export function guideFact(guide: Guide, r: GuideRestaurant, ctx: GuideContext, fr: boolean): string | null {
  switch (guide.intent) {
    case "pas-cher": {
      const min = ctx.minByRestaurant.get(r.id);
      const median = ctx.medianByRestaurant.get(r.id);
      if (!min || !median) return null;
      return fr ? `Plats dès ${money(min)} · prix médian ${money(median)}` : `Dishes from ${money(min)} · median ${money(median)}`;
    }
    case "livraison":
      return r.deliveryEstimateMin > 0 ? (fr ? `Livraison en ${r.deliveryEstimateMin} min environ` : `Delivery in about ${r.deliveryEstimateMin} min`) : null;
    case "a-emporter":
      return fr ? "Commande à emporter" : "Pickup available";
    case "ouvert-maintenant": {
      const today = r.hours.find((day) => day.weekday === ctx.now.getDay());
      if (!today?.opensAt || !today.closesAt) return fr ? "Fermé aujourd'hui" : "Closed today";
      return fr ? `Aujourd'hui ${clock(today.opensAt)}–${clock(today.closesAt)}` : `Today ${clock(today.opensAt)}–${clock(today.closesAt)}`;
    }
    case "ouvert-tard": {
      const latest = latestClosing(r.hours);
      if (!latest) return null;
      return fr ? `Jusqu'à ${latest.closesAt} le ${DAYS_FR[latest.weekday]}` : `Until ${latest.closesAt} on ${DAYS_EN[latest.weekday]}`;
    }
    case "ouvert-dimanche": {
      const sunday = sundayHours(r.hours);
      return sunday ? (fr ? `Dimanche ${clock(sunday.opensAt!)}–${clock(sunday.closesAt!)}` : `Sunday ${clock(sunday.opensAt!)}–${clock(sunday.closesAt!)}`) : null;
    }
    case "meilleurs":
      return fr
        ? `${r.rating.toFixed(1).replace(".", ",")}/5 · ${r.reviewCount} avis`
        : `${r.rating.toFixed(1)}/5 · ${r.reviewCount} review${r.reviewCount > 1 ? "s" : ""}`;
    case "reserver":
      return r.depositAmount > 0 ? (fr ? "Acompte à la réservation" : "Deposit to book") : fr ? "Réservation sans acompte" : "No deposit to book";
  }
}

export interface FaqItem {
  question: string;
  answer: string;
}

/**
 * Questions and answers for the page, phrased the way people search them and
 * answered from the listings. They are visible on the page (that is what
 * ranks for the question) and mirrored in FAQPage structured data (which
 * helps answer engines quote the page).
 */
export function guideFaq(guide: Guide, ctx: GuideContext, fr: boolean): FaqItem[] {
  const rs = guide.restaurants;
  const at = atPlace(guide.place, fr);
  const spread = priceSpread(ctx);
  const items: FaqItem[] = [];
  const push = (question: string, answer: string) => items.push({ question, answer });

  switch (guide.intent) {
    case "pas-cher": {
      push(
        fr ? `Où manger pas cher ${at} ?` : `Where can I eat cheaply ${at}?`,
        fr
          ? `Sur Resto237, les restaurants les plus abordables ${at} sont ${named(rs, true, 4, (r) => (ctx.minByRestaurant.get(r.id) ? `plats dès ${money(ctx.minByRestaurant.get(r.id)!)}` : null))}. Leur prix médian par plat reste sous ${money(BUDGET_MEDIAN)}.`
          : `On Resto237, the most affordable restaurants ${at} are ${named(rs, false, 4, (r) => (ctx.minByRestaurant.get(r.id) ? `dishes from ${money(ctx.minByRestaurant.get(r.id)!)}` : null))}. Their median dish stays under ${money(BUDGET_MEDIAN)}.`,
      );
      if (spread) {
        push(
          fr ? "Combien coûte un repas au restaurant à Douala ?" : "How much does a restaurant meal cost in Douala?",
          fr
            ? `Sur les restaurants référencés par Resto237, un plat coûte le plus souvent ${moneyBetween(spread.p25, spread.p75, true)}${spread.p25 !== spread.p75 ? `, pour un prix médian de ${money(spread.median)}` : ""}. Les plats les moins chers démarrent à ${money(spread.min)}. Les boissons ne sont pas comptées.`
            : `Across the restaurants on Resto237, a dish usually costs ${moneyBetween(spread.p25, spread.p75, false)}${spread.p25 !== spread.p75 ? `, with a median of ${money(spread.median)}` : ""}. The cheapest dishes start at ${money(spread.min)}. Drinks are not counted.`,
        );
      }
      const delivering = rs.filter((r) => r.acceptsDelivery).length;
      push(
        fr ? `Peut-on se faire livrer un repas pas cher ${at} ?` : `Can I get a cheap meal delivered ${at}?`,
        delivering
          ? fr ? `Oui : ${nounCount(delivering, true)} de cette liste ${delivering > 1 ? "livrent" : "livre"}. Le minimum de commande et les frais de livraison figurent sur chaque fiche.` : `Yes: ${nounCount(delivering, false)} on this list ${delivering > 1 ? "deliver" : "delivers"}. The minimum order and delivery fees are on each listing.`
          : fr ? "Ces restaurants fonctionnent à emporter ou sur place ; la page livraison liste ceux qui livrent." : "These restaurants work for pickup or on site; the delivery guide lists the ones that deliver.",
      );
      break;
    }
    case "livraison": {
      const eta = etaRange(rs);
      const fees = feeRange(rs);
      push(
        fr ? `Quels restaurants livrent ${at} ?` : `Which restaurants deliver ${at}?`,
        fr ? `Sur Resto237 : ${named(rs, true, 5)}.` : `On Resto237: ${named(rs, false, 5)}.`,
      );
      if (eta) {
        push(
          fr ? "Combien de temps prend une livraison ?" : "How long does delivery take?",
          fr
            ? `Les restaurants annoncent ${eta.min === eta.max ? `environ ${eta.min}` : `entre ${eta.min} et ${eta.max}`} minutes. Le délai réel dépend de la distance et de la circulation ; vous suivez la commande en direct.`
            : `Restaurants quote ${eta.min === eta.max ? `about ${eta.min}` : `between ${eta.min} and ${eta.max}`} minutes. The real time depends on distance and traffic; you follow the order live.`,
        );
      }
      push(
        fr ? "Combien coûte la livraison à Douala ?" : "How much does delivery cost in Douala?",
        fees
          ? fr ? `Les frais vont ${moneyFromTo(fees.min, fees.max, true)} selon le restaurant et votre quartier. Ils sont confirmés avant le paiement.` : `Fees run ${moneyFromTo(fees.min, fees.max, false)} depending on the restaurant and your neighbourhood. They are confirmed before you pay.`
          : fr ? "Chaque restaurant fixe ses frais selon votre quartier ; ils sont confirmés avant le paiement." : "Each restaurant sets its fee according to your neighbourhood; it is confirmed before you pay.",
      );
      push(
        fr ? "Comment commander un repas en livraison ?" : "How do I order food for delivery?",
        fr ? "Ouvrez la fiche d'un restaurant, ajoutez vos plats au panier, indiquez votre adresse de livraison et validez. Le restaurant confirme, puis vous suivez la commande jusqu'à sa remise." : "Open a restaurant's listing, add dishes to your basket, enter your delivery address and confirm. The restaurant accepts, and you follow the order until it reaches you.",
      );
      break;
    }
    case "a-emporter":
      push(
        fr ? `Quels restaurants font de la vente à emporter ${at} ?` : `Which restaurants offer takeaway ${at}?`,
        fr ? `Sur Resto237 : ${named(rs, true, 5)}.` : `On Resto237: ${named(rs, false, 5)}.`,
      );
      push(
        fr ? "Comment fonctionne la commande à emporter ?" : "How does a pickup order work?",
        fr ? "Vous commandez et payez en ligne, le restaurant prépare votre commande et vous prévient quand elle est prête. Vous passez la récupérer à son adresse, sans frais de livraison." : "You order online, the restaurant prepares it and tells you when it is ready. You collect it from the restaurant, with no delivery fee.",
      );
      break;
    case "ouvert-maintenant": {
      const open = rs.filter((r) => isOpenNow(r.hours, ctx.now));
      push(
        fr ? `Quels restaurants sont ouverts actuellement ${at} ?` : `Which restaurants are open now ${at}?`,
        open.length
          ? fr ? `À ${hhmm(ctx.now)}, sont ouverts : ${named(open, true, 5)}.` : `At ${hhmm(ctx.now)}, open: ${named(open, false, 5)}.`
          : fr ? `À ${hhmm(ctx.now)}, aucun restaurant de cette liste n'est ouvert. Consultez leurs horaires pour savoir quand ils rouvrent.` : `At ${hhmm(ctx.now)}, none of these restaurants is open. Check their hours to see when they reopen.`,
      );
      push(
        fr ? "Où trouver les horaires d'un restaurant ?" : "Where can I find a restaurant's hours?",
        fr ? "Chaque fiche restaurant affiche les horaires des sept jours de la semaine et indique s'il est ouvert en ce moment." : "Every restaurant listing shows its hours for all seven days and whether it is open right now.",
      );
      break;
    }
    case "ouvert-tard": {
      const latest = latestAcross(rs);
      push(
        fr ? "Quels restaurants sont ouverts tard le soir à Douala ?" : "Which restaurants are open late in Douala?",
        fr ? `Sur Resto237 : ${named(rs, true, 5, (r) => { const l = latestClosing(r.hours); return l ? `jusqu'à ${l.closesAt} le ${DAYS_FR[l.weekday]}` : null; })}.` : `On Resto237: ${named(rs, false, 5, (r) => { const l = latestClosing(r.hours); return l ? `until ${l.closesAt} on ${DAYS_EN[l.weekday]}` : null; })}.`,
      );
      if (latest) {
        push(
          fr ? "Jusqu'à quelle heure peut-on manger au restaurant à Douala ?" : "How late can you eat out in Douala?",
          fr ? `Parmi les restaurants de Resto237, le plus tardif ferme à ${latest.closesAt}. Les horaires varient selon le jour : vérifiez celui du jour sur la fiche.` : `Among restaurants on Resto237, the latest closes at ${latest.closesAt}. Hours vary by day: check today's on the listing.`,
        );
      }
      break;
    }
    case "ouvert-dimanche":
      push(
        fr ? "Quels restaurants sont ouverts le dimanche à Douala ?" : "Which restaurants are open on Sunday in Douala?",
        fr ? `Sur Resto237 : ${named(rs, true, 5, (r) => { const s = sundayHours(r.hours); return s ? `${clock(s.opensAt!)}–${clock(s.closesAt!)}` : null; })}.` : `On Resto237: ${named(rs, false, 5, (r) => { const s = sundayHours(r.hours); return s ? `${clock(s.opensAt!)}–${clock(s.closesAt!)}` : null; })}.`,
      );
      push(
        fr ? "Peut-on se faire livrer le dimanche ?" : "Can I get food delivered on Sunday?",
        fr ? `Oui, auprès des restaurants ouverts ce jour-là qui livrent : ${nounCount(rs.filter((r) => r.acceptsDelivery).length, true)} de cette liste.` : `Yes, from the restaurants open that day that deliver: ${nounCount(rs.filter((r) => r.acceptsDelivery).length, false)} on this list.`,
      );
      break;
    case "meilleurs": {
      const top = rs[0];
      if (top) {
        push(
          fr ? `Quel est le meilleur restaurant ${guide.place.kind === "city" ? "de Douala" : at} ?` : `What is the best restaurant ${at}?`,
          fr
            ? `D'après les avis des clients de Resto237, ${top.name} (${formatQuartier(top.quartier)}) arrive en tête avec ${top.rating.toFixed(1).replace(".", ",")}/5 sur ${top.reviewCount} avis${rs.length > 1 ? `, devant ${named(rs.slice(1), true, 3)}` : ""}.`
            : `According to Resto237 customer reviews, ${top.name} (${formatQuartier(top.quartier)}) leads with ${top.rating.toFixed(1)}/5 from ${top.reviewCount} review${top.reviewCount > 1 ? "s" : ""}${rs.length > 1 ? `, ahead of ${named(rs.slice(1), false, 3)}` : ""}.`,
        );
      }
      push(
        fr ? "Comment ce classement est-il établi ?" : "How is this ranking made?",
        fr ? "Il est calculé à partir des notes laissées par les clients sur Resto237 : note moyenne d'abord, nombre d'avis ensuite. Il se met à jour à chaque nouvel avis." : "It is calculated from the ratings customers leave on Resto237: average rating first, then number of reviews. It updates with every new review.",
      );
      break;
    }
    case "reserver": {
      const withDeposit = rs.filter((r) => r.depositAmount > 0);
      push(
        fr ? "Comment réserver une table au restaurant à Douala ?" : "How do I book a restaurant table in Douala?",
        fr ? "Ouvrez la fiche du restaurant et touchez « Réserver » : choisissez la date, l'heure et le nombre de personnes. Le restaurant confirme la réservation, et vous la retrouvez dans votre compte." : "Open the restaurant's listing and tap \"Book\": choose the date, time and party size. The restaurant confirms, and the booking appears in your account.",
      );
      push(
        fr ? "Faut-il payer un acompte pour réserver ?" : "Do I need to pay a deposit to book?",
        withDeposit.length
          ? fr ? `Cela dépend du restaurant : ${named(withDeposit, true, 4)} ${withDeposit.length > 1 ? "demandent" : "demande"} un acompte, indiqué avant que vous ne validiez. Les autres réservent sans acompte.` : `It depends on the restaurant: ${named(withDeposit, false, 4)} ${withDeposit.length > 1 ? "ask" : "asks"} for a deposit, shown before you confirm. The others take bookings without one.`
          : fr ? "Non : aucun de ces restaurants ne demande d'acompte pour réserver." : "No: none of these restaurants asks for a deposit to book.",
      );
      break;
    }
  }

  return items.filter((item) => item.answer.trim().length > 0);
}
