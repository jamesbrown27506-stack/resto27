"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  CalendarCheck,
  ChefHat,
  Package,
  Star,
  UtensilsCrossed,
} from "lucide-react";
import { ManagerPage } from "@/components/layout/manager-shell";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, Panel } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatTile } from "@/components/ui/stat-tile";
import { UsageMeter } from "@/components/ui/meter";
import { formatMoney } from "@/lib/format/currency";
import { useDates } from "@/lib/format/use-dates";
import { useLocale } from "@/lib/i18n/use-locale";
import { can, type BranchRole } from "@/lib/capabilities";

/**
 * The restaurant dashboard.
 *
 * A Client Component purely so its copy can be translated — the page above it
 * does every read on the server and hands the numbers down. EVERY FIGURE HERE
 * IS A REAL COUNT: a dashboard that invents plausible numbers is worse than an
 * empty one, because nobody can tell which parts are real.
 */
export function DashboardView({
  firstName,
  branch,
  planLabel,
  planTone,
  overview,
  upcoming,
  menuItemLimit,
}: {
  firstName: string;
  branch: {
    restaurantName: string;
    branchLabel: string;
    status: "active" | "pending" | "suspended";
    role: BranchRole;
  };
  planLabel: string;
  planTone: BadgeTone;
  overview: {
    ordersToday: number;
    revenueToday: number;
    pendingOrders: number;
    menuItems: number;
    unavailableItems: number;
    lowStockItems: number;
    staffCount: number;
    averageRating: number;
    reviewCount: number;
  };
  upcoming: { id: string; guestName: string; partySize: number; reservedFor: string }[];
  menuItemLimit: number | null;
}) {
  const { t } = useLocale();
  const dates = useDates();

  return (
    <ManagerPage
      title={t("m.greeting", { name: firstName })}
      description={`${branch.restaurantName}${
        branch.branchLabel && branch.branchLabel !== "Principal" ? ` — ${branch.branchLabel}` : ""
      }`}
      action={<Badge tone={planTone}>{planLabel}</Badge>}
    >
      {/* A restaurant still awaiting approval can set everything up but is not
          yet listed. Saying so beats letting them wonder why nobody orders. */}
      {branch.status === "pending" && (
        <div
          role="status"
          className="mb-6 flex flex-wrap items-center gap-3 rounded-md border border-warning/30 bg-warning-light p-4 text-warning"
        >
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-semibold">{t("m.pending.title")}</span>{" "}
            <span className="opacity-85">{t("m.pending.body")}</span>
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label={t("m.stat.ordersToday")}
          value={String(overview.ordersToday)}
          icon={<Package />}
        />
        <StatTile
          label={t("m.stat.revenueToday")}
          value={formatMoney(overview.revenueToday)}
          icon={<Banknote />}
          hint={t("m.stat.revenueHint")}
        />
        <StatTile
          label={t("m.stat.inProgress")}
          value={String(overview.pendingOrders)}
          icon={<ChefHat />}
          hint={t("m.stat.inProgressHint")}
        />
        <StatTile
          label={t("m.stat.rating")}
          value={overview.reviewCount > 0 ? overview.averageRating.toFixed(1) : "—"}
          icon={<Star />}
          hint={
            overview.reviewCount > 0
              ? t("m.stat.reviews", { count: overview.reviewCount })
              : t("m.stat.noReviews")
          }
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel
          title={t("m.reservations.toConfirm")}
          action={
            can(branch.role, "reservations.view") && (
              <Link
                href="/m/reservations"
                className={buttonClasses({ variant: "ghost", size: "sm" })}
              >
                {t("m.viewAll")}
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            )
          }
        >
          {upcoming.length === 0 ? (
            <EmptyState
              icon={<CalendarCheck />}
              title={t("m.reservations.none")}
              description={t("m.reservations.noneBody")}
            />
          ) : (
            <ul className="divide-y divide-border">
              {upcoming.slice(0, 5).map((reservation) => (
                <li key={reservation.id} className="flex items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{reservation.guestName}</p>
                    <p className="text-sm text-text-secondary">
                      {t("m.people", { count: reservation.partySize })} ·{" "}
                      {dates.date(reservation.reservedFor)}
                    </p>
                  </div>
                  <Badge tone="warning">{t("res.status.pending")}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title={t("m.menu.yours")}
          action={
            <Link href="/m/menu" className={buttonClasses({ variant: "ghost", size: "sm" })}>
              {t("m.menu.manage")}
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          }
        >
          {overview.menuItems === 0 ? (
            <EmptyState
              icon={<UtensilsCrossed />}
              title={t("m.menu.empty")}
              description={t("m.menu.emptyBody")}
              action={
                <Link href="/m/menu" className={buttonClasses({ size: "sm" })}>
                  {t("m.menu.addDish")}
                </Link>
              }
            />
          ) : (
            <CardBody className="flex flex-col gap-4">
              <UsageMeter label={t("m.menu.dishes")} used={overview.menuItems} limit={menuItemLimit} />

              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-md bg-surface-2 p-3">
                  <dt className="text-text-light">{t("m.menu.unavailable")}</dt>
                  <dd className="tnum mt-0.5 font-display text-xl font-bold">
                    {overview.unavailableItems}
                  </dd>
                </div>
                <div className="rounded-md bg-surface-2 p-3">
                  <dt className="text-text-light">{t("m.menu.lowStock")}</dt>
                  <dd
                    className={`tnum mt-0.5 font-display text-xl font-bold ${
                      overview.lowStockItems > 0 ? "text-warning" : ""
                    }`}
                  >
                    {overview.lowStockItems}
                  </dd>
                </div>
              </dl>

              {overview.lowStockItems > 0 && (
                <p className="flex items-start gap-2 text-sm text-warning">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>{t("m.menu.lowStockAlert", { count: overview.lowStockItems })}</span>
                </p>
              )}
            </CardBody>
          )}
        </Panel>
      </div>

      {can(branch.role, "staff.manage") && (
        <Card className="mt-6">
          <CardBody className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="font-semibold">{t("m.team.count", { count: overview.staffCount })}</p>
              <p className="mt-0.5 text-sm text-text-secondary">{t("m.team.body")}</p>
            </div>
            <Link href="/m/staff" className={buttonClasses({ variant: "outline", size: "sm" })}>
              {t("m.team.manage")}
            </Link>
          </CardBody>
        </Card>
      )}
    </ManagerPage>
  );
}
