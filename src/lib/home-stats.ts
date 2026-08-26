/**
 * Which of the landing page's four figures the platform is willing to show.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  "1 RESTAURANT" IS AN HONEST NUMBER THAT TALKS PEOPLE OUT OF ORDERING.
 *
 *  The homepage advertises four things: how many restaurants, how many orders
 *  delivered, the average rating and the average delivery time. Two of those
 *  measure the SIZE of the platform and two measure its QUALITY, and only the
 *  second pair reads well while the directory is small. A visitor who learns
 *  there is one restaurant has learned something true and unhelpful.
 *
 *  FOUR SWITCHES, NOT ONE. The complaint is per-figure: "4,8 average rating"
 *  and "30 min average delivery" are good marketing at any scale, and a single
 *  master switch would force an admin to throw those away in order to hide the
 *  two that embarrass. Four also means the count comes back on its own merits
 *  the day there are twenty restaurants, one switch at a time.
 *
 *  There is deliberately NO master row. It would be a fifth stored fact wholly
 *  derivable from the other four, and two levels of state can disagree — a
 *  master ON with every child OFF is a question somebody then has to answer in
 *  writing. "All four off" already IS the master-off state, and it costs
 *  nothing to compute.
 *
 *  NOT `server-only`: the hero is a Client Component and shows three of these
 *  same figures inline, so the resolved visibility has to travel to the
 *  browser. The precedent is lib/reservations/deposit.
 * ─────────────────────────────────────────────────────────────────────────
 */

export const HOME_STAT_KEYS = ["restaurants", "orders", "rating", "delivery"] as const;

export type HomeStatKey = (typeof HOME_STAT_KEYS)[number];

/** The settings row behind each figure. */
export const HOME_STAT_SETTING: Record<HomeStatKey, string> = {
  restaurants: "home_stat_restaurants",
  orders: "home_stat_orders",
  rating: "home_stat_rating",
  delivery: "home_stat_delivery",
};

/**
 * Hide the size claims, keep the quality claims.
 *
 * These are compiled in as well as seeded by migration 0043, so a database
 * that has not run it renders the identical homepage — it just offers no
 * switches to change it.
 */
export const HOME_STATS_DEFAULT: Record<HomeStatKey, boolean> = {
  restaurants: false,
  orders: false,
  rating: true,
  delivery: true,
};

export type HomeStatsVisibility = Record<HomeStatKey, boolean>;

/** Resolve the four switches out of the settings map. */
export function readHomeStats(map: Map<string, string>): HomeStatsVisibility {
  const out = {} as HomeStatsVisibility;
  for (const key of HOME_STAT_KEYS) {
    const raw = map.get(HOME_STAT_SETTING[key]);
    // Only the exact string "true" is true: the column is free text, and a
    // typo should not switch a figure on.
    out[key] = raw === undefined || raw === "" ? HOME_STATS_DEFAULT[key] : raw === "true";
  }
  return out;
}

/** True when every figure is hidden, so the band must not render at all. */
export function allHomeStatsHidden(visibility: HomeStatsVisibility): boolean {
  return HOME_STAT_KEYS.every((key) => !visibility[key]);
}
