import "server-only";
import { cache } from "react";
import { normaliseDepositType, type DepositType } from "@/lib/reservations/deposit";
import { createAdminClient } from "@/lib/supabase/server";
import { UNCATEGORIZED_SECTION_ID } from "@/lib/menu/constants";
import { fetchCategories, fetchMenu, type MenuItem } from "./manager";

export { UNCATEGORIZED_SECTION_ID };

/**
 * Public reads — restaurants, menus and reviews as anyone on the internet
 * sees them.
 *
 * Unlike the manager layer there is no tenant boundary to hold: these serve
 * EVERY active restaurant and the data is public by design. The one rule that
 * still matters is `.eq("status", "active")` — a pending or suspended
 * restaurant must not leak through the homepage, the directory or the
 * sitemap.
 */

export interface RestaurantHours {
  /** 0 = Sunday, matching JS getDay(). */
  weekday: number;
  /** "HH:MM" or null when the restaurant is closed that day. */
  opensAt: string | null;
  closesAt: string | null;
}

export interface PublicRestaurant {
  id: string;
  slug: string;
  name: string;
  branchLabel: string;
  isPrimary: boolean;
  status: "active" | "pending" | "suspended";
  /** The platform's verified badge (migration 0023) — trust, not marketing. */
  isVerified: boolean;
  cuisine: string;
  description: string;
  quartier: string;
  /** Street address — how a pickup customer actually finds the place. */
  addressLine: string;
  phone: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  rating: number;
  reviewCount: number;
  deliveryEstimateMin: number;
  minimumOrder: number;
  acceptsDelivery: boolean;
  acceptsPickup: boolean;
  isAcceptingOrders: boolean;
  /**
   * The delivery fee band this restaurant advertises (migration 0035).
   *
   * Both 0 means "not declared", and the UI falls back to "to be confirmed".
   * When they are set, the customer gets real numbers to budget against on
   * the page they decide from — the fee itself is still quoted per order.
   */
  minDeliveryFee: number;
  maxDeliveryFee: number;
  /** The acompte a booking requires (migration 0025). 0 = none. */
  depositAmount: number;
  /**
   * How the acompte works (migration 0031): `fixed` FCFA charged online at
   * booking, or `percent` of the customer's final bill collected on site.
   */
  depositType: DepositType;
  hours: RestaurantHours[];
  createdAt: string;
}

interface DbRestaurant {
  id: string;
  slug: string;
  name: string;
  branch_label: string;
  is_primary: boolean;
  status: string;
  is_verified: boolean;
  description: string;
  phone: string | null;
  rating: number;
  review_count: number;
  delivery_estimate_min: number;
  minimum_order: number;
  accepts_delivery: boolean;
  accepts_pickup: boolean;
  is_accepting_orders: boolean;
  min_delivery_fee: number | null;
  max_delivery_fee: number | null;
  deposit_amount: number;
  deposit_type: string | null;
  created_at: string;
  address_line: string | null;
  logo_url: string | null;
  cover_url: string | null;
  cuisines: { name: string }[] | null;
  quartiers: { name: string }[] | null;
}

const BASE_RESTAURANT_COLUMNS =
  "id, slug, name, branch_label, is_primary, status, is_verified, description, phone, address_line, logo_url, cover_url, rating, review_count, delivery_estimate_min, minimum_order, accepts_delivery, accepts_pickup, is_accepting_orders, min_delivery_fee, max_delivery_fee, deposit_amount, created_at, cuisines ( name ), quartiers ( name )";

/*
  ───────────────────────────────────────────────────────────────────────────
   `deposit_type` IS SELECTED CONDITIONALLY, AND IT HAS TO BE.

   The column decides whether a reservation fee is a flat amount, an amount per
   seat, or a percentage of the final bill — so the booking form genuinely
   needs it, and hard-coding "fixed" would silently under-charge every
   restaurant that chose per-seat.

   But it is added by migration 0031 (superseded by 0038), and PostgREST
   answers a select naming a column that does not exist with 42703 FOR EVERY
   ROW. On a database one migration behind, naming it here would not degrade
   the fee display — it would take down the entire restaurant directory, every
   public restaurant page, the homepage and the sitemap, all at once. That is
   the same failure that made every table booking say "Restaurant introuvable".

   So: ask for it, and if the database says it has no such column, remember
   that and stop asking. One wasted round trip on the first query of a process,
   never again after — and the whole directory keeps working either way.

   `null` = not yet known. Deliberately module-level rather than per-request:
   a column does not appear and disappear within the life of a process, and
   after the migration is applied a deploy resets it.
  ───────────────────────────────────────────────────────────────────────────
*/
let depositTypeColumnExists: boolean | null = null;

