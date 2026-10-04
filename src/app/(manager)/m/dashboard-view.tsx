"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  BellRing,
  CalendarCheck,
  ChefHat,
  Package,
  Star,
  UtensilsCrossed,
} from "lucide-react";
import { SetupPanel, WelcomeNudge } from "./setup-panel";
import { MarkReviewsRead } from "./mark-reviews-read";
import { ServicePauseToggle } from "@/components/order/service-pause-toggle";
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
import { cn } from "@/lib/utils";
import { can, type BranchRole } from "@/lib/capabilities";
import type { SetupChecklist } from "@/lib/data/manager";

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
  checklist,
}: {
  firstName: string;
  branch: {
    restaurantName: string;
    branchLabel: string;
    status: "active" | "pending" | "suspended" | "paused";
    role: BranchRole;
    isAcceptingOrders: boolean;
  };
  planLabel: string;
  planTone: BadgeTone;
  overview: {
    ordersToday: number;
    revenueToday: number;
    awaitingConfirmation: number;
    pendingOrders: number;
    waitingOrders: number;
    pendingReservations: number;
    lowStockItems: number;
    unrepliedReviews: number;
    menuItems: number;
    unavailableItems: number;
    staffCount: number;
    averageRating: number;
    reviewCount: number;
  };
  upcoming: { id: string; guestName: string; partySize: number; reservedFor: string }[];
  menuItemLimit: number | null;
  /** Drives the "finish your setup" panel at the bottom of the page. */
  checklist: SetupChecklist;
}) {
  const { t } = useLocale();
  const dates = useDates();

  return (
    <ManagerPage
      title={t("m.greeting", { name: firstName })}
      description={`${branch.restaurantName}${
        branch.branchLabel && branch.branchLabel !== "Principal" ? ` — ${branch.branchLabel}` : ""
      }`}
      action={
        <>
          {can(branch.role, "service.pause") && (
            <ServicePauseToggle accepting={branch.isAcceptingOrders} />
          )}
          <Badge tone={planTone}>{planLabel}</Badge>
        </>
      }
    >
      <WelcomeNudge />

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

      {/*
        ────────────────────────────────────────────────────────────────────
         "REQUIRES YOUR ATTENTION" HAD TO STOP BEING POLITE.

         It used to be an ordinary Panel: same border, same surface, same
         type as the four panels beneath it — a heading and a row of grey
         chips. A customer's order sitting unanswered looked exactly like a
         review nobody had replied to, and both looked exactly like the menu
         summary. It was scrolled past, which for an unconfirmed order means
         a person waiting on food that is not being cooked.

         Two tiers now, because "attention" covers two different things:

           URGENT — an unanswered order or booking. Someone is waiting right
             now. Error colours, a live pulse on the count, and it is the
             first thing on the page. Nothing else on this dashboard is
             allowed to look like this, which is what makes it work.

           WORTH DOING — low stock, unanswered reviews. Real, not urgent.
             Warning colours, underneath, no pulse.

         `role="alert"` on the urgent tier so a screen reader is told, rather
         than left to find red boxes.
        ────────────────────────────────────────────────────────────────────
      */}
      {/*
        URGENT MEANS "WAITING ON US": `waitingOrders` is `pending` only. It
        used to be pending + confirmed + preparing, so the red box was on for
        the whole service — the kitchen cooking is not a customer waiting for
        an answer, and a box that is always red is a box nobody reads.
      */}
      {overview.waitingOrders + overview.pendingReservations > 0 && (
        <div
          role="alert"
          className="mb-4 overflow-hidden rounded-lg border-2 border-error bg-error-light"
        >
          <div className="flex flex-wrap items-center gap-3 border-b border-error/25 px-4 py-3">
            <span className="relative grid size-9 shrink-0 place-items-center rounded-full bg-error text-white">
              {/* The pulse is the part you catch out of the corner of your
                  eye from across the counter. Disabled under
                  prefers-reduced-motion by the global rule in globals.css. */}
              <span
                aria-hidden
                className="absolute inset-0 animate-ping rounded-full bg-error opacity-40"
              />
              <BellRing className="relative size-4" aria-hidden />
            </span>
            <p className="min-w-0 flex-1 font-display text-base font-bold text-error sm:text-lg">
              {t("m.attention.urgentTitle")}
            </p>
          </div>

          <ul className="flex flex-col gap-2 p-3 sm:flex-row sm:flex-wrap sm:gap-3">
            {overview.waitingOrders > 0 && (
              <AttentionLink
                urgent
                href="/m/orders"
                label={t("mops.attention.accept", { count: overview.waitingOrders })}
              />
            )}
            {overview.pendingReservations > 0 && (
              <AttentionLink
                urgent
                href="/m/reservations"
                label={t("m.attention.reservations", { count: overview.pendingReservations })}
              />
            )}
          </ul>
        </div>
      )}

      {overview.lowStockItems + overview.unrepliedReviews > 0 && (
        <div className="mb-6 overflow-hidden rounded-lg border border-warning/40 bg-warning-light/60">
          <p className="flex items-center gap-2 border-b border-warning/25 px-4 py-2.5 text-sm font-semibold text-warning">
            <AlertTriangle className="size-4 shrink-0" aria-hidden />
            <span>{t("m.attention.title")}</span>
          </p>
          <ul className="flex flex-col gap-2 p-3 sm:flex-row sm:flex-wrap sm:gap-3">
            {overview.lowStockItems > 0 && (
              <AttentionLink
                href="/m/menu"
                label={t("m.attention.lowStock", { count: overview.lowStockItems })}
              />
            )}
            {overview.unrepliedReviews > 0 && (
              <>
                <AttentionLink
                  href="/m/reviews"
                  label={t("m.attention.reviews", { count: overview.unrepliedReviews })}
                />
                <MarkReviewsRead />
              </>
            )}
          </ul>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label={t("m.stat.ordersToday")}
          value={String(overview.ordersToday)}
          icon={<Package />}
        />
        {/* The hint explains the gap between "orders today" and this number.
            Without it, a morning of unanswered orders looks like a bug.

            Only for `reports.view`: the day's takings are the owner's
            business, not something every waiter's phone should display. */}
        {can(branch.role, "reports.view") && (
          <StatTile
            label={t("m.stat.revenueToday")}
            value={formatMoney(overview.revenueToday)}
            icon={<Banknote />}
            hint={
              overview.awaitingConfirmation > 0
                ? t("m.stat.revenuePending", { count: overview.awaitingConfirmation })
                : t("m.stat.revenueHint")
            }
          />
        )}
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

      <SetupPanel checklist={checklist} canEditProfile={can(branch.role, "profile.edit")} />
    </ManagerPage>
  );
}

/** One tappable "you need to look at this" row. */
function AttentionLink({
  href,
  label,
  urgent = false,
}: {
  href: string;
  label: string;
  /** Solid error fill — reserved for the tier where someone is waiting. */
  urgent?: boolean;
}) {
  return (
    <li className="min-w-0">
      <Link
        href={href}
        className={cn(
          "flex items-center gap-2 rounded-md border px-3 py-2.5 text-sm font-semibold transition-colors",
          urgent
            ? "border-transparent bg-error text-white hover:brightness-110"
            : "border-warning/30 bg-surface px-3 py-2 font-medium text-warning hover:border-warning",
        )}
      >
        <ArrowRight className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{label}</span>
      </Link>
    </li>
  );
}
