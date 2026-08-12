import "server-only";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Reads for the restaurant's public profile (/m/profile).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  fetchRestaurantProfile TAKES A restaurantId AND FILTERS ON IT.
 *
 *  Same tenant boundary as lib/data/manager.ts: these run with the
 *  service-role key, which bypasses RLS entirely, so the `.eq("id", …)` and
 *  `.eq("restaurant_id", …)` below are the security, not a convenience. The id
 *  must come from `requireCapability()`, never from a URL or a form field.
 *
 *  `cuisines` and `quartiers` are the exception: they are platform-wide
 *  reference data with no tenant column at all, so there is nothing to scope
 *  them to.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** One weekday's hours. `weekday` is 0 = Sunday, matching the column's check. */
export interface OpeningHour {
  weekday: number;
  /** "HH:MM", or null for closed. */
  opensAt: string | null;
  closesAt: string | null;
  /**
   * False when no row exists for this weekday.
   *
   * NULL/NULL means "we are shut that day"; a missing row means "we have never
   * said". The public page has to tell those apart, so the form does too —
   * otherwise a manager cannot see which days they have yet to answer for.
   */
  isRecorded: boolean;
}

export interface RestaurantProfile {
  id: string;
  slug: string;
  name: string;
  branchLabel: string;
  description: string;
  phone: string;
  addressLine: string;
  logoUrl: string | null;
  coverUrl: string | null;
  cuisineId: string | null;
  /** Kept alongside the id so a retired lookup row still renders its own name. */
  cuisineName: string | null;
  quartierId: string | null;
  quartierName: string | null;
  serviceAreaId: string;
  deliveryEstimateMin: number;
  minimumOrder: number;
  acceptsDelivery: boolean;
  acceptsPickup: boolean;
  /** Always seven entries, index === weekday, so the form never has holes. */
  hours: OpeningHour[];
}

export interface LookupOption {
  id: string;
  name: string;
}

/**
 * Postgres returns `time` as "11:00:00"; <input type="time"> wants "HH:MM".
 * Trimmed here rather than in the form, so the client never sees two shapes.
 */
function toHourMinute(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.slice(0, 5);
}

const RESTAURANT_COLUMNS = `id, slug, name, branch_label, description, phone, address_line,
   logo_url, cover_url, cuisine_id, quartier_id, service_area_id,
   delivery_estimate_min, minimum_order, accepts_delivery, accepts_pickup,
   cuisines ( name ), quartiers ( name )`;

interface DbRestaurant {
  id: string;
  slug: string;
  name: string;
  branch_label: string;
  description: string | null;
  phone: string | null;
  address_line: string | null;
  logo_url: string | null;
  cover_url: string | null;
  cuisine_id: string | null;
  quartier_id: string | null;
  service_area_id: string;
  delivery_estimate_min: number;
  minimum_order: number;
  accepts_delivery: boolean;
  accepts_pickup: boolean;
  cuisines: { name: string } | null;
  quartiers: { name: string } | null;
}

export async function fetchRestaurantProfile(restaurantId: string): Promise<RestaurantProfile | null> {
  const supabase = createAdminClient();

  const [{ data, error }, { data: hourRows, error: hoursError }] = await Promise.all([
    supabase.from("restaurants").select(RESTAURANT_COLUMNS).eq("id", restaurantId).maybeSingle(),
    supabase
      .from("restaurant_hours")
      .select("weekday, opens_at, closes_at")
      .eq("restaurant_id", restaurantId),
  ]);

  if (error) {
    console.error("[profile:fetchRestaurantProfile]", error.message);
    return null;
  }
  if (!data) return null;

  // Hours failing is not worth losing the whole screen over — the seven
  // fallback rows below render as "not set" and can still be filled in.
  if (hoursError) console.error("[profile:fetchRestaurantProfile] hours", hoursError.message);

  const byWeekday = new Map<number, { opens_at: string | null; closes_at: string | null }>();
  for (const row of (hourRows ?? []) as { weekday: number; opens_at: string | null; closes_at: string | null }[]) {
    byWeekday.set(row.weekday, row);
  }

  const r = data as unknown as DbRestaurant;

  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    branchLabel: r.branch_label,
    description: r.description ?? "",
    phone: r.phone ?? "",
    addressLine: r.address_line ?? "",
    logoUrl: r.logo_url,
    coverUrl: r.cover_url,
    cuisineId: r.cuisine_id,
    cuisineName: r.cuisines?.name ?? null,
    quartierId: r.quartier_id,
    quartierName: r.quartiers?.name ?? null,
    serviceAreaId: r.service_area_id,
    deliveryEstimateMin: r.delivery_estimate_min,
    minimumOrder: r.minimum_order,
    acceptsDelivery: r.accepts_delivery,
    acceptsPickup: r.accepts_pickup,
    hours: Array.from({ length: 7 }, (_, weekday) => {
      const row = byWeekday.get(weekday);
      return {
        weekday,
        opensAt: toHourMinute(row?.opens_at),
        closesAt: toHourMinute(row?.closes_at),
        isRecorded: row !== undefined,
      };
    }),
  };
}

/** The cuisine list behind the public directory's filter. Active rows only. */
export async function fetchCuisines(): Promise<LookupOption[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("cuisines")
    .select("id, name")
    .eq("is_active", true)
    .order("sort_order");

  if (error) {
    console.error("[profile:fetchCuisines]", error.message);
    return [];
  }

  return (data ?? []) as LookupOption[];
}

/**
 * Neighbourhoods, scoped to one service area when given.
 *
 * Unscoped it would offer a Douala restaurant the Yaoundé list, which is not a
 * choice anybody wants to make by accident.
 */
export async function fetchQuartiers(serviceAreaId?: string): Promise<LookupOption[]> {
  const supabase = createAdminClient();

  let query = supabase
    .from("quartiers")
    .select("id, name")
    .eq("is_active", true)
    .order("sort_order");

  if (serviceAreaId) query = query.eq("service_area_id", serviceAreaId);

  const { data, error } = await query;

  if (error) {
    console.error("[profile:fetchQuartiers]", error.message);
    return [];
  }

  return (data ?? []) as LookupOption[];
}
