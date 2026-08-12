import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { fetchCategories, fetchMenu, type MenuItem } from "./manager";

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
  cuisine: string;
  description: string;
  quartier: string;
  phone: string | null;
  rating: number;
  reviewCount: number;
  deliveryEstimateMin: number;
  minimumOrder: number;
  acceptsDelivery: boolean;
  acceptsPickup: boolean;
  isAcceptingOrders: boolean;
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
  description: string;
  phone: string | null;
  rating: number;
  review_count: number;
  delivery_estimate_min: number;
  minimum_order: number;
  accepts_delivery: boolean;
  accepts_pickup: boolean;
  is_accepting_orders: boolean;
  created_at: string;
  cuisines: { name: string }[] | null;
  quartiers: { name: string }[] | null;
}

const RESTAURANT_COLUMNS =
  "id, slug, name, branch_label, is_primary, status, description, phone, rating, review_count, delivery_estimate_min, minimum_order, accepts_delivery, accepts_pickup, is_accepting_orders, created_at, cuisines ( name ), quartiers ( name )";

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
    cuisine: r.cuisines?.[0]?.name ?? "",
    description: r.description,
    quartier: r.quartiers?.[0]?.name ?? "",
    phone: r.phone,
    rating: Number(r.rating),
    reviewCount: r.review_count,
    deliveryEstimateMin: r.delivery_estimate_min,
    minimumOrder: r.minimum_order,
    acceptsDelivery: r.accepts_delivery,
    acceptsPickup: r.accepts_pickup,
    isAcceptingOrders: r.is_accepting_orders,
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

  const { data, error } = await supabase
    .from("restaurants")
    .select(RESTAURANT_COLUMNS)
    .eq("status", "active")
    .order("name");

  if (error) {
    console.error("[public:fetchActiveRestaurants]", error.message);
    return [];
  }

  const rows = (data ?? []) as DbRestaurant[];
  const hours = await attachHours(rows);
  return rows.map((r) => shape(r, hours.get(r.id) ?? []));
}

/** One active restaurant, or null — the slug lives in the URL. */
export async function fetchPublicRestaurantBySlug(
  slug: string,
): Promise<PublicRestaurant | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("restaurants")
    .select(RESTAURANT_COLUMNS)
    .eq("slug", slug)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    console.error("[public:fetchPublicRestaurantBySlug]", error.message);
    return null;
  }
  if (!data) return null;

  const rows = [data as DbRestaurant];
  const hours = await attachHours(rows);
  return shape(rows[0], hours.get(rows[0].id) ?? []);
}

/* ── Menu ──────────────────────────────────────────────────────────────── */

export interface MenuSection {
  category: { id: string; name: string; icon: string };
  items: MenuItem[];
}

/** The orderable menu grouped by category, options included. */
export async function fetchMenuSections(restaurantId: string): Promise<MenuSection[]> {
  const [categories, items] = await Promise.all([
    fetchCategories(restaurantId),
    fetchMenu(restaurantId),
  ]);

  return categories
    .filter((c) => c.isActive)
    .map((c) => ({
      category: { id: c.id, name: c.name, icon: c.icon },
      items: items.filter((i) => i.categoryId === c.id),
    }))
    .filter((s) => s.items.length > 0);
}

/* ── Homepage ──────────────────────────────────────────────────────────── */

export interface PopularDish {
  item: MenuItem;
  restaurantSlug: string;
  restaurantName: string;
}

/**
 * The dishes shown on the homepage. Featured items first, then by rating —
 * the approximation of "what Douala orders tonight" that a small city
 * dataset supports honestly.
 */
export async function fetchPopularDishes(limit = 6): Promise<PopularDish[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("menu_items")
    .select(
      "id, restaurant_id, category_id, name, description, price, image_url, is_available, is_featured, prep_minutes, track_stock, stock_quantity, low_stock_threshold, dietary_tags, allergens, sort_order, restaurants!inner ( slug, name, rating )",
    )
    .eq("is_available", true)
    .eq("restaurants.status", "active")
    .order("is_featured", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[public:fetchPopularDishes]", error.message);
    return [];
  }

  // PostgREST cannot order by an embedded column — rating is a JS tiebreak
  // on top of the is_featured ordering (Array.prototype.sort is stable).
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
    restaurants: { slug: string; name: string; rating: number }[];
  }[])
    .sort(
      (a, b) =>
        (b.restaurants[0]?.rating ?? 0) - (a.restaurants[0]?.rating ?? 0),
    )
    .map((i) => ({
      restaurantSlug: i.restaurants[0]?.slug ?? "",
      restaurantName: i.restaurants[0]?.name ?? "",
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