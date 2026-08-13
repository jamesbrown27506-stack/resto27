import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import type { UserRole, UserStatus } from "@/lib/session";

/**
 * Admin data access.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY THIS USES THE ADMIN CLIENT (and therefore SUPABASE_SECRET_KEY)
 *
 *  The RLS policies in 0003 expose only `status = 'active'` restaurants. That
 *  is correct for the public site and useless for an admin, whose entire job
 *  is the pending and suspended ones.
 *
 *  So these queries deliberately bypass RLS. That is safe because
 *  authorization already happened: app/(admin)/layout.tsx calls
 *  requireRole("admin"), which loads the profile from the database and checks
 *  `status` on every request. RLS is the fence; lib/auth is the logic (B.1).
 *
 *  `server-only` at the top makes importing any of this from a Client
 *  Component a build error, not a runtime leak.
 * ─────────────────────────────────────────────────────────────────────────
 */

/**
 * Turn a PostgREST error into something that says where to look.
 *
 * The raw messages are terse and often misleading in context — "Invalid API
 * key" reads like a revoked key when it usually means the placeholder is still
 * in .env.local, and a missing table reads as a permissions problem. The real
 * message still goes to the server log; the thrown one names the likely fix.
 */
function describeQueryError(
  what: string,
  error: { message: string; code?: string; details?: string | null },
): Error {
  console.error(`[data:${what}]`, error.code ?? "", error.message, error.details ?? "");

  const message = error.message.toLowerCase();

  if (message.includes("invalid api key") || message.includes("jwt")) {
    return new Error(
      "Supabase a refusé la clé. Vérifiez SUPABASE_SECRET_KEY dans .env.local " +
        "(Settings → API keys → Secret keys), puis redémarrez le serveur de développement.",
    );
  }

  // 42P01 = undefined_table.
  if (error.code === "42P01" || message.includes("does not exist")) {
    return new Error(
      `La table « ${what} » n'existe pas encore. Exécutez la migration correspondante ` +
        "dans supabase/migrations/ via le SQL editor.",
    );
  }

  // PGRST200 = a relationship named in the select could not be resolved.
  if (error.code === "PGRST200") {
    return new Error(
      `Relation introuvable dans la requête « ${what} ». La migration a-t-elle été exécutée ` +
        "entièrement, clés étrangères comprises ?",
    );
  }

  return new Error(`Impossible de charger « ${what} » : ${error.message}`);
}

export interface AdminRestaurant {
  id: string;
  slug: string;
  name: string;
  branchLabel: string;
  isPrimary: boolean;
  status: "active" | "pending" | "suspended";
  /** The public verified badge — set by an admin, never bought (§0023). */
  isVerified: boolean;
  cuisine: string | null;
  quartier: string | null;
  city: string | null;
  description: string;
  phone: string | null;
  rating: number;
  reviewCount: number;
  minimumOrder: number;
  deliveryEstimateMin: number;
  acceptsDelivery: boolean;
  acceptsPickup: boolean;
  ownerId: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  createdAt: string;
  /** Null when the tenant has never been given a subscription. */
  subscription: RestaurantSubscription | null;
}

/** Derived by the `subscription_state` view — never a stored column (§5). */
export type SubscriptionState = "active" | "grace" | "locked" | "cancelled";

export interface RestaurantSubscription {
  planTier: "starter" | "professional" | "enterprise";
  planName: string;
  state: SubscriptionState;
  /** Null means NEVER EXPIRES — not "expired long ago" (§5 rule 1). */
  endDate: string | null;
  daysRemaining: number | null;
  graceDays: number;
}

/** Shape returned by the nested select below. */
interface RestaurantRow {
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
  minimum_order: number;
  delivery_estimate_min: number;
  accepts_delivery: boolean;
  accepts_pickup: boolean;
  owner_id: string | null;
  created_at: string;
  cuisines: { name: string } | null;
  quartiers: { name: string } | null;
  service_areas: { city: string } | null;
  profiles: { name: string; email: string } | null;
}

interface SubscriptionStateRow {
  restaurant_id: string;
  state: string;
  end_date: string | null;
  days_remaining: number | null;
  grace_days: number;
  subscription_plans: { tier: string; name: string } | null;
}

