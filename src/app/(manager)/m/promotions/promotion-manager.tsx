"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Lock, Plus, Tag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select, Switch } from "@/components/ui/input";
import { Sheet, SheetActions } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { formatMoney } from "@/lib/format/currency";
import { useDates } from "@/lib/format/use-dates";
import { createPromotion, setPromotionActive } from "@/lib/data/manager-actions";
import { useLocale } from "@/lib/i18n/use-locale";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import type { Promotion } from "@/lib/data/manager";

/** The two values the `discount_type` column accepts. */
const DISCOUNT_TYPES = ["percent", "fixed"] as const;

/** Mirrors the regex createPromotion() enforces: /^[A-Z0-9]{3,24}$/. */
const CODE_MIN = 3;
const CODE_MAX = 24;

/**
 * Africa/Douala is UTC+1 the whole year — no DST — and it is the zone every
 * date in this app is rendered in (DISPLAY_TZ). Spelling the offset out means
 * "through the end of that day HERE"; a bare `T23:59:59` would be read in
 * whatever zone the database session happens to sit in, so the same code would
 * expire at a different moment depending on server configuration.
 */
const END_OF_DAY = "T23:59:59+01:00";

interface Draft {
  code: string;
  label: string;
  discountType: Promotion["discountType"];
  discountValue: number;
  minOrder: number;
  maxDiscount: string;
  endsAt: string;
  usageLimit: string;
}

const EMPTY: Draft = {
  code: "",
  label: "",
  discountType: "percent",
  discountValue: 10,
  minOrder: 0,
  maxDiscount: "",
  endsAt: "",
  usageLimit: "",
};

/**
 * The same checks createPromotion() runs, so the button is never enabled for
 * an input the server will bounce back as an untranslated English sentence.
 */
function isValid(draft: Draft): boolean {
  if (draft.code.length < CODE_MIN) return false;
  if (draft.discountValue < 1) return false;
  return draft.discountType !== "percent" || draft.discountValue <= 100;
}