function restaurantColumns(): string {
  return depositTypeColumnExists === false
    ? BASE_RESTAURANT_COLUMNS
    : `${BASE_RESTAURANT_COLUMNS}, deposit_type`;
}

/**
 * "That column does not exist" — the shape of a migration not yet run.
 *
 * 42703 is Postgres answering a SELECT; PGRST204 is PostgREST refusing a write
 * against its schema cache. Only the first can happen here (this file reads),
 * but both are matched so the check reads the same everywhere and keeps
 * working if a writer is ever added.
 */
function isMissingDepositType(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const known = error.code === "42703" || error.code === "PGRST204";
  return known && (error.message ?? "").includes("deposit_type");
}

/**
 * Run a restaurants query, and retry once without `deposit_type` if that is
 * what the database objected to. `build` is called again for the retry rather
 * than the query being reused: a PostgREST builder is a thenable that cannot
 * be awaited twice.
 */
async function selectRestaurants<T>(
  build: (columns: string) => PromiseLike<{ data: T; error: { code?: string; message?: string } | null }>,
): Promise<{ data: T | null; error: { code?: string; message?: string } | null }> {
  const first = await build(restaurantColumns());
  if (!isMissingDepositType(first.error)) {
    if (!first.error && depositTypeColumnExists === null) depositTypeColumnExists = true;
    return first;
  }

  console.warn(
    "[public] restaurants.deposit_type is missing — run migration 0038. Every reservation fee will read as a flat amount until it is applied.",
  );
  depositTypeColumnExists = false;
  return build(BASE_RESTAURANT_COLUMNS);
}

async function attachHours(
  rows: DbRestaurant[],
): Promise<Map<string, RestaurantHours[]>> {
  const hoursByRestaurant = new Map<string, RestaurantHours[]>();
  if (rows.length === 0) return hoursByRestaurant;

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("restaurant_hours")
    .select("restaurant_id, weekday, opens_at, closes_at")
    .in(
      "restaurant_id",
      rows.map((r) => r.id),
    )
    .order("weekday");

  for (const h of (data ?? []) as {
    restaurant_id: string;
    weekday: number;
    opens_at: string | null;
    closes_at: string | null;
  }[]) {
    const list = hoursByRestaurant.get(h.restaurant_id) ?? [];
    list.push({ weekday: h.weekday, opensAt: h.opens_at, closesAt: h.closes_at });
    hoursByRestaurant.set(h.restaurant_id, list);
  }

  return hoursByRestaurant;
}

function shape(r: DbRestaurant, hours: RestaurantHours[]): PublicRestaurant {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    branchLabel: r.branch_label,
    isPrimary: r.is_primary,
    status: r.status as PublicRestaurant["status"],
    isVerified: r.is_verified,
    cuisine: r.cuisines?.[0]?.name ?? "",
    description: r.description,
    quartier: r.quartiers?.[0]?.name ?? "",
    addressLine: r.address_line ?? "",
    phone: r.phone,
    logoUrl: r.logo_url,
    coverUrl: r.cover_url,
    rating: Number(r.rating),
    reviewCount: r.review_count,
    deliveryEstimateMin: r.delivery_estimate_min,
    minimumOrder: r.minimum_order,
    acceptsDelivery: r.accepts_delivery,
    acceptsPickup: r.accepts_pickup,
    isAcceptingOrders: r.is_accepting_orders,
    minDeliveryFee: Number(r.min_delivery_fee) || 0,
    maxDeliveryFee: Number(r.max_delivery_fee) || 0,
    depositAmount: Number(r.deposit_amount),
    depositType: normaliseDepositType(r.deposit_type),
    hours,
    createdAt: r.created_at,
  };
}

