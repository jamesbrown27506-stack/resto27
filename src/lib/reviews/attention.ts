/**
 * WHICH REVIEWS STILL NEED THE RESTAURANT (0066). Pure.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  "N avis sans réponse" used to count every review without a written reply,
 *  so a 5★ "très bon !" stayed on the dashboard for ever. Now a review stops
 *  asking for attention when the restaurant:
 *    · wrote a reply, or
 *    · marked it as read ("J'ai lu"), or
 *    · reacted to it (❤️ 🙏 👍) — for a 3★+ review only. A 1–2★ review is
 *      where a written answer matters for the restaurant's image, so a
 *      reaction alone does not clear it (a reply or "J'ai lu" does).
 *  Reported reviews are with the moderators and never count.
 * ─────────────────────────────────────────────────────────────────────────
 */

export type ReviewReaction = "heart" | "thanks" | "like";
export const REVIEW_REACTIONS: readonly ReviewReaction[] = ["heart", "thanks", "like"];
export const REACTION_EMOJI: Record<ReviewReaction, string> = { heart: "❤️", thanks: "🙏", like: "👍" };

export function isReviewReaction(value: unknown): value is ReviewReaction {
  return typeof value === "string" && (REVIEW_REACTIONS as readonly string[]).includes(value);
}

export function reviewNeedsAttention(review: {
  rating: number;
  reply: string | null;
  isReported: boolean;
  seenAt: string | null;
  reaction: ReviewReaction | null;
}): boolean {
  if (review.isReported) return false;
  if (review.reply) return false;
  if (review.seenAt) return false;
  if (review.reaction && review.rating >= 3) return false;
  return true;
}
