"use client";

import Link from "next/link";
import { useState } from "react";
import { Pencil, Star, Trash2 } from "lucide-react";
import { AccountShell } from "@/components/layout/account-shell";
import { Button, buttonClasses } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Textarea } from "@/components/ui/input";
import { RatingInput, RatingStars } from "@/components/ui/rating-stars";
import { useToast } from "@/components/ui/toast";
import { updateOwnReview, deleteOwnReview } from "@/lib/data/customer-actions";
import type { OwnReview } from "@/lib/data/customer";
import { formatDate, isoAttr } from "@/lib/format/datetime";
import { intlLocale, useLocale } from "@/lib/i18n/use-locale";
import type { SessionUser } from "@/lib/session";

export function ReviewsClient({
  user,
  initial,
}: {
  user: SessionUser;
  initial: OwnReview[];
}) {
  const { toast } = useToast();
  const { locale, t } = useLocale();

  const [reviews, setReviews] = useState(initial);
  const [editing, setEditing] = useState<OwnReview | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  function openEdit(review: OwnReview) {
    setEditing(review);
    setRating(review.rating);
    setBody(review.body);
  }

  async function saveEdit() {
    if (!editing) return;
    setBusy(true);
    const result = await updateOwnReview(editing.id, rating, body);
    setBusy(false);
    if (result.ok) {
      setReviews((c) =>
        c.map((r) => (r.id === editing.id ? { ...r, rating, body: body.trim() } : r)),
      );
      setEditing(null);
      toast(t("crv.updated"), "success");
    } else {
      toast(result.error, "error");
    }
  }

  async function confirmDelete() {
    if (!deleteId) return;
    setBusy(true);
    const result = await deleteOwnReview(deleteId);
    setBusy(false);
    if (result.ok) {
      setReviews((c) => c.filter((r) => r.id !== deleteId));
      toast(t("crv.deleted"), "info");
    } else {
      toast(result.error, "error");
    }
    setDeleteId(null);
  }

  return (
    <AccountShell
      user={user}
      title={t("crv.title")}
      description={t("crv.subtitle")}
    >
      {reviews.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState
            icon={<Star />}
            title={t("crv.empty")}
            description={t("crv.emptyBody")}
            action={
              <Link href="/orders" className={buttonClasses()}>
                {t("crv.seeOrders")}
              </Link>
            }
          />
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {reviews.map((review) => (
            <li key={review.id} className="rounded-lg border border-border bg-surface p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    href={`/restaurants/${review.restaurantSlug}`}
                    className="font-semibold hover:text-primary"
                  >
                    {review.restaurantName}
                  </Link>
                  <div className="mt-1 flex items-center gap-3">
                    <RatingStars value={review.rating} size="sm" />
                    <time
                      dateTime={isoAttr(review.createdAt)}
                      className="text-xs text-text-light"
                    >
                      {formatDate(review.createdAt, intlLocale(locale))}
                    </time>
                  </div>
                </div>

                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(review)}>
                    <Pencil className="size-3.5" aria-hidden />
                    {t("crv.edit")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-error hover:bg-error-light"
                    onClick={() => setDeleteId(review.id)}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </Button>
                </div>
              </div>

              <p className="mt-3 leading-relaxed text-text-secondary">{review.body}</p>

              {review.reply && (
                <div className="mt-4 rounded-md border-l-2 border-primary bg-primary-light p-3.5">
                  <p className="text-xs font-bold tracking-wide text-primary uppercase">
                    {t("crv.replyFrom", { name: review.restaurantName })}
                  </p>
                  <p className="mt-1.5 text-sm text-text-secondary">{review.reply}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={t("crv.editTitle")}
        description={editing?.restaurantName}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              {t("common.cancel")}
            </Button>
            <Button disabled={body.trim().length < 10 || busy} onClick={saveEdit}>
              {t("common.save")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div>
            <p className="mb-2 text-sm font-semibold">{t("crv.rating")}</p>
            <RatingInput name="edit-rating" value={rating} onChange={setRating} />
          </div>
          <div>
            <label htmlFor="edit-body" className="mb-2 block text-sm font-semibold">
              {t("crv.body")}
            </label>
            <Textarea
              id="edit-body"
              rows={5}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={confirmDelete}
        title={t("crv.deleteTitle")}
        message={t("crv.deleteBody")}
        confirmLabel={t("crv.delete")}
        destructive
      />
    </AccountShell>
  );
}