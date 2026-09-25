/**
 * WHICH REVIEWS STILL NEED THE RESTAURANT (0066). Pure.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  "N avis sans réponse" used to count every review without a written reply,
 *  so a 5★ "très bon !" stayed on the dashboard for ever. Now a review stops
 *  asking for attention when the restaurant:
 *    · wrote a reply, or
 *    · marked it as read ("J'ai lu"), or
 *    · reacted to it (heart / thanks / like — Lucide icons, never emojis).
 *  Any of the three means the restaurant has dealt with it, whatever the
 *  rating (owner's call, Sep 2026: a reaction left on a low rating still
 *  showed as "to handle", which read as a bug).
 *  Reported reviews are with the moderators and never count.
 * ─────────────────────────────────────────────────────────────────────────
 */

export type ReviewReaction = "heart" | "thanks" | "like";
export const REVIEW_REACTIONS: readonly ReviewReaction[] = ["heart", "thanks", "like"];

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
  if (review.reaction) return false;
  return true;
}