/**
 * Every restaurant the public can order from, for the directory, the
 * homepage and the sitemap. Pending and suspended tenants are excluded.
 */
export async function fetchActiveRestaurants(): Promise<PublicRestaurant[]> {
  const supabase = createAdminClient();

  const { data, error } = await selectRestaurants((columns) =>
    supabase.from("restaurants").select(columns).eq("status", "active").order("name"),
  );

  if (error) {
    console.error("[public:fetchActiveRestaurants]", error.message);
    return [];
  }

  // Through `unknown`: the column list is built at runtime, so PostgREST's
  // literal-type inference has nothing to work from and types the rows as its
  // error shape. The runtime value is the row set either way.
  const rows = (data ?? []) as unknown as DbRestaurant[];
  const hours = await attachHours(rows);
  return rows.map((r) => shape(r, hours.get(r.id) ?? []));
}

/**
 * One active restaurant, or null — the slug lives in the URL.
 *
 * `cache()` because the restaurant page calls this TWICE on every request:
 * once in `generateMetadata` for the title and share card, once in the page
 * body for the content. Each call costs two round trips (the row, then its
 * opening hours), so four of that page's queries were two queries run twice.
 * Keyed on the slug, so two different restaurants in one render still both
 * resolve.
 */
export const fetchPublicRestaurantBySlug = cache(async (
  slug: string,
): Promise<PublicRestaurant | null> => {
  const supabase = createAdminClient();

  const { data, error } = await selectRestaurants((columns) =>
    supabase
      .from("restaurants")
      .select(columns)
      .eq("slug", slug)
      .eq("status", "active")
      .maybeSingle(),
  );

  if (error) {
    console.error("[public:fetchPublicRestaurantBySlug]", error.message);
    return null;
  }
  if (!data) return null;

  const rows = [data as unknown as DbRestaurant];
  const hours = await attachHours(rows);
  return shape(rows[0], hours.get(rows[0].id) ?? []);
});

/* ── Menu ──────────────────────────────────────────────────────────────── */

export interface MenuSection {
  category: { id: string; name: string; icon: string };
  items: MenuItem[];
}

/**
 * The orderable menu grouped by category, options included.
 *
 * Dishes whose category was deleted (or never set) must NOT vanish: the
 * schema comment on menu_items.category_id says it plainly — "an uncategorised
 * item is visible and fixable; a silently deleted menu is not." So they are
 * grouped under a fallback section at the end rather than dropped. Dishes in
 * a deliberately HIDDEN category stay hidden — that toggle is the manager's
 * explicit choice.
 */
export async function fetchMenuSections(restaurantId: string): Promise<MenuSection[]> {
  const [categories, items] = await Promise.all([
    fetchCategories(restaurantId),
    fetchMenu(restaurantId),
  ]);

  const sections = categories
    .filter((c) => c.isActive)
    .map((c) => ({
      category: { id: c.id, name: c.name, icon: c.icon },
      items: items.filter((i) => i.categoryId === c.id),
    }))
    .filter((s) => s.items.length > 0);

  const uncategorised = items.filter(
    (i) => !i.categoryId || !categories.some((c) => c.id === i.categoryId),
  );
  if (uncategorised.length > 0) {
    sections.push({
      category: { id: UNCATEGORIZED_SECTION_ID, name: "Autres plats", icon: "UtensilsCrossed" },
      items: uncategorised,
    });
  }

  return sections;
}

/**
 * A lowercase, space-joined index of every active restaurant's dish names,
 * keyed by restaurant id — the data behind dish-level search in the
 * directory. Built as one read; a menu is small enough that joining in JS is
 * cheaper than a GROUP BY, which PostgREST cannot return anyway.
 */
export async function fetchDishSearchIndex(): Promise<Record<string, string>> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("menu_items")
    .select("restaurant_id, name, restaurants!inner ( status )")
    .eq("restaurants.status", "active");

  if (error) {
    console.error("[public:fetchDishSearchIndex]", error.message);
    return {};
  }

  const index: Record<string, string> = {};
  for (const row of (data ?? []) as { restaurant_id: string; name: string }[]) {
    const current = index[row.restaurant_id] ?? "";
    index[row.restaurant_id] = current ? `${current} ${row.name}` : row.name;
  }
  for (const key of Object.keys(index)) index[key] = index[key].toLowerCase();
  return index;
}

