import Link from "next/link";
import { fetchMyStaffInvitations } from "@/lib/auth/staff-invitations";
import { CalendarCheck, Gift, Heart, ReceiptText, ShoppingBag, WalletCards } from "lucide-react";
import { fetchCustomerWalletOverview, type CustomerWalletOverview } from "@/lib/data/customer-wallet";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
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
import { formatDateTime, formatDayLabel, formatTime } from "@/lib/format/datetime";
import { isTerminal } from "@/lib/format/order-status";
import { partitionCustomerReservations } from "@/lib/reservations/lifecycle";
import { RESERVATION_STATUS_TONE } from "@/lib/data/customer";

/**
 * The Resto237 wallet: balance and the latest movements, so a refund the
 * customer was told about is something they can actually see (see
 * lib/data/customer-wallet for the incident this answers).
 */
function WalletCard({
  wallet,
  t,
  locale,
}: {
  wallet: CustomerWalletOverview;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
  locale: string;
}) {
  const kindLabel = (kind: string) =>
    kind === "refund" || kind === "payment" || kind === "adjustment"
      ? t(`cac.wallet.kind.${kind}` as TranslationKey)
      : kind;
  return (
    <Panel title={t("cac.wallet.title")}>
      <div className="p-5">
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-md bg-primary-light text-primary">
            <WalletCards className="size-5" aria-hidden />
          </span>
          <p translate="no" className="tnum font-display text-2xl font-bold">
            {formatMoney(wallet.balance)}
          </p>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-text-secondary">
          {wallet.available ? t("cac.wallet.body") : t("cac.wallet.unavailable")}
        </p>
        {wallet.available && (
          <div className="mt-4">
            <p className="text-xs font-semibold tracking-wide text-text-light uppercase">{t("cac.wallet.recent")}</p>
            {wallet.recent.length === 0 ? (
              <p className="mt-2 text-sm text-text-light">{t("cac.wallet.empty")}</p>
            ) : (
              <ul className="mt-2 divide-y divide-border">
                {wallet.recent.map((row) => (
                  <li key={row.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="block font-medium">
                        {kindLabel(row.kind)}
                        {row.reference && <span className="ml-1 font-mono text-xs text-text-light">{row.reference}</span>}
                      </span>
                      <span className="tnum block text-xs text-text-light">
                        {formatDateTime(row.createdAt, locale === "en" ? "en-CM" : "fr-CM")}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span translate="no" className={`tnum block font-semibold ${row.amount >= 0 ? "text-success" : "text-text"}`}>
                        {row.amount >= 0 ? "+" : "−"}{formatMoney(Math.abs(row.amount))}
                      </span>
                      <span translate="no" className="tnum block text-xs text-text-light">
                        {t("cac.wallet.balanceAfter", { amount: formatMoney(row.balanceAfter) })}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

export default async function AccountPage() {
  const user = await requireUser();
  // `t` for a Server Component — same keys and same interpolation as the
  // client hook, which cannot run here (see lib/i18n/locale-server).
  const t = await getTranslator();
  const locale = await getLocale();
  const staffInvitations = await fetchMyStaffInvitations();

  const [orders, reservations, favoriteIds, restaurants, loyalty, wallet] = await Promise.all([
    fetchCustomerOrders(user.id),
    fetchCustomerReservations(user.id),
    fetchFavoriteRestaurantIds(user.id),
    fetchActiveRestaurants(),
    getLoyaltyState(),
    fetchCustomerWalletOverview(user.id),
  ]);

  const active = orders.filter((o) => !isTerminal(o.status));
  const recent = orders.slice(0, 3);
  const balance = loyalty.balance;
  const pointValue = loyalty.pointValue;

  const { upcoming } = partitionCustomerReservations(reservations);
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
      {staffInvitations.map((invite) => {
        const restaurant = Array.isArray(invite.restaurants) ? invite.restaurants[0] : invite.restaurants;
        return <div key={invite.id} className="mb-4 rounded-md border border-border bg-surface-2 p-4">
          <p className="mb-3 font-semibold">{locale === "en" ? "Restaurant team invitation" : "Invitation à rejoindre une équipe"} : {restaurant?.name}</p>
          <Link href={`/invite/${invite.invite_token}`} className={buttonClasses()}>{locale === "en" ? "View and accept invitation" : "Voir et accepter l’invitation"}</Link>
        </div>;
      })}
      {user.role === "manager" && <Link href="/m" className={buttonClasses({ className: "mb-4" })}>{locale === "en" ? "Open my restaurant workspace" : "Ouvrir mon espace restaurant"}</Link>}
      {/* Straight to the figures, like the restaurant and admin dashboards —
          the account menu is the sidebar on desktop and the "Compte" tab on
          a phone, not a grid of links above the content. */}
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

          <WalletCard wallet={wallet} t={t} locale={locale} />

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
