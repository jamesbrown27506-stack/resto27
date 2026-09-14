"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { AlertTriangle, Check, FileText, Handshake, Sparkles, Wallet } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody, Panel } from "@/components/ui/card";
import { CellStack, DataTable, type Column } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { UsageMeter } from "@/components/ui/meter";
import { useToast } from "@/components/ui/toast";
import { formatMoney, formatPercent } from "@/lib/format/currency";
import { useDates } from "@/lib/format/use-dates";
import { choosePlan, startTrial } from "@/lib/data/subscribe-actions";
import { useLocale } from "@/lib/i18n/use-locale";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import type { BillingPlan, Invoice, TrialState } from "@/lib/data/invoices";
import type { SubscriptionState } from "@/lib/format/subscription";
import { cn } from "@/lib/utils";

/**
 * The tenant's subscription screen.
 *
 * PAYMENT DOES NOT HAPPEN HERE. Choosing a paid plan raises an invoice and
 * sends the tenant to /m/billing/pay/[id], which is the one surface that
 * explains what settling an invoice currently does. Two payment buttons on two
 * screens would eventually carry two different explanations, and one of them
 * would be the stale one.
 */

/** Badge tone per subscription state. The LABEL comes from `common.subState.*`. */
const STATE_TONE: Record<SubscriptionState, BadgeTone> = {
  active: "success",
  grace: "warning",
  locked: "error",
  free_mode: "info",
};

/**
 * Invoice status → dict key, keyed on the RAW column value.
 *
 * `overdue` is not a status in the database — it is `unpaid` past its period
 * end, decided against the server-stamped instant this page was rendered with.
 * Storing it would mean a row whose truth depends on when a cron last ran.
 */
const STATUS_KEY: Record<string, TranslationKey> = {
  unpaid: "mbl.status.unpaid",
  paid: "mbl.status.paid",
  void: "mbl.status.void",
};

const STATUS_TONE: Record<string, BadgeTone> = {
  unpaid: "warning",
  paid: "success",
  void: "neutral",
};

/** Plan blurb per tier, from the shared pricing strings. */
const PLAN_DESCRIPTION: Record<string, TranslationKey> = {
  starter: "plan.desc.starter",
  professional: "plan.desc.professional",
  enterprise: "plan.desc.enterprise",
};

function isOverdue(invoice: Invoice, now: string): boolean {
  return invoice.status === "unpaid" && new Date(invoice.periodEnd).getTime() < new Date(now).getTime();
}

