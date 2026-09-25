import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { isReviewReaction, reviewNeedsAttention, type ReviewReaction } from "@/lib/reviews/attention";

/**
 * Customer reviews for one restaurant.
 *
 * Same tenant rule as every other read layer: the function takes a
 * restaurantId and filters on it. These run with the service-role key, which
 * bypasses RLS entirely, so the `.eq("restaurant_id", …)` IS the security.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  REMOVED REVIEWS ARE NOT LISTED HERE, DELIBERATELY.
 *
 *  `removed_at` is stamped by platform moderation (§14.5) and the row stops
 *  counting toward the restaurant's public rating the moment it is set. It is
 *  no longer visible to anybody outside the admin console, so showing it to
 *  the manager would offer a reply nobody can read, and would put a review in
 *  the "unanswered" count that can never be answered. The read simply stops
 *  at `.is("removed_at", null)`; /a/reviews is where a takedown is reviewed.
 * ─────────────────────────────────────────────────────────────────────────
 */

export interface RestaurantReview {
  id: string;
  /** null for a guest review, or once the account has been anonymised. */
  customerId: string | null;
  orderId: string | null;
  /** A SNAPSHOT (§12): the review keeps the name it was written under. */
  customerName: string;
  /** 1–5, checked by the schema. */
  rating: number;
  body: string;
  reply: string | null;
  repliedAt: string | null;
  /** Snapshotted name of whoever answered — 0011 added the column. */
  repliedBy: string | null;
  isReported: boolean;
  reportReason: string | null;
  /** Uploaded photos (migration 0026), in the customer's chosen order. */
  photos: string[];
  createdAt: string;
  /** Staff marked it read (0066) — clears it from "needs attention". */
  seenAt: string | null;
  /** The restaurant's one-tap public reaction (0066), shown under the review. */
  reaction: ReviewReaction | null;
}

export interface ReviewSummary {
  total: number;
  /** Mean rating over the listed reviews, or 0 when there are none. */
  average: number;
  /** Live reviews still waiting on a reply. */
  unanswered: number;
  reported: number;
}

interface DbReview {
  id: string;
  customer_id: string | null;
  order_id: string | null;
  customer_name: string;
  rating: number;
  body: string;
  reply: string | null;
  replied_at: string | null;
  replied_by: string | null;
  is_reported: boolean;
  report_reason: string | null;
  created_at: string;
  restaurant_seen_at?: string | null;
  restaurant_reaction?: string | null;
}

/** Every live review, newest first — a review list reads as a timeline. */
export async function fetchReviews(restaurantId: string): Promise<RestaurantReview[]> {
  const supabase = createAdminClient();

  const base =
    "id, customer_id, order_id, customer_name, rating, body, reply, replied_at, replied_by, is_reported, report_reason, created_at";
  const query = (columns: string) =>
    supabase
      .from("reviews")
      .select(columns)
      .eq("restaurant_id", restaurantId)
      .is("removed_at", null)
      .order("created_at", { ascending: false });
  // 0066 columns first; before that migration, the same read without them.
  let { data, error } = await query(`${base}, restaurant_seen_at, restaurant_reaction`);
  if (error && (error.code === "42703" || error.code === "PGRST204")) {
    ({ data, error } = await query(base));
  }

  if (error) {
    console.error("[reviews:fetchReviews]", error.message);
    return [];
  }

  const rows = (data ?? []) as unknown as DbReview[];

  // Photos in one round trip, keyed by review id — never N+1.
  const photoByReview = new Map<string, string[]>();
  if (rows.length > 0) {
    const { data: photoRows } = await supabase
      .from("review_photos")
      .select("review_id, url")
      .in(
        "review_id",
        rows.map((r) => r.id),
      )
      .order("sort_order");

    for (const p of (photoRows ?? []) as { review_id: string; url: string }[]) {
      const list = photoByReview.get(p.review_id) ?? [];
      list.push(p.url);
      photoByReview.set(p.review_id, list);
    }
  }

  return rows.map((r) => ({
    id: r.id,
    customerId: r.customer_id,
    orderId: r.order_id,
    customerName: r.customer_name,
    rating: r.rating,
    body: r.body,
    reply: r.reply,
    repliedAt: r.replied_at,
    repliedBy: r.replied_by,
    isReported: r.is_reported,
    reportReason: r.report_reason,
    photos: photoByReview.get(r.id) ?? [],
    createdAt: r.created_at,
    seenAt: r.restaurant_seen_at ?? null,
    reaction: isReviewReaction(r.restaurant_reaction) ? r.restaurant_reaction : null,
  }));
}

/**
 * The header figures, folded once on the server.
 *
 * `unanswered` excludes reported reviews on purpose: a review that is already
 * with the moderators is not a reply the restaurant is expected to write, and
 * counting it would keep a badge lit on work nobody can close.
 */
export function reviewSummary(rows: RestaurantReview[]): ReviewSummary {
  let ratingSum = 0;
  let unanswered = 0;
  let reported = 0;

  for (const row of rows) {
    ratingSum += row.rating;
    if (row.isReported) reported += 1;
    else if (reviewNeedsAttention(row)) unanswered += 1;
  }

  return {
    total: rows.length,
    average: rows.length > 0 ? ratingSum / rows.length : 0,
    unanswered,
    reported,
  };
}