/**
 * Subscriptions are fetched separately and stitched in memory rather than
 * joined, because `subscription_state` is a VIEW and PostgREST cannot follow a
 * foreign key through one. Two round trips over a table of tenants is nothing;
 * the alternative is a stored state column that goes stale (§5).
 *
 * Returns an empty map — not an error — when migration 0004 has not been run,
 * so the restaurants list still renders while billing is being set up.
 */
async function fetchSubscriptionMap(): Promise<Map<string, RestaurantSubscription>> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("subscription_state")
    .select("restaurant_id, state, end_date, days_remaining, grace_days, subscription_plans ( tier, name )");

  if (error) {
    console.warn("[data:subscriptions] unavailable —", error.message);
    return new Map();
  }

  const map = new Map<string, RestaurantSubscription>();
  for (const row of data as unknown as SubscriptionStateRow[]) {
    map.set(row.restaurant_id, {
      planTier: (row.subscription_plans?.tier ?? "starter") as RestaurantSubscription["planTier"],
      planName: row.subscription_plans?.name ?? "—",
      state: row.state as SubscriptionState,
      endDate: row.end_date,
      daysRemaining: row.days_remaining,
      graceDays: row.grace_days,
    });
  }
  return map;
}

function toAdminRestaurant(row: RestaurantRow): AdminRestaurant {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    branchLabel: row.branch_label,
    isPrimary: row.is_primary,
    status: row.status as AdminRestaurant["status"],
    isVerified: row.is_verified,
    cuisine: row.cuisines?.name ?? null,
    quartier: row.quartiers?.name ?? null,
    city: row.service_areas?.city ?? null,
    description: row.description,
    phone: row.phone,
    rating: Number(row.rating),
    reviewCount: row.review_count,
    minimumOrder: row.minimum_order,
    deliveryEstimateMin: row.delivery_estimate_min,
    acceptsDelivery: row.accepts_delivery,
    acceptsPickup: row.accepts_pickup,
    ownerId: row.owner_id,
    ownerName: row.profiles?.name ?? null,
    ownerEmail: row.profiles?.email ?? null,
    createdAt: row.created_at,
    subscription: null,
  };
}

const RESTAURANT_SELECT = `
  id, slug, name, branch_label, is_primary, status, is_verified, description, phone,
  rating, review_count, minimum_order, delivery_estimate_min,
  accepts_delivery, accepts_pickup, owner_id, created_at,
  cuisines ( name ),
  quartiers ( name ),
  service_areas ( city ),
  profiles!restaurants_owner_id_fkey ( name, email )
`;

/** Every restaurant, any status. Admin only. */
export async function listRestaurantsForAdmin(): Promise<AdminRestaurant[]> {
  const supabase = createAdminClient();

  const [{ data, error }, subscriptions] = await Promise.all([
    supabase.from("restaurants").select(RESTAURANT_SELECT).order("name").order("branch_label"),
    fetchSubscriptionMap(),
  ]);

  if (error) throw describeQueryError("restaurants", error);

  return (data as unknown as RestaurantRow[]).map((row) => ({
    ...toAdminRestaurant(row),
    subscription: subscriptions.get(row.id) ?? null,
  }));
}

/* ── Users ─────────────────────────────────────────────────────────────── */

export interface AdminUser {
  id: string;
  authUserId: string;
  name: string;
  email: string;
  phone: string | null;
  avatarUrl: string | null;
  role: UserRole;
  status: UserStatus;
  deletedAt: string | null;
  createdAt: string;
  /** Restaurants this person owns, for the "Établissement" column. */
  restaurantNames: string[];
}

interface ProfileRow {
  id: string;
  auth_user_id: string;
  name: string;
  email: string;
  phone: string | null;
  avatar_url: string | null;
  role: string;
  status: string;
  deleted_at: string | null;
  created_at: string;
  restaurants: { name: string; branch_label: string }[] | null;
}

