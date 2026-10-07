import "server-only";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Sales analytics for one restaurant (/m/reports).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  EVERY FIGURE ON THIS PAGE IS A GROUP BY, SO NONE OF THEM IS A QUERY.
 *
 *  PostgREST cannot express GROUP BY. Migration 0011 puts the six aggregates
 *  this screen needs into SQL functions granted to `service_role` alone, and
 *  `p_restaurant` carries the tenant boundary down with them — the same rule
 *  as every read layer here, one level lower. The id comes from
 *  requireCapability(), never from a URL or a form field.
 *
 *  REVENUE IS `subtotal - discount_amount`, WITH CANCELLED ORDERS EXCLUDED
 *  (0079). Platform-funded points do not reduce restaurant sales. The delivery fee is the rider's money, not the kitchen's, and a
 *  restaurant that delivers would otherwise look like it out-earns one that
 *  does not at identical volume. Buckets are cut in Africa/Douala, so a peak
 *  at 20:00 is a Cameroonian dinner rush rather than a UTC artefact.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  ALL SIX CALLS FAIL SOFT, AND THAT IS NOT DEFENSIVE PADDING.
 *
 *  0011 is what creates these functions. Until it has been run PostgREST
 *  answers PGRST202 — "function not found" — and a page that rethrows it is a
 *  page the restaurant cannot open to find out what is wrong. Each call logs
 *  and degrades to nothing, which renders as "not enough data yet"; the
 *  server console is where the reason belongs.
 * ─────────────────────────────────────────────────────────────────────────
 */

export const REPORT_RANGES = ["7d", "30d", "90d", "12m"] as const;

export type ReportRange = (typeof REPORT_RANGES)[number];

/** The unit `manager_sales_series` groups on. Whitelisted in SQL too. */
export type ReportBucket = "day" | "week" | "month";

/** Narrow a query-string value. Never hand an unvalidated string downwards. */
export function isReportRange(value: unknown): value is ReportRange {
  return typeof value === "string" && (REPORT_RANGES as readonly string[]).includes(value);
}

export interface SalesSummary {
  orderCount: number;
  /** Whole XAF, delivery excluded. */
  revenue: number;
  /** Distinct people, registered or grouped by phone. */
  customerCount: number;
  /** Cancelled orders in the window — counted, never billed. */
  cancelled: number;
}

export interface SeriesPoint {
  /** Bucket start, canonical UTC ISO. Cut on Africa/Douala boundaries. */
  bucket: string;
  revenue: number;
  orderCount: number;
}

export interface WeekdayPoint {
  /** 0 = Sunday, matching JS getDay(). */
  dow: number;
  revenue: number;
  orderCount: number;
}

export interface HourPoint {
  /** 0–23, Africa/Douala. */
  hour: number;
  revenue: number;
  orderCount: number;
}

export interface MixSlice {
  /** 'delivery' | 'pickup' | 'dine_in' — left as text; the UI maps what it knows. */
  type: string;
  revenue: number;
  orderCount: number;
}

export interface TopDish {
  /** The SNAPSHOTTED name (§12) — the dish may since have been renamed or deleted. */
  name: string;
  quantity: number;
  revenue: number;
  orderCount: number;
}

export interface ReportData {
  range: ReportRange;
  bucket: ReportBucket;
  /** Window start, inclusive. Canonical UTC ISO. */
  from: string;
  /** Window end, exclusive. */
  to: string;
  summary: SalesSummary;
  series: SeriesPoint[];
  weekdays: WeekdayPoint[];
  hours: HourPoint[];
  mix: MixSlice[];
  topDishes: TopDish[];
  /**
   * Whether there is anything to draw. Decided here so the six panels agree on
   * one answer — a page that shows a headline figure above five empty charts
   * reads as broken software rather than as a quiet month.
   */
  hasData: boolean;
}

const EMPTY_SUMMARY: SalesSummary = {
  orderCount: 0,
  revenue: 0,
  customerCount: 0,
  cancelled: 0,
};

/** Ten is what fits on a phone without becoming a second menu. */
const TOP_DISH_LIMIT = 10;

const BUCKET: Record<ReportRange, ReportBucket> = {
  "7d": "day",
  "30d": "day",
  "90d": "week",
  "12m": "month",
};

const DAYS: Record<"7d" | "30d" | "90d", number> = { "7d": 7, "30d": 30, "90d": 90 };

/**
 * Africa/Douala is UTC+1 all year — no DST, ever (0011 §2). A fixed offset is
 * therefore exact, and it is what lets the boundaries below be computed with
 * plain arithmetic instead of a round trip through Intl parts.
 */
const DOUALA_OFFSET_MS = 60 * 60 * 1000;

/**
 * The [from, to) window for a range, cut on LOCAL boundaries.
 *
 * `from` is aligned to the start of a Douala day (or month) rather than to
 * "now minus N × 24h", because the SQL buckets on local days: an unaligned
 * start makes the first column of every chart a partial day that reads as a
 * collapse in sales.
 */
function windowFor(range: ReportRange, now: Date): { from: Date; to: Date } {
  const local = new Date(now.getTime() + DOUALA_OFFSET_MS);

  if (range === "12m") {
    // Day first, then month: setUTCMonth on the 31st would skip February.
    local.setUTCDate(1);
    local.setUTCHours(0, 0, 0, 0);
    local.setUTCMonth(local.getUTCMonth() - 11);
  } else {
    local.setUTCHours(0, 0, 0, 0);
    // Minus (N − 1): "7 days" means today and the six before it, not eight
    // columns on the chart.
    local.setUTCDate(local.getUTCDate() - (DAYS[range] - 1));
  }

  return { from: new Date(local.getTime() - DOUALA_OFFSET_MS), to: now };
}

