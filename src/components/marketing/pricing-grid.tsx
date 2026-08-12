"use client";

import Link from "next/link";
import { Check, Minus, Sparkles } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { formatMoney, formatPercent } from "@/lib/format/currency";
import { formatLimit } from "@/lib/format/subscription";
import { useLocale } from "@/lib/i18n/use-locale";
import type { PublicPlan } from "@/lib/data/plans";
import { cn } from "@/lib/utils";

/**
 * Plan cards.
 *
 * RENDERED FROM THE PLAN ROWS, never hardcoded (§14.1). The advertised limits
 * and the enforced limits must be the same numbers — the PHP app kept the
 * limits in code and the marketing copy in a template, which is how a page can
 * promise 100 dishes while the app refuses the 21st.
 */
export function PricingGrid({
  plans,
  compact = false,
}: {
  plans: PublicPlan[];
  compact?: boolean;
}) {
  const { t } = useLocale();

  return (
    <div className="grid items-start gap-6 lg:grid-cols-3">
      {plans.map((plan) => {
        const featured = plan.isFeatured;

        const features: { label: string; included: boolean }[] = [
          { label: `${formatLimit(plan.menuItemLimit)} ${t("plan.menuItems")}`, included: true },
          { label: `${formatLimit(plan.tableLimit)} ${t("plan.tables")}`, included: true },
          { label: `${formatLimit(plan.promotionLimit)} ${t("plan.promotions")}`, included: true },
          { label: t("plan.staff"), included: plan.staffManagement },
          { label: t("plan.analytics"), included: plan.analytics },
          {
            label: `${t("plan.commission")} ${formatPercent(plan.commissionRate)}`,
            included: true,
          },
          { label: t("plan.kitchen"), included: true },
          { label: t("plan.mobileMoney"), included: true },
        ];

        return (
          <div
            key={plan.id}
            className={cn(
              "relative rounded-lg border p-8 transition-shadow",
              featured
                ? "border-transparent bg-primary text-primary-fg shadow-lg lg:-translate-y-2"
                : "border-border bg-surface hover:shadow-md",
            )}
          >
            {featured && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-accent px-4 py-1 text-[11px] font-bold tracking-wider text-accent-fg uppercase whitespace-nowrap">
                {t("plan.mostChosen")}
              </span>
            )}

            <p
              className={cn(
                "text-[11px] font-bold tracking-[0.1em] uppercase",
                featured ? "opacity-70" : "text-text-secondary",
              )}
            >
              {plan.name}
            </p>

            <p className="tnum mt-2.5 font-display text-4xl leading-none font-bold">
              {formatMoney(plan.monthlyPrice, { showSymbol: false })}
              <span className="ml-1.5 text-base font-normal opacity-60">FCFA</span>
            </p>
            <p className={cn("mt-1 text-sm", featured ? "opacity-65" : "text-text-secondary")}>
              {plan.monthlyPrice === 0 ? t("plan.freeForever") : t("plan.perMonth")}
            </p>

            {/* The trial is the reason someone clicks a paid plan they have
                not tried. It belongs next to the price, not in the small
                print underneath the feature list. */}
            {plan.trialDays !== null && plan.monthlyPrice > 0 && (
              <p
                className={cn(
                  "mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold",
                  featured ? "bg-accent text-accent-fg" : "bg-success-light text-success",
                )}
              >
                <Sparkles className="size-3" aria-hidden />
                {t("plan.trial", { days: plan.trialDays })}
              </p>
            )}

            <p
              className={cn(
                "mt-5 border-b pb-5 text-sm leading-relaxed",
                featured ? "border-primary-fg/15 opacity-70" : "border-border text-text-secondary",
              )}
            >
              {t(`plan.desc.${plan.tier}` as never)}
            </p>

            <ul className="mt-5 flex flex-col">
              {(compact ? features.slice(0, 6) : features).map((f) => (
                <li
                  key={f.label}
                  className={cn(
                    "flex items-center gap-2.5 border-b py-2.5 text-sm last:border-b-0",
                    featured ? "border-primary-fg/10" : "border-border",
                    !f.included && "opacity-45",
                  )}
                >
                  {f.included ? (
                    <Check
                      className={cn("size-3.5 shrink-0", featured ? "text-accent" : "text-primary")}
                      aria-hidden
                    />
                  ) : (
                    <Minus className="size-3.5 shrink-0" aria-hidden />
                  )}
                  {f.label}
                </li>
              ))}
            </ul>

            <Link
              href="/register/restaurant"
              className={cn(
                buttonClasses({ fullWidth: true }),
                "mt-7",
                featured && "bg-primary-fg text-primary hover:bg-primary-fg/90",
              )}
            >
              {t("plan.start")}
            </Link>
          </div>
        );
      })}
    </div>
  );
}
