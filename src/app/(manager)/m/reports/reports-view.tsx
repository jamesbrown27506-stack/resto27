"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Banknote, ChartColumn, Lock, ReceiptText, TrendingUp } from "lucide-react";
import { MixPieChart, SalesLineChart, VolumeBarChart } from "@/components/charts/charts";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, Panel } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatTile } from "@/components/ui/stat-tile";
import { formatMoney, formatMoneyCompact } from "@/lib/format/currency";
import { DISPLAY_TZ } from "@/lib/format/datetime";
import { useDates } from "@/lib/format/use-dates";
import { useLocale } from "@/lib/i18n/use-locale";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import type { ReportBucket, ReportData, ReportRange } from "@/lib/data/reports";
import { cn } from "@/lib/utils";

/**
 * /m/reports, on the aggregates computed by migration 0011.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  AN EMPTY REPORT IS THE NORMAL FIRST EXPERIENCE, NOT AN ERROR.
 *
 *  A restaurant opens this page on the day it is approved, with no orders and
 *  possibly without 0011 having been run. Every panel therefore has a written
 *  zero state, and every division is guarded — a chart with an empty axis or a
 *  tile reading "NaN FCFA" tells a new tenant their software is broken.
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  THE RANGE IS A URL, NOT STATE. `?range=90d` survives a refresh, can be
 *  bookmarked and sent to a business partner, and the new window is computed
 *  on the server — where the clock and the timezone are the restaurant's, not
 *  the browser's.
 */

const RANGES: ReportRange[] = ["7d", "30d", "90d", "12m"];

const RANGE_KEY: Record<ReportRange, TranslationKey> = {
  "7d": "mrp.range.7d",
  "30d": "mrp.range.30d",
  "90d": "mrp.range.90d",
  "12m": "mrp.range.12m",
};

const SERIES_DESCRIPTION: Record<ReportBucket, TranslationKey> = {
  day: "mrp.chart.sales.day",
  week: "mrp.chart.sales.week",
  month: "mrp.chart.sales.month",
};

/**
 * Monday first. `dow` arrives 0 = Sunday from the SQL (and from getDay()), but
 * nobody in Douala reads their trading week as starting on a Sunday.
 */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** 2024-01-07 was a Sunday, so `dow` maps straight onto this + dow days. */
const WEEKDAY_REFERENCE = Date.UTC(2024, 0, 7, 12);

/** The chart bodies are 260px tall; a zero state that matches keeps rows aligned. */
function ChartEmpty({ label }: { label: string }) {
  return (
    <div className="grid h-[260px] place-items-center px-5 text-center text-sm text-text-light">
      <span>{label}</span>
    </div>
  );
}

