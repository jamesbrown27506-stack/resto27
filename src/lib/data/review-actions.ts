"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/branch";
import { writeAudit } from "./platform-actions";
import type { ActionResult } from "./admin-actions";

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
  const { active, profile } = await requireCapability("reviews.reply");

  const trimmed = reason.trim();
  if (trimmed.length < 5) {
    return { ok: false, error: "Say what the problem is — a moderator reads this." };
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
    return { ok: false, error: "Could not report the review." };
  }

  // Nothing matched: wrong branch, or removed while the dialog was open.
  // Reporting that as a success is the exact lie this action exists to end.
  if ((data ?? []).length === 0) return { ok: false, error: "That review is no longer available." };

  // Never throws (§9): losing the trail must not undo the report it records.
  await writeAudit(profile, {
    action: "review.reported",
    entityType: "review",
    entityId: reviewId,
    summary: `${active.restaurantName} reported a review: ${trimmed}`,
  });

  revalidatePath("/m/reviews");
  return { ok: true };
}