export function BillingView({
  branch,
  plans,
  invoices,
  usage,
  trial,
  freeMode,
  freeModeEndsAt,
  now,
}: {
  branch: {
    planTier: string;
    planName: string;
    subscriptionState: SubscriptionState;
    expiresAt: string | null;
  };
  plans: BillingPlan[];
  invoices: Invoice[];
  usage: { menuItems: number; tables: number; promotions: number };
  trial: TrialState;
  /** Free mode (platform free for now): every plan applies instantly, no payment. */
  freeMode: boolean;
  /** When free mode ends — shown by the banner while it runs. */
  freeModeEndsAt?: string | null;
  /** Server-stamped ISO instant. Never read the clock during a render. */
  now: string;
}) {
  const { t } = useLocale();
  const dates = useDates();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [payFor, setPayFor] = useState<{
    invoiceId: string;
    amount: number;
    planName: string;
  } | null>(null);

  const current = plans.find((p) => p.tier === branch.planTier) ?? null;
  // While free mode runs every restaurant has the richest paid plan's features
  // (fetchPlanLimits), so that is the plan the card names — the same pick as
  // freeModePlanName on the dashboard.
  const granted = freeMode
    ? ([...plans].filter((p) => p.tier !== "starter").sort((a, b) => b.monthlyPrice - a.monthlyPrice)[0] ?? null)
    : null;
  const unpaid = invoices.filter((i) => i.status === "unpaid");

  /**
   * One ceiling from the plan row, as a sentence.
   *
   * `null` means unlimited and gets its OWN string rather than the word
   * "Illimité" pushed through {count} — the result of that is "Illimité plats
   * au menu", which is not French.
   */
  function ceiling(value: number | null, counted: TranslationKey, unlimited: TranslationKey): string {
    return value === null ? t(unlimited) : t(counted, { count: value.toLocaleString(dates.locale) });
  }

  function pick(plan: BillingPlan) {
    /**
     * Choosing the plan you are already on means something ONLY during a
     * trial: that is how a trial becomes a paid month, and it is what the
     * banner's "pay now" does. Outside a trial it would raise an invoice for
     * a month already granted, so it is refused here as well as by the
     * disabled button on the plan card.
     */
    if (plan.tier === branch.planTier && !trial.active) return;

    startTransition(async () => {
      const result = await choosePlan(plan.id);
      if (!result.ok) return toast(result.error, "error");

      // A free plan applies at once; a paid one hands back an invoice and
      // grants nothing until it is settled.
      if (result.invoiceId) {
        setPayFor({
          invoiceId: result.invoiceId,
          amount: result.amount ?? plan.monthlyPrice,
          planName: plan.name,
        });
        toast(t("mbl.toast.invoiceReady"), "info");
        return;
      }

      toast(t("mbl.toast.planChanged"), "success");
    });
  }

  function tryFree(plan: BillingPlan) {
    startTransition(async () => {
      const result = await startTrial(plan.id);
      if (!result.ok) return toast(result.error, "error");
      toast(t("mbl.trial.started"), "success");
    });
  }

  const invoiceColumns: Column<Invoice>[] = [
    {
      key: "number",
      header: t("mbl.inv.col.number"),
      cell: (invoice) => (
        <CellStack
          primary={<span className="tnum font-mono font-semibold">{invoice.number}</span>}
          secondary={<span>{dates.date(invoice.issuedAt)}</span>}
        />
      ),
    },
    {
      key: "period",
      header: t("mbl.inv.col.period"),
      cell: (invoice) => (
        <span className="tnum text-text-secondary">
          {t("mbl.inv.period", {
            from: dates.dateShort(invoice.periodStart),
            to: dates.dateShort(invoice.periodEnd),
          })}
        </span>
      ),
    },
    {
      key: "amount",
      header: t("mbl.inv.col.amount"),
      align: "right",
      cell: (invoice) => (
        <span className="tnum font-display font-bold">
          {formatMoney(invoice.amount, { currency: invoice.currency })}
        </span>
      ),
    },
    {
      key: "status",
      header: t("mbl.inv.col.status"),
      cell: (invoice) => {
        const overdue = isOverdue(invoice, now);
        return (
          <div className="flex flex-col items-end gap-1 md:items-start">
            <Badge tone={overdue ? "error" : (STATUS_TONE[invoice.status] ?? "neutral")}>
              <span>
                {t(overdue ? "mbl.status.overdue" : (STATUS_KEY[invoice.status] ?? "mbl.status.unpaid"))}
              </span>
            </Badge>
            {invoice.paidAt && (
              <span className="text-xs text-text-light">
                {t("mbl.inv.paidOn", { date: dates.dateShort(invoice.paidAt) })}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: "actions",
      header: t("common.actions"),
      align: "right",
      // The buttons name themselves; a "ACTIONS" label above them on a phone
      // card is a wasted line.
      hideLabelOnCard: true,
      cell: (invoice) => (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Link
            href={`/m/billing/invoices/${invoice.id}`}
            className={buttonClasses({ variant: "ghost", size: "sm" })}
          >
            <span>{t("mbl.inv.view")}</span>
          </Link>
          {invoice.status === "unpaid" && (
            <Link
              href={`/m/billing/pay/${invoice.id}`}
              className={buttonClasses({ variant: "outline", size: "sm" })}
            >
              <span>{t("mbl.inv.pay")}</span>
            </Link>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/*
        ── Free mode ────────────────────────────────────────────────────
        The platform is free for everyone right now: every plan card below
        applies instantly and nothing on this screen costs anything. The
        payment path is hidden because the server would not raise an invoice
        for a plan switched during free mode.
      */}
      {freeMode && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-info/30 bg-info-light p-4 text-info"
        >
          <Sparkles className="size-4 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-semibold">{t("mbl.freeMode.title")}.</span>{" "}
            <span className="opacity-85">
              {t(
                freeModeEndsAt ? "mbl.freeMode.bodyDate" : "mbl.freeMode.body",
                freeModeEndsAt ? { date: dates.date(freeModeEndsAt) } : undefined,
              )}
            </span>
          </p>
        </div>
      )}

      {/* ── Current state ──────────────────────────────────────────────── */}
      <Card>
        <CardBody className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-bold tracking-wide text-text-light uppercase">
              <span>{t("mbl.current.label")}</span>
            </p>
            <p className="mt-1 font-display text-2xl font-bold">
              <span>{granted ? granted.name : branch.planName}</span>
            </p>
            {granted ? (
              <p className="mt-1 max-w-prose text-sm text-text-secondary">
                <span>{t("mbl.current.freeGranted", { plan: branch.planName })}</span>
              </p>
            ) : (
              <p className="mt-1 text-sm text-text-secondary">
                <span>
                  {current
                    ? current.monthlyPrice === 0
                      ? t("mbl.current.free")
                      : t("mbl.current.price", { amount: formatMoney(current.monthlyPrice) })
                    : t("mbl.current.unknown")}
                </span>
                {current && (
                  <span>
                    {" · "}
                    {t("mbl.current.commission", { rate: formatPercent(current.commissionRate) })}
                  </span>
                )}
              </p>
            )}
          </div>

          <div className="flex flex-col items-start gap-2 sm:items-end">
            <Badge tone={STATE_TONE[branch.subscriptionState]}>
              <span>
                {t(`common.subState.${branch.subscriptionState}` as TranslationKey)}
              </span>
            </Badge>
            <p className="text-sm text-text-secondary">
              <span>
                {branch.expiresAt
                  ? t("mbl.current.due", { date: dates.date(branch.expiresAt) })
                  : t("mbl.current.noExpiry")}
              </span>
            </p>
          </div>
        </CardBody>
      </Card>

      {/*
        ── Trial ────────────────────────────────────────────────────────
        Shown with the days remaining, always. A trial whose end date is
        invisible is one that ends as an unpleasant surprise — and the thing
        that ends it is a plain lapse into Starter limits, not a charge, so
        there is nothing to hide.
      */}
      {/* A trial is meaningless while everything is free — the countdown and
          the "pay now" would only contradict the free-mode banner above. */}
      {trial.active && trial.endsAt && !freeMode && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-info/30 bg-info-light p-4 text-info"
        >
          <Sparkles className="size-4 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-semibold">
              {t("mbl.trial.left", { days: trial.daysLeft ?? 0 })}
            </span>{" "}
            <span className="opacity-85">
              {t("mbl.trial.body", { date: dates.date(trial.endsAt) })}
            </span>
          </p>
          {current && current.monthlyPrice > 0 && (
            <Button size="sm" disabled={pending} onClick={() => pick(current)}>
              <span>{t("mbl.trial.payNow")}</span>
            </Button>
          )}
        </div>
      )}

      {/* ── Unpaid invoices ────────────────────────────────────────────── */}
      {unpaid.length > 0 && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/30 bg-warning-light p-4 text-warning"
        >
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1 text-sm font-semibold">
            <span>
              {t("mbl.unpaid.summary", {
                count: unpaid.length,
                amount: formatMoney(unpaid.reduce((sum, i) => sum + i.amount, 0)),
              })}
            </span>
          </p>
          <Link
            href={`/m/billing/pay/${unpaid[0]!.id}`}
            className={buttonClasses({ size: "sm" })}
          >
            <Wallet className="size-3.5" aria-hidden />
            <span>{t("mbl.unpaid.pay")}</span>
          </Link>
        </div>
      )}

      {/* ── Usage ──────────────────────────────────────────────────────── */}
      {current && (
        <Panel title={t("mbl.usage.title")} description={t("mbl.usage.subtitle")}>
          <CardBody className="flex flex-col gap-4">
            <UsageMeter
              label={t("mbl.usage.menuItems")}
              used={usage.menuItems}
              limit={current.menuItemLimit}
            />
            <UsageMeter label={t("mbl.usage.tables")} used={usage.tables} limit={current.tableLimit} />
            <UsageMeter
              label={t("mbl.usage.promotions")}
              used={usage.promotions}
              limit={current.promotionLimit}
            />
          </CardBody>
        </Panel>
      )}

      {/* ── Plans ──────────────────────────────────────────────────────── */}
      <div>
        <h2 className="font-display text-xl font-bold">
          <span>{t("mbl.plans.title")}</span>
        </h2>
        <p className="mt-1 mb-4 text-sm text-text-secondary">
          <span>{t("mbl.plans.subtitle")}</span>
        </p>

        {plans.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface">
            <EmptyState title={t("mbl.plans.none")} description={t("mbl.plans.noneBody")} />
          </div>
        ) : (
          // One column on a phone. A price grid that scrolls sideways hides
          // the very button it exists to offer.
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map((plan) => {
              const isCurrent = plan.tier === branch.planTier;
              const descriptionKey = PLAN_DESCRIPTION[plan.tier];
              // One trial per restaurant, ever — a plan whose trial has been
              // spent must not offer another. The server refuses it anyway
              // (subscriptions.trial_used); this only stops the offer being
              // made twice. Hidden entirely while free mode is on — there is
              // nothing to trial.
              const offersTrial =
                plan.trialDays !== null && plan.monthlyPrice > 0 && !trial.used && !freeMode;

              const features: { key: string; label: string }[] = [
                {
                  key: "menuItems",
                  label: ceiling(
                    plan.menuItemLimit,
                    "mbl.feat.menuItems",
                    "mbl.feat.menuItemsUnlimited",
                  ),
                },
                {
                  key: "tables",
                  label: ceiling(plan.tableLimit, "mbl.feat.tables", "mbl.feat.tablesUnlimited"),
                },
                {
                  key: "promotions",
                  label: ceiling(
                    plan.promotionLimit,
                    "mbl.feat.promotions",
                    "mbl.feat.promotionsUnlimited",
                  ),
                },
                {
                  key: "commission",
                  label: t("mbl.feat.commission", { rate: formatPercent(plan.commissionRate) }),
                },
                ...(plan.staffManagement ? [{ key: "staff", label: t("mbl.feat.staff") }] : []),
                ...(plan.analytics ? [{ key: "analytics", label: t("mbl.feat.analytics") }] : []),
              ];

              return (
                <div
                  key={plan.id}
                  className={cn(
                    "flex flex-col rounded-lg border bg-surface p-5",
                    isCurrent ? "border-primary ring-1 ring-primary" : "border-border",
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-display text-lg font-bold">
                      <span>{plan.name}</span>
                    </p>
                    {isCurrent ? (
                      <Badge tone="primary">
                        <span>{t("mbl.plan.badgeCurrent")}</span>
                      </Badge>
                    ) : (
                      plan.isFeatured && (
                        <Badge tone="accent">
                          <span>{t("plan.mostChosen")}</span>
                        </Badge>
                      )
                    )}
                  </div>

                  {descriptionKey && (
                    <p className="mt-1 text-sm text-text-secondary">
                      <span>{t(descriptionKey)}</span>
                    </p>
                  )}

                  {/* The price is the plan row's, never a constant — an admin
                      changing it in /a/plans changes it here with no deploy. */}
                  <p className="tnum mt-3 font-display text-3xl font-bold text-primary">
                    <span>
                      {plan.monthlyPrice === 0 ? t("mbl.plan.free") : formatMoney(plan.monthlyPrice)}
                    </span>
                  </p>
                  {plan.monthlyPrice > 0 && (
                    <p className="text-sm text-text-light">
                      <span>{t("plan.perMonth")}</span>
                    </p>
                  )}

                  {offersTrial && (
                    <p className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-full bg-success-light px-2.5 py-1 text-xs font-bold text-success">
                      <Sparkles className="size-3" aria-hidden />
                      <span>{t("mbl.trial.badge", { days: plan.trialDays ?? 0 })}</span>
                    </p>
                  )}

                  <ul className="mt-4 flex flex-1 flex-col gap-2 text-sm">
                    {features.map((feature) => (
                      <li key={feature.key} className="flex items-start gap-2">
                        <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
                        <span className="text-text-secondary">{feature.label}</span>
                      </li>
                    ))}
                  </ul>

                  {/*
                    The trial is the primary action when it is available, and
                    paying outright is offered underneath. Someone who has not
                    used the product yet should not have to decide to spend
                    money to see it.
                  */}
                  <div className="mt-5 flex flex-col gap-2">
                    {!isCurrent && offersTrial ? (
                      <>
                        <Button fullWidth disabled={pending} onClick={() => tryFree(plan)}>
                          <Sparkles className="size-4" aria-hidden />
                          <span>{t("mbl.trial.start", { days: plan.trialDays ?? 0 })}</span>
                        </Button>
                        <Button
                          fullWidth
                          variant="outline"
                          size="sm"
                          disabled={pending}
                          onClick={() => pick(plan)}
                        >
                          <span>{t("mbl.plan.payDirect")}</span>
                        </Button>
                      </>
                    ) : isCurrent && trial.active && plan.monthlyPrice > 0 && !freeMode ? (
                      // Mid-trial, on the trialed plan: the useful action is
                      // settling it, not being told which plan you are on.
                      <Button fullWidth disabled={pending} onClick={() => pick(plan)}>
                        <span>{t("mbl.trial.payNow")}</span>
                      </Button>
                    ) : (
                      <>
                        <Button
                          fullWidth
                          variant={isCurrent ? "outline" : "primary"}
                          disabled={isCurrent || pending}
                          onClick={() => pick(plan)}
                        >
                          <span>
                            {isCurrent
                              ? t("mbl.plan.isCurrent")
                              : freeMode
                                ? t("mbl.plan.choose")
                                : plan.monthlyPrice === 0
                                  ? t("mbl.plan.chooseFree")
                                  : t("mbl.plan.choose")}
                          </span>
                        </Button>
                        {!isCurrent &&
                          plan.monthlyPrice > 0 &&
                          plan.trialDays !== null &&
                          trial.used && (
                            <p className="text-center text-xs text-text-light">
                              <span>{t("mbl.trial.used")}</span>
                            </p>
                          )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Invoices ───────────────────────────────────────────────────── */}
      <Panel title={t("mbl.inv.title")}>
        <DataTable
          columns={invoiceColumns}
          rows={invoices}
          rowKey={(invoice) => invoice.id}
          className="p-3 md:p-0"
          empty={
            <EmptyState
              icon={<FileText />}
              title={t("mbl.inv.none")}
              description={t("mbl.inv.noneBody")}
            />
          }
        />
      </Panel>

      {/* ── After choosing a paid plan ─────────────────────────────────── */}
      <Dialog
        open={payFor !== null}
        onClose={() => setPayFor(null)}
        title={t("mbl.pay.title", { plan: payFor?.planName ?? "" })}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setPayFor(null)} disabled={pending}>
              <span>{t("mbl.pay.later")}</span>
            </Button>
            {payFor && (
              <Link href={`/m/billing/pay/${payFor.invoiceId}`} className={buttonClasses()}>
                <Wallet className="size-4" aria-hidden />
                <span>{t("mbl.pay.open")}</span>
              </Link>
            )}
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-text-secondary">
            <span>
              {t("mbl.pay.body", { amount: formatMoney(payFor?.amount ?? 0) })}
            </span>
          </p>

          {/*
            The payment is handled by the platform — no gateway, and no
            simulator dressed up as a checkout. The pay page says the same
            thing; the dialog just says it one step earlier.
          */}
          <p className="flex items-start gap-2 rounded-md border border-primary/20 bg-primary-light p-3 text-xs leading-relaxed text-primary">
            <Handshake className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              <span className="font-bold">{t("mbl.handled.title")}</span>
              {" — "}
              <span>{t("mbl.handled.body")}</span>
            </span>
          </p>
        </div>
      </Dialog>
    </div>
  );
}
