"use client";

import { useState, useTransition } from "react";
import { Flag, Info, ShieldCheck, Trash2 } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { RatingStars } from "@/components/ui/rating-stars";
import { useToast } from "@/components/ui/toast";
import { formatDate, isoAttr } from "@/lib/format/datetime";
import { dismissReviewReport, removeReview } from "@/lib/data/platform-actions";
import type { ReviewRow } from "@/lib/data/platform";

/**
 * Review moderation (§14.5).
 *
 * TWO OUTCOMES ONLY: dismiss the report, or remove the review. There is
 * deliberately no edit control — rewriting someone's words and leaving their
 * name attached is worse than either option.
 */
export function ReviewsModeration({ reviews }: { reviews: ReviewRow[] }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [removing, setRemoving] = useState<ReviewRow | null>(null);

  function act(fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const result = await fn();
      if (result.ok) toast(success, "success");
      else toast(result.error ?? "Something went wrong.", "error");
    });
  }

  return (
    <>
      <p className="mb-6 flex max-w-3xl items-start gap-2.5 rounded-md border border-border bg-surface-2 p-4 text-sm text-text-secondary">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <span>
          Two outcomes: <strong className="text-text">dismiss the report</strong> or{" "}
          <strong className="text-text">remove the review</strong>. We never edit the content —
          rewriting someone&apos;s words under their own name is worse than either. Removing
          recalculates the restaurant&apos;s rating.
        </span>
      </p>

      {reviews.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState
            icon={<ShieldCheck />}
            title="Nothing reported"
            description="Reviews flagged by restaurants appear here for moderation."
          />
        </div>
      ) : (
        <ul className="flex max-w-3xl flex-col gap-4">
          {reviews.map((review) => (
            <li key={review.id} className="rounded-lg border border-error/30 bg-surface p-5">
              <div className="flex items-center gap-2 rounded-md bg-error-light px-3 py-2 text-sm text-error">
                <Flag className="size-3.5 shrink-0" aria-hidden />
                <span className="font-semibold">Reported:</span>
                <span>{review.reportReason ?? "no reason given"}</span>
              </div>

              <div className="mt-4 flex items-start gap-3">
                <Avatar name={review.customerName} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <p className="font-semibold">{review.customerName}</p>
                    <RatingStars value={review.rating} size="sm" />
                    <time dateTime={isoAttr(review.createdAt)} className="text-xs text-text-light">
                      {formatDate(review.createdAt)}
                    </time>
                  </div>
                  <p className="mt-1 text-sm text-text-secondary">
                    On <strong className="text-text">{review.restaurantName}</strong>
                  </p>
                  <blockquote className="mt-3 rounded-md bg-surface-2 p-3.5 leading-relaxed text-text-secondary">
                    {review.body}
                  </blockquote>

                  {review.reply && (
                    <div className="mt-3 rounded-md border-l-2 border-primary bg-primary-light p-3">
                      <p className="text-xs font-bold tracking-wide text-primary uppercase">
                        Restaurant&apos;s reply
                      </p>
                      <p className="mt-1 text-sm text-text-secondary">{review.reply}</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    act(
                      () => dismissReviewReport(review.id),
                      "Report dismissed. The review stays published.",
                    )
                  }
                >
                  <ShieldCheck className="size-4" aria-hidden />
                  <span>Dismiss report</span>
                </Button>
                <Button variant="danger" disabled={pending} onClick={() => setRemoving(review)}>
                  <Trash2 className="size-4" aria-hidden />
                  <span>Remove review</span>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          const review = removing;
          setRemoving(null);
          if (review) act(() => removeReview(review.id), "Review removed and rating recalculated.");
        }}
        title="Remove this review?"
        message="It disappears from the restaurant's public page and its rating is recalculated. The row is kept with a removal stamp, so the moderation decision stays auditable. Recorded against your account."
        confirmLabel="Remove review"
        destructive
      />
    </>
  );
}