/* ── Homepage ──────────────────────────────────────────────────────────── */

export interface PopularDish {
  item: MenuItem;
  restaurantSlug: string;
  restaurantName: string;
  restaurantLogo: string | null;
  restaurantRating: number;
  /**
   * Where the restaurant is.
   *
   * A dish card is a decision about WHERE TO EAT as much as what to eat, and
   * it was the one card in the app that never said. Someone in Bonapriso
   * tapping a plate of Ndolé had no way to know they were being sent to
   * Bonabéri until two pages later.
   */
  restaurantQuartier: string;
}

/**
 * The dishes shown on the homepage. Featured items first, then by rating —
 * the approximation of "what Douala orders tonight" that a small city
 * dataset supports honestly.
 *
 * A dish WITHOUT A PHOTO can never lead the homepage. This is a food
 * ordering site; the strip sells with its eyes, and a dish whose card is a
 * grey icon is a wasted slot that a photogenic one could have filled. So
 * dishes with an image are sorted ahead, then featured, then by rating —
 * the pool is fetched wider than the slot count so the sort has something
 * to choose from.
 */
export async function fetchPopularDishes(limit = 6): Promise<PopularDish[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("menu_items")
    .select(
      "id, restaurant_id, category_id, name, description, price, image_url, is_available, is_featured, prep_minutes, track_stock, stock_quantity, low_stock_threshold, dietary_tags, allergens, sort_order, restaurants!inner ( slug, name, rating, logo_url, quartiers ( name ) )",
    )
    .eq("is_available", true)
    .eq("restaurants.status", "active")
    .order("is_featured", { ascending: false })
    .limit(Math.min(limit * 4, 48));

  if (error) {
    console.error("[public:fetchPopularDishes]", error.message);
    return [];
  }

  const rows = ((data ?? []) as unknown as {
    id: string;
    restaurant_id: string;
    category_id: string | null;
    name: string;
    description: string;
    price: number;
    image_url: string | null;
    is_available: boolean;
    is_featured: boolean;
    prep_minutes: number;
    track_stock: boolean;
    stock_quantity: number | null;
    low_stock_threshold: number | null;
    dietary_tags: string;
    allergens: string;
    sort_order: number;
    restaurants: {
      slug: string;
      name: string;
      rating: number;
      logo_url: string | null;
      quartiers: { name: string }[] | null;
    }[];
  }[])
    .sort((a, b) => {
      const aPhoto = a.image_url ? 0 : 1;
      const bPhoto = b.image_url ? 0 : 1;
      if (aPhoto !== bPhoto) return aPhoto - bPhoto;
      if (a.is_featured !== b.is_featured) return a.is_featured ? -1 : 1;
      return (b.restaurants[0]?.rating ?? 0) - (a.restaurants[0]?.rating ?? 0);
    })
    .slice(0, limit)
    .map((i) => ({
      restaurantSlug: i.restaurants[0]?.slug ?? "",
      restaurantName: i.restaurants[0]?.name ?? "",
      restaurantLogo: i.restaurants[0]?.logo_url ?? null,
      restaurantRating: Number(i.restaurants[0]?.rating ?? 0),
      restaurantQuartier: i.restaurants[0]?.quartiers?.[0]?.name ?? "",
    item: {
      id: i.id,
      restaurantId: i.restaurant_id,
      categoryId: i.category_id,
      name: i.name,
      description: i.description,
      price: i.price,
      imageUrl: i.image_url,
      isAvailable: i.is_available,
      isFeatured: i.is_featured,
      prepMinutes: i.prep_minutes,
      trackStock: i.track_stock,
      stockQuantity: i.stock_quantity,
      lowStockThreshold: i.low_stock_threshold,
      dietaryTags: i.dietary_tags,
      allergens: i.allergens,
      sortOrder: i.sort_order,
      optionGroups: [],
    },
  }));

  return rows;
}
/* ── Filter lookups ────────────────────────────────────────────────────── */

