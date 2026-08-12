"use client";

import { useState, useTransition } from "react";
import { Flag, MessageSquare, Star } from "lucide-react";
import { FilterChips } from "@/components/data/filter-bar";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Textarea } from "@/components/ui/input";
import { RatingStars } from "@/components/ui/rating-stars";
import { StatTile } from "@/components/ui/stat-tile";
import { useToast } from "@/components/ui/toast";
import { isoAttr } from "@/lib/format/datetime";
import { useDates } from "@/lib/format/use-dates";
import { replyToReview } from "@/lib/data/manager-actions";
import { reportReview } from "@/lib/data/review-actions";
import { useLocale } from "@/lib/i18n/use-locale";
import type { RestaurantReview, ReviewSummary } from "@/lib/data/reviews";

/** Both server actions refuse anything shorter, so the buttons match them. */
const MIN_REPLY = 5;
const MIN_REASON = 5;

/**
 * Reviews, on live rows.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE LIST IS A PROP AND STAYS A PROP.
 *
 *  The old version copied the reviews into useState and wrote the reply into
 *  that copy, so the screen showed a reply the database never received. Both
 *  actions here revalidate /m/reviews, the Server Component re-runs, and this
 *  component re-renders with the new rows. Nothing about a review is mirrored
 *  in state — the dialogs hold an ID and look the row up again on every
 *  render, so an open dialog follows the data instead of freezing it.
 *
 *  Removed reviews never arrive here: fetchReviews stops at
 *  `removed_at is null`, because a review the platform has taken down is not
 *  the restaurant's to answer.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function ReviewsView({
  reviews,
  summary,
}: {
  reviews: RestaurantReview[];
  summary: ReviewSummary;
}) {
  const { t } = useLocale();
  const dates = useDates();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [filter, setFilter] = useState("all");
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [reportingId, setReportingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [reason, setReason] = useState("");

  // Derived, never stored: if the row vanishes between two revalidations the
  // dialog closes itself rather than acting on something that is gone.
  const replying = reviews.find((r) => r.id === replyingId) ?? null;
  const reporting = reviews.find((r) => r.id === reportingId) ?? null;

  /** `customer_name` is a non-null snapshot, but nothing stops it being blank. */
  const nameOf = (review: RestaurantReview) => review.customerName.trim() || t("mrv.anonymous");

  const answered = reviews.filter((r) => Boolean(r.reply)).length;

  const average = new Intl.NumberFormat(dates.locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(summary.average);

  const visible = reviews.filter((review) => {
    if (filter === "unanswered") return !review.reply && !review.isReported;
    if (filter === "answered") return Boolean(review.reply);
    if (filter === "reported") return review.isReported;
    return true;
  });

  function submitReply() {
    if (!replying) return;
    const id = replying.id;

    startTransition(async () => {
      const result = await replyToReview(id, draft);
      if (!result.ok) return toast(result.error, "error");
      setReplyingId(null);
      setDraft("");
      toast(t("mrv.reply.done"), "success");
    });
  }

  function submitReport() {
    if (!reporting) return;
    const id = reporting.id;

    startTransition(async () => {
      const result = await reportReview(id, reason);
      if (!result.ok) return toast(result.error, "error");
      setReportingId(null);
      setReason("");
      toast(t("mrv.report.done"), "success");
    });
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label={t("mrv.stat.average")}
          value={average}
          hint={t("mrv.stat.averageHint", { count: summary.total })}
          icon={<Star />}
          tone="primary"
        />
        <StatTile
          label={t("mrv.stat.unanswered")}
          value={summary.unanswered}
          hint={t("mrv.stat.unansweredHint")}
          icon={<MessageSquare />}
          positiveIsGood={false}
        />
        <StatTile
          label={t("mrv.stat.reported")}
          value={summary.reported}
          hint={t("mrv.stat.reportedHint")}
          icon={<Flag />}
          positiveIsGood={false}
        />
      </div>

      <div className="mt-6">
        <FilterChips
          items={[
            { value: "all", label: t("mrv.filter.all"), count: summary.total },
            { value: "unanswered", label: t("mrv.filter.unanswered"), count: summary.unanswered },
            { value: "answered", label: t("mrv.filter.answered"), count: answered },
            { value: "reported", label: t("mrv.filter.reported"), count: summary.reported },
          ]}
          value={filter}
          onChange={setFilter}
        />
      </div>

      <div className="mt-5">
        {visible.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface">
            {/* An empty database and an empty filter are different facts, and
                telling a new restaurant "no results" reads as a fault. */}
            <EmptyState
              icon={reviews.length === 0 ? <Star /> : <MessageSquare />}
              title={reviews.length === 0 ? t("mrv.empty.title") : t("mrv.noResults.title")}
              description={reviews.length === 0 ? t("mrv.empty.body") : t("mrv.noResults.body")}
            />
          </div>
        ) : (
          <ul className="flex flex-col gap-4">
            {visible.map((review) => (
              <li key={review.id} className="rounded-lg border border-border bg-surface p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <Avatar name={nameOf(review)} size="md" />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <p className="font-semibold">{nameOf(review)}</p>
                      <RatingStars value={review.rating} size="sm" />
                      <time dateTime={isoAttr(review.createdAt)} className="text-xs text-text-light">
                        {dates.date(review.createdAt)}
                      </time>
                    </div>

                    {review.body.trim() ? (
                      <p className="mt-2 leading-relaxed text-text-secondary">{review.body}</p>
                    ) : (
                      <p className="mt-2 text-sm text-text-light italic">
                        <span>{t("mrv.noBody")}</span>
                      </p>
                    )}

                    {review.isReported && (
                      <div className="mt-3 rounded-md border border-error/25 bg-error-light p-2.5 text-sm text-error">
                        <p className="flex items-start gap-2">
                          <Flag className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                          <span>
                            {t("mrv.reportedBanner", { reason: review.reportReason ?? "—" })}
                          </span>
                        </p>
                        <p className="mt-1 pl-5.5 text-xs opacity-85">
                          <span>{t("mrv.reportedPending")}</span>
                        </p>
                      </div>
                    )}

                    {review.reply ? (
                      <div className="mt-4 rounded-md border-l-2 border-primary bg-primary-light p-3.5">
                        <p className="text-xs font-bold tracking-wide text-primary uppercase">
                          <span>{t("mrv.yourReply")}</span>
                        </p>
                        <p className="mt-1.5 text-sm text-text-secondary">{review.reply}</p>
                        {review.repliedAt && (
                          <p className="mt-2 text-xs text-text-light">
                            <span>
                              {review.repliedBy
                                ? t("mrv.repliedMetaBy", {
                                    name: review.repliedBy,
                                    date: dates.date(review.repliedAt),
                                  })
                                : t("mrv.repliedMeta", { date: dates.date(review.repliedAt) })}
                            </span>
                          </p>
                        )}
                      </div>
                    ) : null}

                    {/* Column below sm: no action on this screen may sit off
                        the right edge of a phone. */}
                    <div className="mt-4 flex flex-col gap-2 border-t border-border pt-3.5 sm:flex-row sm:items-center">
                      <Button
                        size="sm"
                        variant={review.reply ? "outline" : "primary"}
                        disabled={pending}
                        className="w-full sm:w-auto"
                        onClick={() => {
                          setReplyingId(review.id);
                          // Editing starts from what is published; a new reply
                          // starts blank.
                          setDraft(review.reply ?? "");
                        }}
                      >
                        <MessageSquare className="size-3.5" aria-hidden />
                        <span>
                          {review.reply ? t("mrv.action.editReply") : t("mrv.action.reply")}
                        </span>
                      </Button>

                      {!review.isReported && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          className="w-full text-error hover:bg-error-light sm:ml-auto sm:w-auto"
                          onClick={() => {
                            setReportingId(review.id);
                            setReason("");
                          }}
                        >
                          <Flag className="size-3.5" aria-hidden />
                          <span>{t("mrv.action.report")}</span>
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog
        open={replying !== null}
        onClose={() => setReplyingId(null)}
        title={t("mrv.reply.title")}
        description={replying ? t("mrv.reply.for", { name: nameOf(replying) }) : undefined}
        footer={
          <>
            <Button variant="outline" disabled={pending} onClick={() => setReplyingId(null)}>
              <span>{t("common.cancel")}</span>
            </Button>
            <Button
              loading={pending}
              disabled={pending || draft.trim().length < MIN_REPLY}
              onClick={submitReply}
            >
              <span>{t("mrv.reply.submit")}</span>
            </Button>
          </>
        }
      >
        {replying && (
          <div className="flex flex-col gap-4">
            {replying.body.trim() ? (
              <blockquote className="rounded-md bg-surface-2 p-3.5 text-sm leading-relaxed text-text-secondary italic">
                <span>{t("common.quoted", { text: replying.body })}</span>
              </blockquote>
            ) : null}

            <Field
              label={t("mrv.reply.label")}
              htmlFor="review-reply"
              required
              hint={t("mrv.reply.hint")}
            >
              <Textarea
                id="review-reply"
                rows={5}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={t("mrv.reply.placeholder")}
              />
            </Field>
          </div>
        )}
      </Dialog>

      {/* Reporting asks for a reason because the moderator reads it — and
          because a report that costs one tap is a way to bury a bad review. */}
      <Dialog
        open={reporting !== null}
        onClose={() => setReportingId(null)}
        title={t("mrv.report.title")}
        description={reporting ? t("mrv.report.for", { name: nameOf(reporting) }) : undefined}
        size="sm"
        footer={
          <>
            <Button variant="outline" disabled={pending} onClick={() => setReportingId(null)}>
              <span>{t("common.cancel")}</span>
            </Button>
            <Button
              variant="danger"
              loading={pending}
              disabled={pending || reason.trim().length < MIN_REASON}
              onClick={submitReport}
            >
              <span>{t("mrv.report.submit")}</span>
            </Button>
          </>
        }
      >
        {reporting && (
          <div className="flex flex-col gap-4">
            <p className="text-sm leading-relaxed text-text-secondary">
              <span>{t("mrv.report.intro")}</span>
            </p>

            <Field
              label={t("mrv.report.label")}
              htmlFor="review-report-reason"
              required
              hint={t("mrv.report.hint")}
            >
              <Textarea
                id="review-report-reason"
                rows={4}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("mrv.report.placeholder")}
              />
            </Field>
          </div>
        )}
      </Dialog>
    </>
  );
}