export async function listUsersForAdmin(): Promise<AdminUser[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("profiles")
    .select(
      `id, auth_user_id, name, email, phone, avatar_url, role, status,
       deleted_at, created_at,
       restaurants!restaurants_owner_id_fkey ( name, branch_label )`,
    )
    .order("created_at", { ascending: false });

  if (error) throw describeQueryError("profiles", error);

  return (data as unknown as ProfileRow[]).map((row) => ({
    id: row.id,
    authUserId: row.auth_user_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    avatarUrl: row.avatar_url,
    role: row.role as UserRole,
    status: row.status as UserStatus,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    restaurantNames: (row.restaurants ?? []).map((r) =>
      r.branch_label && r.branch_label !== "Principal" ? `${r.name} — ${r.branch_label}` : r.name,
    ),
  }));
}

/* ── Service areas ─────────────────────────────────────────────────────── */

export interface AdminServiceArea {
  id: string;
  city: string;
  country: string;
  currency: string;
  timezone: string;
  acceptingSignups: boolean;
  restaurantCount: number;
  quartiers: { id: string; name: string; isActive: boolean }[];
}

export async function listServiceAreasForAdmin(): Promise<AdminServiceArea[]> {
  const supabase = createAdminClient();

  const [areasResult, countsResult] = await Promise.all([
    supabase
      .from("service_areas")
      .select(
        `id, city, country, currency, timezone, accepting_signups,
         quartiers ( id, name, is_active, sort_order )`,
      )
      .order("city"),
    supabase.from("restaurants").select("service_area_id"),
  ]);

  if (areasResult.error) throw describeQueryError("service_areas", areasResult.error);

  // Counted in memory rather than with a GROUP BY: supabase-js has no
  // aggregate API, and at the scale of "cities we operate in" this is free.
  // When this becomes a real reporting query it belongs in SQL.
  const counts = new Map<string, number>();
  for (const row of countsResult.data ?? []) {
    const key = (row as { service_area_id: string }).service_area_id;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  interface AreaRow {
    id: string;
    city: string;
    country: string;
    currency: string;
    timezone: string;
    accepting_signups: boolean;
    quartiers: { id: string; name: string; is_active: boolean; sort_order: number }[] | null;
  }

  return (areasResult.data as unknown as AreaRow[]).map((row) => ({
    id: row.id,
    city: row.city,
    country: row.country,
    currency: row.currency,
    timezone: row.timezone,
    acceptingSignups: row.accepting_signups,
    restaurantCount: counts.get(row.id) ?? 0,
    quartiers: (row.quartiers ?? [])
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((q) => ({ id: q.id, name: q.name, isActive: q.is_active })),
  }));
}

/* ── Dashboard ─────────────────────────────────────────────────────────── */

export interface AdminOverview {
  restaurantsActive: number;
  restaurantsPending: number;
  restaurantsSuspended: number;
  usersTotal: number;
  usersCustomers: number;
  usersManagers: number;
  usersAdmins: number;
  pendingRestaurants: AdminRestaurant[];
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const supabase = createAdminClient();

  // head:true + count:'exact' asks Postgres for the count and returns no rows.
  const countOf = (table: string, column: string, value: string) =>
    supabase.from(table).select("*", { count: "exact", head: true }).eq(column, value);

  const [active, pending, suspended, users, customers, managers, admins, pendingRows] =
    await Promise.all([
      countOf("restaurants", "status", "active"),
      countOf("restaurants", "status", "pending"),
      countOf("restaurants", "status", "suspended"),
      supabase.from("profiles").select("*", { count: "exact", head: true }),
      countOf("profiles", "role", "customer"),
      countOf("profiles", "role", "manager"),
      countOf("profiles", "role", "admin"),
      supabase
        .from("restaurants")
        .select(RESTAURANT_SELECT)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

  return {
    restaurantsActive: active.count ?? 0,
    restaurantsPending: pending.count ?? 0,
    restaurantsSuspended: suspended.count ?? 0,
    usersTotal: users.count ?? 0,
    usersCustomers: customers.count ?? 0,
    usersManagers: managers.count ?? 0,
    usersAdmins: admins.count ?? 0,
    pendingRestaurants: ((pendingRows.data ?? []) as unknown as RestaurantRow[]).map(
      toAdminRestaurant,
    ),
  };
}
