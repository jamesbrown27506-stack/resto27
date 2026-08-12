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
import { RESERVATION_STATUS_LABEL, RESERVATION_STATUS_TONE } from "@/lib/data/customer";

export default async function AccountPage() {
  const user = await requireUser();

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
      title={`Bonjour, ${user.name.split(" ")[0]}`}
      description="Vos commandes, réservations et points de fidélité."
      action={
        <Link href="/browse" className={buttonClasses()}>
          <ShoppingBag className="size-4" aria-hidden />
          Commander
        </Link>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label="Commandes en cours"
          value={active.length}
          icon={<ReceiptText />}
          hint={active.length > 0 ? "Suivi en direct" : "Aucune en cours"}
        />
        <StatTile
          label="Points de fidélité"
          value={balance.toLocaleString("fr-CM")}
          icon={<Gift />}
          hint={`soit ${formatMoney(balance * pointValue)}`}
          tone="primary"
        />
        <StatTile
          label="Réservations à venir"
          value={upcoming.length}
          icon={<CalendarCheck />}
          hint={upcoming.length > 0 ? formatDayLabel(upcoming[0].reservedFor) : "Aucune"}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel
          title="Commandes récentes"
          action={
            <Link href="/orders" className="text-sm font-semibold text-primary hover:underline">
              Tout voir
            </Link>
          }
        >
          <div className="p-5">
            {recent.length === 0 ? (
              <EmptyState
                icon={<ReceiptText />}
                title="Aucune commande"
                description="Vos commandes apparaîtront ici."
                action={
                  <Link href="/browse" className={buttonClasses()}>
                    Découvrir les restaurants
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
            title="Prochaines réservations"
            action={
              <Link
                href="/reservations"
                className="text-sm font-semibold text-primary hover:underline"
              >
                Gérer
              </Link>
            }
          >
            <div className="p-5">
              {upcoming.length === 0 ? (
                <EmptyState
                  icon={<CalendarCheck />}
                  title="Aucune réservation"
                  description="Réservez une table dans vos restaurants favoris."
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
                          {formatDayLabel(r.reservedFor)} à {formatTime(r.reservedFor)} ·{" "}
                          {r.partySize} pers.
                        </p>
                      </div>
                      <Badge tone={RESERVATION_STATUS_TONE[r.status]}>
                        {RESERVATION_STATUS_LABEL[r.status]}
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
                {balance.toLocaleString("fr-CM")} pts
              </p>
              <p className="mt-1 text-sm opacity-70">
                Utilisables dès votre prochaine commande, soit{" "}
                {formatMoney(balance * pointValue)} de réduction.
              </p>
              <Link
                href="/loyalty"
                className="mt-4 inline-block text-sm font-semibold underline underline-offset-4"
              >
                Voir mon historique de points →
              </Link>
            </CardBody>
          </Card>
        </div>
      </div>

      <section className="mt-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-display text-xl font-bold">
            <Heart className="mr-2 inline size-4 text-primary" aria-hidden />
            Vos favoris
          </h2>
          <Link href="/favorites" className="text-sm font-semibold text-primary hover:underline">
            Tout voir
          </Link>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {favorites.map((r) => (
            <RestaurantCard key={r.id} restaurant={r} href={`/browse/${r.slug}`} />
          ))}
        </div>
      </section>
    </AccountShell>
  );
}
