/**
 * Who comes first when the platform chooses the order — the homepage, the
 * signed-in customer's home and the directory's default sort.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  A PAYING RESTAURANT NEVER COMES AFTER A FREE ONE.
 *
 *  Until 2026-10 every list was alphabetical (the homepage), by rating (the
 *  directory) or by how many kitchens serve a dish (the dish tiles). The plan
 *  a restaurant pays for counted nowhere, so a tenant on Enterprise
 *  (25 000 FCFA a month) could sit below one on the free Starter plan. Now:
 *
 *    1. plan        Enterprise → Professional → Starter
 *    2. open now    a closed kitchen cannot take the order being suggested
 *    3. a photo     a card without a picture is the weaker suggestion
 *    4. rating      best rated first, among those with reviews
 *    5. the day     a rotation that changes daily, so the same restaurant is
 *                   not on top forever among otherwise equal ones
 *
 *  Only a plan that is CURRENT counts (`placementTier`): a subscription that
 *  lapsed past its grace, was cancelled, or is still a free trial places as
 *  Starter. A trial is a taste of the paid tools, not payment.
 *
 *  This orders what the platform suggests. When a customer picks a sort
 *  themselves ("best rated", "near me"), their choice wins.
 * ─────────────────────────────────────────────────────────────────────────
 */

export type PlacementTier = "starter" | "professional" | "enterprise";

const TIER_WEIGHT: Record<PlacementTier, number> = { enterprise: 2, professional: 1, starter: 0 };

export interface SubscriptionFacts {
  /** subscription_plans.tier */
  tier: string;
  /** subscription_state.state: active | grace | locked | cancelled */
  state: string;
  isTrialing: boolean;
}

/** The tier a restaurant is placed by: its plan while paid and current, else Starter. */
export function placementTier(sub: SubscriptionFacts | null | undefined): PlacementTier {
  if (!sub || sub.isTrialing) return "starter";
  if (sub.state !== "active" && sub.state !== "grace") return "starter";
  return sub.tier === "enterprise" || sub.tier === "professional" ? sub.tier : "starter";
}

/** Today in Douala (UTC+1, no DST), as the rotation's seed: "2026-10-02". */
export function placementDay(now: Date): string {
  return new Date(now.getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** A stable number per (id, day): same order all day, a different one tomorrow. */
export function rotationKey(id: string, day: string): number {
  const text = `${day}:${id}`;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export interface PlacementInput {
  id: string;
  tier: PlacementTier;
  openNow: boolean;
  hasPhoto: boolean;
  rating: number;
  reviewCount: number;
}

export function comparePlacement(a: PlacementInput, b: PlacementInput, day: string): number {
  return (
    TIER_WEIGHT[b.tier] - TIER_WEIGHT[a.tier] ||
    Number(b.openNow) - Number(a.openNow) ||
    Number(b.hasPhoto) - Number(a.hasPhoto) ||
    (b.reviewCount > 0 ? b.rating : 0) - (a.reviewCount > 0 ? a.rating : 0) ||
    rotationKey(a.id, day) - rotationKey(b.id, day)
  );
}

/** Position per id, 0 = first. */
export function placementOrder(items: PlacementInput[], day: string): Map<string, number> {
  const sorted = [...items].sort((a, b) => comparePlacement(a, b, day));
  return new Map(sorted.map((item, index) => [item.id, index]));
}

export interface PickableDish {
  id: string;
  name: string;
  restaurantId: string;
  hasPhoto: boolean;
}

/**
 * The home's "on the menu today" grid: dishes in the order of their
 * restaurants' placement, one restaurant at a time, so a paying kitchen leads
 * every round without one menu filling the whole grid.
 *
 * Each dish name appears once — every restaurant carries the same Ndolé, and
 * a grid of six Ndolés is one suggestion, not six. Within a restaurant,
 * dishes with a photo go first, then the day's rotation, so the grid changes
 * from one day to the next.
 */
export function pickMenuDishes<T extends PickableDish>(
  dishes: T[],
  restaurantPlacement: Map<string, number>,
  day: string,
  limit: number,
): T[] {
  const byRestaurant = new Map<string, T[]>();
  for (const dish of dishes) {
    if (!restaurantPlacement.has(dish.restaurantId)) continue;
    const list = byRestaurant.get(dish.restaurantId) ?? [];
    list.push(dish);
    byRestaurant.set(dish.restaurantId, list);
  }

  const queues = [...byRestaurant.entries()]
    .sort(([a], [b]) => (restaurantPlacement.get(a) ?? 0) - (restaurantPlacement.get(b) ?? 0))
    .map(([, list]) =>
      list.sort((a, b) => Number(b.hasPhoto) - Number(a.hasPhoto) || rotationKey(a.id, day) - rotationKey(b.id, day)),
    );

  const picked: T[] = [];
  const names = new Set<string>();
  let progress = true;
  while (picked.length < limit && progress) {
    progress = false;
    for (const queue of queues) {
      while (queue.length > 0) {
        const dish = queue.shift()!;
        const name = dish.name.trim().toLowerCase();
        if (names.has(name)) continue;
        names.add(name);
        picked.push(dish);
        progress = true;
        break;
      }
      if (picked.length >= limit) break;
    }
  }
  return picked;
}