/**
 * bigint arrives as a JSON number today and as a string the day PostgREST's
 * bigint handling is configured differently. Arithmetic on "12" is "012".
 */
function num(value: number | string | null | undefined): number {
  return Number(value) || 0;
}

type Admin = ReturnType<typeof createAdminClient>;

async function loadSummary(
  supabase: Admin,
  params: Record<string, string>,
): Promise<SalesSummary> {
  const { data, error } = await supabase.rpc("manager_sales_summary", params);

  if (error) {
    console.error("[reports:summary]", error.message);
    return EMPTY_SUMMARY;
  }

  // `returns table` with one row still arrives as an array.
  const row = ((data ?? []) as Record<string, number | string>[])[0];
  if (!row) return EMPTY_SUMMARY;

  return {
    orderCount: num(row.order_count),
    revenue: num(row.revenue),
    customerCount: num(row.customer_count),
    cancelled: num(row.cancelled),
  };
}

async function loadSeries(
  supabase: Admin,
  params: Record<string, string>,
  bucket: ReportBucket,
): Promise<SeriesPoint[]> {
  const { data, error } = await supabase.rpc("manager_sales_series", {
    ...params,
    p_bucket: bucket,
  });

  if (error) {
    console.error("[reports:series]", error.message);
    return [];
  }

  return ((data ?? []) as { bucket: string | null; revenue: number | string; order_count: number | string }[])
    .map((row) => {
      // Normalised to canonical UTC ISO here so the client can drop it into a
      // formatter and into `<time dateTime>` without re-parsing an offset.
      const at = row.bucket ? new Date(row.bucket) : null;
      if (!at || Number.isNaN(at.getTime())) return null;

      return {
        bucket: at.toISOString(),
        revenue: num(row.revenue),
        orderCount: num(row.order_count),
      } satisfies SeriesPoint;
    })
    .filter((point): point is SeriesPoint => point !== null);
}

async function loadWeekdays(
  supabase: Admin,
  params: Record<string, string>,
): Promise<WeekdayPoint[]> {
  const { data, error } = await supabase.rpc("manager_sales_by_weekday", params);

  if (error) {
    console.error("[reports:weekday]", error.message);
    return [];
  }

  return ((data ?? []) as { dow: number | string; revenue: number | string; order_count: number | string }[]).map(
    (row) => ({
      dow: num(row.dow),
      revenue: num(row.revenue),
      orderCount: num(row.order_count),
    }),
  );
}

async function loadHours(supabase: Admin, params: Record<string, string>): Promise<HourPoint[]> {
  const { data, error } = await supabase.rpc("manager_peak_hours", params);

  if (error) {
    console.error("[reports:hours]", error.message);
    return [];
  }

  return (
    (data ?? []) as { hour_of_day: number | string; revenue: number | string; order_count: number | string }[]
  ).map((row) => ({
    hour: num(row.hour_of_day),
    revenue: num(row.revenue),
    orderCount: num(row.order_count),
  }));
}

async function loadMix(supabase: Admin, params: Record<string, string>): Promise<MixSlice[]> {
  const { data, error } = await supabase.rpc("manager_order_mix", params);

  if (error) {
    console.error("[reports:mix]", error.message);
    return [];
  }

  return ((data ?? []) as { order_type: string | null; revenue: number | string; order_count: number | string }[]).map(
    (row) => ({
      type: row.order_type ?? "",
      revenue: num(row.revenue),
      orderCount: num(row.order_count),
    }),
  );
}

async function loadTopDishes(
  supabase: Admin,
  params: Record<string, string>,
): Promise<TopDish[]> {
  const { data, error } = await supabase.rpc("manager_top_dishes", {
    ...params,
    p_limit: TOP_DISH_LIMIT,
  });

  if (error) {
    console.error("[reports:topDishes]", error.message);
    return [];
  }

  return (
    (data ?? []) as {
      name: string | null;
      quantity: number | string;
      revenue: number | string;
      order_count: number | string;
    }[]
  ).map((row) => ({
    name: (row.name ?? "").trim(),
    quantity: num(row.quantity),
    revenue: num(row.revenue),
    orderCount: num(row.order_count),
  }));
}

/**
 * Everything /m/reports draws, in one round trip's worth of latency.
 *
 * Six independent aggregates over the same window, so they go out together —
 * sequentially this is six times the wait on the mobile connections this
 * audience is on, for no extra correctness.
 *
 * THE WINDOW IS COMPUTED HERE, on the server. A component that worked out its
 * own boundaries would read the browser's clock and its timezone, and a
 * manager in Paris would then be shown a different "last 7 days" than the
 * kitchen in Douala.
 */
export async function fetchReports(
  restaurantId: string,
  range: ReportRange,
): Promise<ReportData> {
  const supabase = createAdminClient();
  const bucket = BUCKET[range];
  const { from, to } = windowFor(range, new Date());

  const params = {
    p_restaurant: restaurantId,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  };

  const [summary, series, weekdays, hours, mix, topDishes] = await Promise.all([
    loadSummary(supabase, params),
    loadSeries(supabase, params, bucket),
    loadWeekdays(supabase, params),
    loadHours(supabase, params),
    loadMix(supabase, params),
    loadTopDishes(supabase, params),
  ]);

  return {
    range,
    bucket,
    from: from.toISOString(),
    to: to.toISOString(),
    summary,
    series,
    weekdays,
    hours,
    mix,
    topDishes,
    // Either half can be the one that survives a partial outage, so neither is
    // trusted alone.
    hasData: summary.orderCount > 0 || series.length > 0,
  };
}
