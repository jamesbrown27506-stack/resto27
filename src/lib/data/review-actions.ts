"use server";

import { revalidatePath } from "next/cache";
import { getTranslator } from "@/lib/i18n/locale-server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/branch";
import { writeAudit } from "./platform-actions";
import { notify } from "@/lib/notify";
import type { ActionResult } from "./admin-actions";
import { isReviewReaction } from "@/lib/reviews/attention";

/**
 * Review moderation, restaurant side.
 *
 * Replying is `replyToReview` in manager-actions.ts and stays there — the
 * screen imports it from where it lives rather than through a re-export, so
 * there is exactly one definition of what a reply does.
 *
 * Same two rules as every manager action: the capability is re-checked here —
 * a Server Action is a POST endpoint that never passes through the layout
 * guarding its page — and the branch comes from the SESSION, never from an
 * argument, so a review id belonging to another restaurant matches nothing.
 */

/**
 * Report a review to platform moderation.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE REASON IS REQUIRED, AND THAT IS THE POINT.
 *
 *  `report_reason` is the only thing a platform moderator reads before
 *  choosing between "dismiss" and "remove" (§14.5); a flag with no reason is
 *  a decision they cannot make. It is also what stops reporting from being a
 *  one-tap way to bury an honest one-star review — a restaurant that has to
 *  write down why thinks about whether it can.
 *
 *  Reporting does NOT hide anything. The review stays published while the
 *  platform looks at it; only `removeReview` on the admin side takes it down.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function reportReview(reviewId: string, reason: string): Promise<ActionResult> {
  const t = await getTranslator();
  const { active, profile } = await requireCapability("reviews.reply");

  const trimmed = reason.trim();
  if (trimmed.length < 5) {
    return { ok: false, error: t("est.reportReasonRequired") };
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("reviews")
    .update({ is_reported: true, report_reason: trimmed })
    .eq("id", reviewId)
    .eq("restaurant_id", active.restaurantId)
    // A review the platform has already taken down is not reportable, and
    // re-flagging it would put it back in the moderation queue.
    .is("removed_at", null)
    .select("id");

  if (error) {
    console.error("[reviews:reportReview]", reviewId, error.message);
    return { ok: false, error: t("est.reportFailed") };
  }

  // Nothing matched: wrong branch, or removed while the dialog was open.
  // Reporting that as a success is the exact lie this action exists to end.
  if ((data ?? []).length === 0) return { ok: false, error: t("est.reviewGone") };

  // Never throws (§9): losing the trail must not undo the report it records.
  await writeAudit(profile, {
    action: "review.reported",
    entityType: "review",
    entityId: reviewId,
    summary: `${active.restaurantName} reported a review: ${trimmed}`,
  });

  // Moderation is a human queue — the platform must know the moment a review
  // was flagged, not when an admin happens to open the page.
  await notify({
    event: "moderation",
    tone: "warning",
    admins: true,
    href: "/a/reviews",
    params: { restaurantName: active.restaurantName, reason: trimmed },
  });

  revalidatePath("/m/reviews");
  return { ok: true };
}

/* ── "J'ai lu" and quick reactions (0066) ──────────────────────────────── */

function refreshReviewScreens() {
  revalidatePath("/m/reviews");
  revalidatePath("/m");
}

/**
 * The columns these actions write (restaurant_seen_at, restaurant_reaction)
 * arrive with migration 0066. Without it Postgres answers 42703 and
 * PostgREST PGRST204 — say THAT, instead of a generic "try again" that no
 * retry can ever fix (or, worse, "this review is gone" when it is not).
 */
function schemaMissing(error: { code?: string } | null): boolean {
  return Boolean(error && (error.code === "42703" || error.code === "PGRST204"));
}

/**
 * Acknowledge a review without answering it: it leaves the dashboard's
 * "needs attention" count (lib/reviews/attention). Nobody is notified.
 */
export async function markReviewSeen(reviewId: string): Promise<ActionResult> {
  const t = await getTranslator();
  const { active } = await requireCapability("reviews.reply");
  const { data, error } = await createAdminClient()
    .from("reviews")
    .update({ restaurant_seen_at: new Date().toISOString() })
    .eq("id", reviewId)
    .eq("restaurant_id", active.restaurantId)
    .is("removed_at", null)
    .select("id");
  if (error) {
    console.error("[reviews:markSeen]", reviewId, error.code, error.message);
    return { ok: false, error: t(schemaMissing(error) ? "est.reviewSchemaMissing" : "est.reviewUpdateFailed") };
  }
  if ((data ?? []).length === 0) return { ok: false, error: t("est.reviewGone") };
  refreshReviewScreens();
  return { ok: true };
}

/** "Tout marquer comme lu" — every review of this branch not yet seen. */
export async function markAllReviewsSeen(): Promise<ActionResult> {
  const t = await getTranslator();
  const { active } = await requireCapability("reviews.reply");
  const { error } = await createAdminClient()
    .from("reviews")
    .update({ restaurant_seen_at: new Date().toISOString() })
    .eq("restaurant_id", active.restaurantId)
    .is("restaurant_seen_at", null)
    .is("removed_at", null);
  if (error) {
    console.error("[reviews:markAllSeen]", error.code, error.message);
    return { ok: false, error: t(schemaMissing(error) ? "est.reviewSchemaMissing" : "est.reviewUpdateFailed") };
  }
  refreshReviewScreens();
  return { ok: true };
}

/**
 * A one-tap public reaction (heart / thanks / like), or `null` to take it
 * back. Shown under the review on the restaurant's page; the customer is
 * told the first time a reaction is added (changing it does not notify again).
 */
export async function reactToReview(reviewId: string, reaction: string | null): Promise<ActionResult> {
  const t = await getTranslator();
  const { active } = await requireCapability("reviews.reply");
  if (reaction !== null && !isReviewReaction(reaction)) return { ok: false, error: t("est.reviewUpdateFailed") };

  const supabase = createAdminClient();
  const { data: before, error: readError } = await supabase
    .from("reviews")
    .select("id, customer_id, restaurant_reaction")
    .eq("id", reviewId)
    .eq("restaurant_id", active.restaurantId)
    .is("removed_at", null)
    .maybeSingle();
  // A failed READ is not "the review is gone" — that message used to hide a
  // missing column behind a claim that was simply false.
  if (readError) {
    console.error("[reviews:react:read]", reviewId, readError.code, readError.message);
    return { ok: false, error: t(schemaMissing(readError) ? "est.reviewSchemaMissing" : "est.reviewUpdateFailed") };
  }
  if (!before) return { ok: false, error: t("est.reviewGone") };

  const { error } = await supabase
    .from("reviews")
    .update({
      restaurant_reaction: reaction,
      restaurant_reacted_at: reaction ? new Date().toISOString() : null,
    })
    .eq("id", reviewId)
    .eq("restaurant_id", active.restaurantId);
  if (error) {
    console.error("[reviews:react]", reviewId, error.code, error.message);
    return { ok: false, error: t(schemaMissing(error) ? "est.reviewSchemaMissing" : "est.reviewUpdateFailed") };
  }

  if (reaction && !before.restaurant_reaction && before.customer_id) {
    await notify({
      event: "review_reply",
      tone: "success",
      customerId: before.customer_id as string,
      href: "/reviews",
      params: { restaurantName: active.restaurantName, reaction },
    });
  }
  refreshReviewScreens();
  return { ok: true };
}
