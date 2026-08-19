import Link from "next/link";
import { CalendarCheck, Gift, Heart, ReceiptText, ShoppingBag } from "lucide-react";
import { AccountShell } from "@/components/layout/account-shell";
import { OrderCard } from "@/components/order/order-parts";
import { RestaurantCard } from "@/components/restaurant/restaurant-card";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, Panel } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatTile } from "@/components/ui/stat-tile";
import { requireUser } from "@/lib/auth/session";
import { getLocale, getTranslator } from "@/lib/i18n/locale-server";
import { reservationStatusLabel } from "@/lib/format/reservation-status";
import { getLoyaltyState } from "@/lib/data/cart-actions";
import {
  fetchCustomerOrders,
  fetchCustomerReservations,
  fetchFavoriteRestaurantIds,
} from "@/lib/data/customer";
import { fetchActiveRestaurants } from "@/lib/data/public";
import { formatMoney } from "@/lib/format/currency";
import { formatDayLabel, formatTime } from "@/lib/format/datetime";
import { isTerminal } from "@/lib/format/order-status";
import { RESERVATION_STATUS_TONE } from "@/lib/data/customer";

export default async function AccountPage() {
  const user = await requireUser();
  // `t` for a Server Component — same keys and same interpolation as the
  // client hook, which cannot run here (see lib/i18n/locale-server).
  const t = await getTranslator();
  const locale = await getLocale();

  const [orders, reservations, favoriteIds, restaurants, loyalty] = await Promise.all([
    fetchCustomerOrders(user.id),
    fetchCustomerReservations(user.id),
    fetchFavoriteRestaurantIds(user.id),
    fetchActiveRestaurants(),
    getLoyaltyState(),
  ]);

  const active = orders.filter((o) => !isTerminal(o.status));
  const recent = orders.slice(0, 3);
  const balance = loyalty.balance;
  const pointValue = loyalty.pointValue;

  const upcoming = reservations.filter(
    (r) => r.status === "confirmed" || r.status === "pending",
  );
  const favorites = restaurants.filter((r) => favoriteIds.includes(r.id)).slice(0, 3);

  return (
    <AccountShell
      user={user}
      title={t("cac.greeting", { name: user.name.split(" ")[0] })}
      description={t("cac.subtitle")}
      action={
        <Link href="/browse" className={buttonClasses()}>
          <ShoppingBag className="size-4" aria-hidden />
          {t("cac.order")}
        </Link>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label={t("cac.stat.active")}
          value={active.length}
          icon={<ReceiptText />}
          hint={active.length > 0 ? t("cac.stat.activeLive") : t("cac.stat.activeNone")}
        />
        <StatTile
          label={t("cac.stat.points")}
          value={balance.toLocaleString(locale === "en" ? "en-CM" : "fr-CM")}
          icon={<Gift />}
          hint={t("cac.stat.pointsWorth", { amount: formatMoney(balance * pointValue) })}
          tone="primary"
        />
        <StatTile
          label={t("cac.stat.upcoming")}
          value={upcoming.length}
          icon={<CalendarCheck />}
          hint={upcoming.length > 0 ? formatDayLabel(upcoming[0].reservedFor) : t("cac.stat.upcomingNone")}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel
          title={t("cac.recent.title")}
          action={
            <Link href="/orders" className="text-sm font-semibold text-primary hover:underline">
              {t("cac.seeAll")}
            </Link>
          }
        >
          <div className="p-5">
            {recent.length === 0 ? (
              <EmptyState
                icon={<ReceiptText />}
                title={t("cac.recent.empty")}
                description={t("cac.recent.emptyBody")}
                action={
                  <Link href="/browse" className={buttonClasses()}>
                    {t("cac.recent.discover")}
                  </Link>
                }
              />
            ) : (
              <div className="flex flex-col gap-4">
                {recent.map((order) => (
                  <OrderCard key={order.id} order={order} />
                ))}
              </div>
            )}
          </div>
        </Panel>

        <div className="flex flex-col gap-6">
          <Panel
            title={t("cac.upcoming.title")}
            action={
              <Link
                href="/reservations"
                className="text-sm font-semibold text-primary hover:underline"
              >
                {t("cac.upcoming.manage")}
              </Link>
            }
          >
            <div className="p-5">
              {upcoming.length === 0 ? (
                <EmptyState
                  icon={<CalendarCheck />}
                  title={t("cac.upcoming.empty")}
                  description={t("cac.upcoming.emptyBody")}
                />
              ) : (
                <ul className="flex flex-col gap-3">
                  {upcoming.map((r) => (
                    <li
                      key={r.id}
                      className="flex items-center justify-between gap-3 rounded-md border border-border p-3.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{r.restaurantName}</p>
                        <p className="tnum mt-0.5 text-sm text-text-secondary">
                          {formatDayLabel(r.reservedFor)} · {formatTime(r.reservedFor)} ·{" "}
                          {t("cac.upcoming.people", { count: r.partySize })}
                        </p>
                      </div>
                      <Badge tone={RESERVATION_STATUS_TONE[r.status]}>
                        {reservationStatusLabel(r.status, t)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Panel>

          <Card className="bg-primary text-primary-fg">
            <CardBody>
              <Gift className="size-5 opacity-80" aria-hidden />
              <p className="tnum mt-3 font-display text-3xl font-bold">
                {balance.toLocaleString(locale === "en" ? "en-CM" : "fr-CM")} {t("cac.points.unit")}
              </p>
              <p className="mt-1 text-sm opacity-70">
                {t("cac.points.body", { amount: formatMoney(balance * pointValue) })}
              </p>
              <Link
                href="/loyalty"
                className="mt-4 inline-block text-sm font-semibold underline underline-offset-4"
              >
                {t("cac.points.history")}
              </Link>
            </CardBody>
          </Card>
        </div>
      </div>

      <section className="mt-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-display text-xl font-bold">
            <Heart className="mr-2 inline size-4 text-primary" aria-hidden />
            {t("cac.favorites.title")}
          </h2>
          <Link href="/favorites" className="text-sm font-semibold text-primary hover:underline">
            {t("cac.seeAll")}
          </Link>
        </div>

        {favorites.length === 0 ? (
          <EmptyState
            icon={<Heart />}
            title={t("cac.favorites.empty")}
            description={t("cac.favorites.emptyBody")}
          />
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {favorites.map((r) => (
              <RestaurantCard key={r.id} restaurant={r} href={`/restaurants/${r.slug}`} />
            ))}
          </div>
        )}
      </section>
    </AccountShell>
  );
}