/** Blank, "0" and "-3" all mean "no ceiling" for the optional numeric fields. */
function positiveOrNull(value: string): number | null {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function PromotionManager({
  promotions,
  limit,
  now,
}: {
  promotions: Promotion[];
  /** null = unlimited */
  limit: number | null;
  /** Server-stamped ISO instant — see page.tsx. */
  now: string;
}) {
  const { t } = useLocale();
  const dates = useDates();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);

  const nowMs = new Date(now).getTime();

  const activeCount = promotions.filter((p) => p.isActive).length;
  const atLimit = limit !== null && activeCount >= limit;

  function run(
    fn: () => Promise<{ ok: boolean; error?: string; note?: string }>,
    success: string,
    options: {
      // The server's `note` is an English sentence. It is a single, known
      // caveat per action, so the caller hands over the translated version
      // rather than letting an English string land in a French toast.
      note?: string;
      onSuccess?: () => void;
    } = {},
  ) {
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) return toast(result.error ?? t("common.error"), "error");
      options.onSuccess?.();
      if (result.note) return toast(options.note ?? success, "warning");
      toast(success, "success");
    });
  }

  /** "Pourcentage · −20 % · dès 5 000 FCFA · sans plafond" */
  function describe(promotion: Promotion): string {
    const parts = [t(`mpr.type.${promotion.discountType}` as TranslationKey)];

    parts.push(
      promotion.discountType === "percent"
        ? t("mpr.percentOff", { value: promotion.discountValue })
        : t("mpr.amountOff", { amount: formatMoney(promotion.discountValue) }),
    );

    if (promotion.minOrder > 0) {
      parts.push(t("mpr.minOrder", { amount: formatMoney(promotion.minOrder) }));
    }

    // An uncapped percentage is the one setting that can quietly give away a
    // large order, so it is stated on the row and not only warned about once
    // at creation time.
    if (promotion.discountType === "percent") {
      parts.push(
        promotion.maxDiscount === null
          ? t("mpr.uncapped")
          : t("mpr.cappedAt", { amount: formatMoney(promotion.maxDiscount) }),
      );
    }

    return parts.join(" · ");
  }

  return (
    <>
      <div className="mb-5 flex justify-end">
        <Button
          fullWidth
          className="sm:w-auto"
          disabled={atLimit}
          title={atLimit ? t("mpr.planLimit") : undefined}
          onClick={() => setDraft({ ...EMPTY })}
        >
          <Plus className="size-4" aria-hidden />
          <span>{t("mpr.new")}</span>
        </Button>
      </div>

      {/* At the ceiling, existing codes keep working and only creation is
          refused (§5). Killing a running campaign because a renewal is late
          punishes the customers holding the code, not the restaurant. */}
      {atLimit && (
        <div
          role="status"
          className="mb-5 flex flex-col gap-3 rounded-md border border-warning/30 bg-warning-light p-4 text-warning sm:flex-row sm:items-center"
        >
          <Lock className="size-4 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-semibold">
              {t("mpr.limitReached", { used: activeCount, limit: limit ?? 0 })}
            </span>{" "}
            <span className="opacity-85">{t("mpr.limitBody")}</span>
          </p>
          <Link
            href="/m/billing"
            className={buttonClasses({ size: "sm", fullWidth: true, className: "sm:w-auto" })}
          >
            <span>{t("mpr.changePlan")}</span>
          </Link>
        </div>
      )}

      {promotions.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState icon={<Tag />} title={t("mpr.empty")} description={t("mpr.emptyBody")} />
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {promotions.map((promotion) => {
            // Every state word comes from the stored columns, so the badge and
            // the database can never disagree.
            const scheduled = new Date(promotion.startsAt).getTime() > nowMs;
            const expired =
              promotion.endsAt !== null && new Date(promotion.endsAt).getTime() <= nowMs;
            const usedUp =
              promotion.usageLimit !== null && promotion.usedCount >= promotion.usageLimit;
            const live = promotion.isActive && !scheduled && !expired && !usedUp;

            const meta: string[] = [
              promotion.usageLimit === null
                ? t("mpr.usedTimes", { count: promotion.usedCount })
                : t("mpr.usedOfLimit", {
                    count: promotion.usedCount,
                    limit: promotion.usageLimit,
                  }),
            ];
            if (scheduled) {
              meta.push(t("mpr.startsOn", { date: dates.date(promotion.startsAt) }));
            }
            if (promotion.endsAt) {
              meta.push(t("mpr.until", { date: dates.date(promotion.endsAt) }));
            }

            return (
              <li
                key={promotion.id}
                className="rounded-lg border border-border bg-surface p-4 sm:p-5"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* break-all: a 24-character code on a 320 px phone must
                        wrap rather than push the card sideways. */}
                    <code className="min-w-0 rounded bg-surface-2 px-2 py-0.5 font-mono text-sm font-bold break-all">
                      {promotion.code}
                    </code>
                    {/* "Expired" and "used up" are shown SEPARATELY from the
                        on/off switch below: "you switched it off" and "it ran
                        out" are different pieces of news, and only one is a
                        decision the restaurant made. */}
                    {live && <Badge tone="success">{t("mpr.status.active")}</Badge>}
                    {scheduled && <Badge tone="info">{t("mpr.status.scheduled")}</Badge>}
                    {expired && <Badge tone="neutral">{t("mpr.status.expired")}</Badge>}
                    {usedUp && <Badge tone="neutral">{t("mpr.status.usedUp")}</Badge>}
                  </div>

                  {/* Ternary rather than `label && …`: an empty label would
                      otherwise render as a bare empty text node next to the
                      conditional block, which is the shape §3 warns about. */}
                  {promotion.label ? (
                    <p className="mt-1 text-sm text-text-secondary">{promotion.label}</p>
                  ) : null}

                  <p className="tnum mt-1 text-sm text-text-secondary">
                    <span>{describe(promotion)}</span>
                  </p>

                  <p className="tnum mt-0.5 text-xs text-text-light">
                    <span>{meta.join(" · ")}</span>
                  </p>
                </div>

                {/* The switch lives in its own full-width row rather than
                    beside the text, so reaching it never depends on how long
                    the code or the description is — no horizontal scroll to
                    turn a campaign off (§8). */}
                <div className="mt-4 flex items-center border-t border-border pt-3.5">
                  <Switch
                    className="w-full"
                    label={t(promotion.isActive ? "mpr.on" : "mpr.off")}
                    aria-label={t("mpr.toggleAria", { code: promotion.code })}
                    checked={promotion.isActive}
                    disabled={pending}
                    onChange={() =>
                      run(
                        () => setPromotionActive(promotion.id, !promotion.isActive),
                        promotion.isActive ? t("mpr.disabled") : t("mpr.enabled"),
                      )
                    }
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Sheet
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={t("mpr.new")}
        // Pinned, so a nine-field promotion form never hides the button that
        // creates it below the fold.
        footer={
          draft && (
            <SheetActions>
              <Button variant="outline" disabled={pending} onClick={() => setDraft(null)}>
                <span>{t("common.cancel")}</span>
              </Button>
              <Button
                loading={pending}
                disabled={!isValid(draft)}
                onClick={() =>
                  run(
                    () =>
                      createPromotion({
                        code: draft.code,
                        label: draft.label,
                        discountType: draft.discountType,
                        discountValue: draft.discountValue,
                        minOrder: draft.minOrder,
                        maxDiscount: positiveOrNull(draft.maxDiscount),
                        // A date input gives a bare day; the code should live
                        // through that whole day, not expire at midnight
                        // opening it.
                        endsAt: draft.endsAt ? `${draft.endsAt}${END_OF_DAY}` : null,
                        usageLimit: positiveOrNull(draft.usageLimit),
                      }),
                    t("mpr.created"),
                    {
                      note: t("mpr.createdUncapped"),
                      // The panel closes on success only. A duplicate code is
                      // the common rejection here, and throwing away everything
                      // the manager just typed to show them a toast about it
                      // makes them type it all again.
                      onSuccess: () => setDraft(null),
                    },
                  )
                }
              >
                <span>{t("common.create")}</span>
              </Button>
            </SheetActions>
          )
        }
      >
        {draft && (
          <div className="flex flex-col gap-4">
            <Field label={t("mpr.code")} htmlFor="promo-code" required hint={t("mpr.codeHint")}>
              <Input
                id="promo-code"
                value={draft.code}
                maxLength={CODE_MAX}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    // Filtered as typed: a space or an accent would otherwise
                    // reach the server and come back as an English rejection.
                    code: e.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9]/g, "")
                      .slice(0, CODE_MAX),
                  })
                }
                placeholder={t("mpr.codePh")}
                className="font-mono"
              />
            </Field>

            <Field label={t("mpr.label")} htmlFor="promo-label" hint={t("mpr.labelHint")}>
              <Input
                id="promo-label"
                value={draft.label}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                placeholder={t("mpr.labelPh")}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("mpr.discountType")} htmlFor="promo-type">
                <Select
                  id="promo-type"
                  value={draft.discountType}
                  onChange={(e) => {
                    const discountType = e.target.value as Promotion["discountType"];
                    setDraft({
                      ...draft,
                      discountType,
                      // 5 000 is a fine fixed amount and an impossible
                      // percentage, so the value follows the type instead of
                      // waiting to be refused on submit.
                      discountValue:
                        discountType === "percent"
                          ? Math.min(draft.discountValue, 100)
                          : draft.discountValue,
                      // A cap only means anything on a percentage.
                      maxDiscount: discountType === "percent" ? draft.maxDiscount : "",
                    });
                  }}
                >
                  {DISCOUNT_TYPES.map((value) => (
                    <option key={value} value={value}>
                      {t(`mpr.type.${value}` as TranslationKey)}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                label={t(draft.discountType === "percent" ? "mpr.valuePercent" : "mpr.valueAmount")}
                htmlFor="promo-value"
                required
              >
                <Input
                  id="promo-value"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={draft.discountType === "percent" ? 100 : undefined}
                  step={1}
                  value={String(draft.discountValue)}
                  onChange={(e) =>
                    setDraft({ ...draft, discountValue: Math.trunc(Number(e.target.value) || 0) })
                  }
                />
              </Field>
            </div>

            <Field label={t("mpr.minOrderField")} htmlFor="promo-min">
              <Input
                id="promo-min"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={String(draft.minOrder)}
                onChange={(e) =>
                  setDraft({ ...draft, minOrder: Math.trunc(Number(e.target.value) || 0) })
                }
              />
            </Field>

            {draft.discountType === "percent" && (
              <Field
                label={t("mpr.maxDiscountField")}
                htmlFor="promo-max"
                // The single most expensive thing to forget on a percentage
                // code: 20 % off an unusually large order is a gift nobody
                // approved.
                hint={t("mpr.maxDiscountHint")}
              >
                <Input
                  id="promo-max"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={draft.maxDiscount}
                  onChange={(e) => setDraft({ ...draft, maxDiscount: e.target.value })}
                  placeholder={t("mpr.maxDiscountPh")}
                />
              </Field>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("mpr.endsAtField")} htmlFor="promo-end" hint={t("mpr.endsAtHint")}>
                <Input
                  id="promo-end"
                  type="date"
                  value={draft.endsAt}
                  onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })}
                />
              </Field>

              <Field
                label={t("mpr.usageLimitField")}
                htmlFor="promo-uses"
                hint={t("mpr.usageLimitHint")}
              >
                <Input
                  id="promo-uses"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={draft.usageLimit}
                  onChange={(e) => setDraft({ ...draft, usageLimit: e.target.value })}
                />
              </Field>
            </div>

          </div>
        )}
      </Sheet>
    </>
  );
}