export function ReportsView({ report }: { report: ReportData }) {
  const { t } = useLocale();
  const dates = useDates();

  const { summary, bucket } = report;

  /**
   * Weekday and month names come from Intl, never from an array of French
   * strings — the toggle has to reach them like everything else. Built from a
   * FIXED reference date rather than today's, so nothing here reads the clock
   * during render.
   */
  const weekdayShort = useMemo(() => {
    const format = new Intl.DateTimeFormat(dates.locale, { weekday: "short", timeZone: "UTC" });
    return (dow: number) => format.format(new Date(WEEKDAY_REFERENCE + dow * 86_400_000));
  }, [dates.locale]);

  const bucketLabel = useMemo(() => {
    // A month bucket labelled "3 août" reads as a day. Twelve months never
    // repeat inside one window, so the month alone is unambiguous.
    const format = new Intl.DateTimeFormat(dates.locale, {
      timeZone: DISPLAY_TZ,
      ...(bucket === "month" ? { month: "short" } : { day: "numeric", month: "short" }),
    });
    return (iso: string) => format.format(new Date(iso));
  }, [dates.locale, bucket]);

  const seriesData = useMemo(
    () => report.series.map((point) => ({ label: bucketLabel(point.bucket), revenue: point.revenue })),
    [report.series, bucketLabel],
  );

  /**
   * All seven days, always. A bar chart holding only the three days that sold
   * hides the interesting half of the answer — which days did not.
   */
  const weekdayData = useMemo(() => {
    const byDow = new Map(report.weekdays.map((d) => [d.dow, d]));
    return WEEK_ORDER.map((dow) => ({
      label: weekdayShort(dow),
      revenue: byDow.get(dow)?.revenue ?? 0,
    }));
  }, [report.weekdays, weekdayShort]);

  /**
   * From the first hour that sold to the last, gaps included.
   *
   * Twenty-four bars on a phone are unreadable, and a kitchen that closes at
   * 23:00 learns nothing from eight columns of zeroes at dawn. The gaps INSIDE
   * the service window are kept, because a dead hour between two rushes is a
   * finding.
   */
  const hourData = useMemo(() => {
    if (report.hours.length === 0) return [];

    const byHour = new Map(report.hours.map((h) => [h.hour, h]));
    const present = report.hours.map((h) => h.hour);
    const first = Math.min(...present);
    const last = Math.max(...present);

    const rows: { label: string; orders: number }[] = [];
    for (let hour = first; hour <= last; hour += 1) {
      rows.push({
        label: `${String(hour).padStart(2, "0")}:00`,
        orders: byHour.get(hour)?.orderCount ?? 0,
      });
    }
    return rows;
  }, [report.hours]);

  /**
   * MixPieChart renders its values as percentages, so shares are what it gets.
   * Revenue share rather than order share: two dine-in tickets and one large
   * delivery are not "67 % dining room" in any sense the owner cares about.
   */
  const mixData = useMemo(() => {
    const total = report.mix.reduce((sum, slice) => sum + slice.revenue, 0);
    if (total <= 0) return [];

    return report.mix.map((slice) => ({
      label: orderTypeLabel(slice.type, t),
      share: Math.round((slice.revenue / total) * 100),
    }));
  }, [report.mix, t]);

  const bestDay = useMemo(
    () =>
      report.weekdays.reduce<{ dow: number; revenue: number } | null>(
        (top, day) => (top === null || day.revenue > top.revenue ? day : top),
        null,
      ),
    [report.weekdays],
  );

  const selector = (
    <div>
      <nav aria-label={t("mrp.range.legend")} className="flex flex-wrap gap-2">
        {RANGES.map((value) => {
          const current = value === report.range;
          return (
            <Link
              key={value}
              href={`/m/reports?range=${value}`}
              scroll={false}
              aria-current={current ? "page" : undefined}
              className={cn(
                "inline-flex items-center rounded-full border px-3.5 py-1.5",
                "text-sm font-medium whitespace-nowrap transition-colors",
                current
                  ? "border-primary bg-primary text-primary-fg"
                  : "border-border bg-surface text-text-secondary hover:border-border-strong hover:text-text",
              )}
            >
              <span>{t(RANGE_KEY[value])}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-3 flex flex-col gap-0.5 text-sm text-text-secondary">
        <span>{t("mrp.period", { from: dates.date(report.from), to: dates.date(report.to) })}</span>
        <span className="text-text-light">{t("mrp.basis")}</span>
      </div>
    </div>
  );

  if (!report.hasData) {
    return (
      <>
        {selector}
        <Card className="mt-6">
          <EmptyState
            icon={<ChartColumn />}
            title={t("mrp.empty.title")}
            description={t("mrp.empty.body")}
            action={<p className="text-sm text-text-light">{t("mrp.empty.hint")}</p>}
          />
        </Card>
      </>
    );
  }

  return (
    <>
      {selector}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label={t("mrp.stat.revenue")}
          value={formatMoneyCompact(summary.revenue)}
          hint={t("mrp.stat.revenueHint")}
          icon={<Banknote />}
          tone="dark"
        />
        <StatTile
          label={t("mrp.stat.orders")}
          value={summary.orderCount}
          hint={
            summary.cancelled > 0
              ? t("mrp.stat.cancelled", { count: summary.cancelled })
              : t("mrp.stat.ordersHint", { count: summary.customerCount })
          }
          icon={<ReceiptText />}
        />
        <StatTile
          label={t("mrp.stat.basket")}
          // Guarded: a window can hold cancelled orders only, and 0/0 is NaN.
          value={
            summary.orderCount > 0
              ? formatMoney(Math.round(summary.revenue / summary.orderCount))
              : "—"
          }
          hint={t("mrp.stat.basketHint")}
          icon={<TrendingUp />}
        />
        <StatTile
          label={t("mrp.stat.bestDay")}
          value={bestDay && bestDay.revenue > 0 ? dates.weekday(bestDay.dow) : "—"}
          hint={
            bestDay && bestDay.revenue > 0 ? formatMoneyCompact(bestDay.revenue) : undefined
          }
          icon={<ChartColumn />}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Panel title={t("mrp.chart.sales")} description={t(SERIES_DESCRIPTION[bucket])}>
          {seriesData.length === 0 ? (
            <ChartEmpty label={t("mrp.chart.empty")} />
          ) : (
            <CardBody>
              <SalesLineChart
                data={seriesData}
                xKey="label"
                yKey="revenue"
                label={t("mrp.chart.revenueLabel")}
              />
            </CardBody>
          )}
        </Panel>

        <Panel title={t("mrp.chart.weekday")} description={t("mrp.chart.weekdayDesc")}>
          {report.weekdays.length === 0 ? (
            <ChartEmpty label={t("mrp.chart.empty")} />
          ) : (
            <CardBody>
              <VolumeBarChart
                data={weekdayData}
                xKey="label"
                yKey="revenue"
                label={t("mrp.chart.revenueLabel")}
                money
              />
            </CardBody>
          )}
        </Panel>

        <Panel title={t("mrp.chart.hours")} description={t("mrp.chart.hoursDesc")}>
          {hourData.length === 0 ? (
            <ChartEmpty label={t("mrp.chart.empty")} />
          ) : (
            <CardBody>
              <VolumeBarChart
                data={hourData}
                xKey="label"
                yKey="orders"
                label={t("mrp.chart.ordersLabel")}
              />
            </CardBody>
          )}
        </Panel>

        <Panel title={t("mrp.chart.mix")} description={t("mrp.chart.mixDesc")}>
          {mixData.length === 0 ? (
            <ChartEmpty label={t("mrp.chart.empty")} />
          ) : (
            <CardBody>
              <MixPieChart data={mixData} nameKey="label" valueKey="share" />
            </CardBody>
          )}
        </Panel>
      </div>

      <Panel
        className="mt-6"
        title={t("mrp.chart.dishes")}
        description={t("mrp.chart.dishesDesc")}
      >
        {report.topDishes.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-text-light">
            <span>{t("mrp.chart.empty")}</span>
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {report.topDishes.map((dish, index) => (
              <li key={dish.name} className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
                <span className="tnum grid size-7 shrink-0 place-items-center rounded-full bg-primary-light text-sm font-bold text-primary">
                  {index + 1}
                </span>

                {/* The figures sit under the name below `sm` rather than beside
                    it: three columns on a 360px screen truncate the dish to two
                    words, which is the one thing this list exists to say. */}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{dish.name}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-text-light">
                    <span className="tnum">{t("mrp.dish.sold", { count: dish.quantity })}</span>
                    <span className="tnum">{t("mrp.dish.orders", { count: dish.orderCount })}</span>
                  </div>
                </div>

                <span className="tnum shrink-0 text-right font-semibold">
                  {formatMoneyCompact(dish.revenue)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

/** 'delivery' | 'pickup' | 'dine_in' from the database; anything else as-is. */
function orderTypeLabel(type: string, t: (key: TranslationKey) => string): string {
  if (type === "delivery" || type === "pickup" || type === "dine_in") {
    return t(`order.type.${type}` as TranslationKey);
  }
  return type;
}

/**
 * The plan gate's other half (§14.4).
 *
 * A Client Component because the page that decides this is a Server Component
 * and cannot translate its own copy. Locked tenants land here too: locking
 * drops a restaurant to Starter limits, and Starter has no analytics.
 */
export function ReportsUpsell() {
  const { t } = useLocale();

  return (
    <Card className="mx-auto max-w-lg">
      <CardBody className="py-12 text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-warning-light text-warning">
          <Lock className="size-6" aria-hidden />
        </span>
        <h2 className="mt-4 font-display text-xl font-bold">{t("mrp.locked.title")}</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-text-secondary">
          {t("mrp.locked.body")}
        </p>
        <Link
          href="/m/billing"
          className={buttonClasses({ size: "lg", className: "mt-6 w-full sm:w-auto" })}
        >
          {t("mrp.locked.cta")}
        </Link>
      </CardBody>
    </Card>
  );
}
