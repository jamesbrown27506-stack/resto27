"use client";

import { useTransition } from "react";
import { CheckCheck } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { markAllReviewsSeen } from "@/lib/data/review-actions";
import { useLocale } from "@/lib/i18n/use-locale";

/**
 * "Tout marquer comme lu", right on the dashboard's attention card: the
 * restaurant should not have to open the reviews page just to make the
 * reminder go away (0066). The action revalidates /m, so the card updates.
 */
export function MarkReviewsRead() {
  const { t } = useLocale();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  return (
    <li className="min-w-0">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await markAllReviewsSeen();
            if (!result.ok) toast(result.error, "error");
          })
        }
        className="inline-flex min-h-11 items-center gap-2 rounded-md border border-warning/40 bg-surface px-3 text-sm font-medium text-warning hover:bg-warning-light disabled:opacity-60"
      >
        <CheckCheck className="size-4" aria-hidden />
        {t("mrv.markAllRead")}
      </button>
    </li>
  );
}