/** Distinct cuisine names, for the directory and hero selects. */
export async function fetchCuisineNames(): Promise<string[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("cuisines")
    .select("name")
    .eq("is_active", true)
    .order("sort_order");

  if (error) {
    console.error("[public:fetchCuisineNames]", error.message);
    return [];
  }

  return ((data ?? []) as { name: string }[]).map((c) => c.name);
}

/** Active quartier names for Douala, for the directory and hero selects. */
export async function fetchQuartierNames(): Promise<string[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("quartiers")
    .select("name")
    .eq("is_active", true)
    .order("sort_order");

  if (error) {
    console.error("[public:fetchQuartierNames]", error.message);
    return [];
  }

  return ((data ?? []) as { name: string }[]).map((q) => q.name);
}

/* ── Homepage stats and testimonials ─────────────────────────────────────── */

export interface PublicStats {
  /** Active restaurants, for the "restaurants" figure on the homepage. */
  restaurantCount: number;
  /** Delivered orders, for the "orders" figure — the only honest count. */
  deliveredOrderCount: number;
  /** Mean rating across active restaurants (their public ratings). */
  averageRating: number;
  /** Mean delivery estimate across active restaurants that deliver. */
  averageDeliveryMinutes: number;
}

/**
 * The homepage stat strip, computed from what is really in the database.
 *
 * Delivered orders is deliberately the count: cancelled and pending orders
 * never happened from a diner's point of view, and counting them on the
 * marketing page would be a lie the first time it matters.
 */
export async function fetchPublicStats(): Promise<PublicStats> {
  const supabase = createAdminClient();

  /*
    ONE READ OF `restaurants`, NOT THREE.

    This asked the same table three separate times — a head-count, then every
    rating, then every delivery estimate — each with its own round trip, all
    filtered on `status = active`. Every active restaurant is a single row of
    three small columns, so one read answers all three questions: the count is
    the row count, and the two averages are reductions over the same array.

    That matters because this runs on the homepage, which was measured at
    fifteen Supabase round trips before a byte reached the browser. Round trips
    are what the free tier runs out of, not rows.

    The orders count stays a separate query because it is a different table,
    and `head: true` means it transfers a count rather than the rows.
  */
  const [restaurantRows, delivered] = await Promise.all([
    supabase
      .from("restaurants")
      .select("rating, delivery_estimate_min, accepts_delivery")
      .eq("status", "active"),
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("status", "delivered"),
  ]);

  const rows = (restaurantRows.data ?? []) as {
    rating: number | null;
    delivery_estimate_min: number | null;
    accepts_delivery: boolean | null;
  }[];

  const ratings = rows.map((r) => Number(r.rating) || 0);
  // Only restaurants that actually deliver have a meaningful estimate, which
  // is the filter the separate query used to apply in SQL.
  const estimates = rows
    .filter((r) => r.accepts_delivery)
    .map((r) => Number(r.delivery_estimate_min) || 0);

  const mean = (values: number[]) =>
    values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;

  return {
    restaurantCount: rows.length,
    deliveredOrderCount: delivered.count ?? 0,
    averageRating: mean(ratings),
    averageDeliveryMinutes: mean(estimates),
  };
}

export interface FeaturedReview {
  body: string;
  /** Snapshot from the review — the name it was written under. */
  name: string;
  /** The restaurant it was left at. */
  meta: string;
  rating: number;
}

/**
 * The testimonials row on the homepage: the platform's best recent reviews.
 *
 * Real reviews, real names (snapshotted at write time, like every review
 * screen), from restaurants that are actually open. Reported and removed
 * reviews never surface here.
 */
export async function fetchFeaturedReviews(limit = 3): Promise<FeaturedReview[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("reviews")
    .select("body, rating, customer_name, created_at, restaurants!inner ( name )")
    .is("removed_at", null)
    .gte("rating", 4)
    .eq("restaurants.status", "active")
    .order("rating", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[public:fetchFeaturedReviews]", error.message);
    return [];
  }

  return ((data ?? []) as unknown as {
    body: string;
    rating: number;
    customer_name: string;
    restaurants: { name: string }[];
  }[]).map((r) => ({
    body: r.body,
    name: r.customer_name,
    meta: r.restaurants[0]?.name ?? "",
    rating: r.rating,
  }));
}