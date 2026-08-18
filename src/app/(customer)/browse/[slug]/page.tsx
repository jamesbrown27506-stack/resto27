import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock, MapPin, Phone, Star, Store } from "lucide-react";
import { MenuOrderer } from "./menu-orderer";
import { fetchMenuSections, fetchPublicRestaurantBySlug } from "@/lib/data/public";
import { formatMoney } from "@/lib/format/currency";
import { getTranslator } from "@/lib/i18n/locale-server";

export default async function BrowseRestaurantPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const restaurant = await fetchPublicRestaurantBySlug(slug);
  if (!restaurant) notFound();
  const t = await getTranslator();

  const menu = await fetchMenuSections(restaurant.id);

  return (
    <div className="container-page py-8">
      <Link
        href="/browse"
        className="inline-flex items-center gap-2 text-sm font-medium text-text-secondary hover:text-primary"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        {t("cbr.backAll")}
      </Link>

      <header className="mt-5 flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
        <div className="flex min-w-0 items-start gap-4">
          {restaurant.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={restaurant.logoUrl}
              alt=""
              className="size-16 shrink-0 rounded-lg border border-border object-cover"
            />
          ) : (
            <span className="grid size-16 shrink-0 place-items-center rounded-lg border border-border bg-surface-2">
              <Store className="size-7 text-primary" aria-hidden />
            </span>
          )}
          <div className="min-w-0">
            <h1 className="font-display text-3xl font-bold">
              {restaurant.name}
              {!restaurant.isPrimary && (
                <span className="ml-2 text-lg font-normal text-text-light">
                  {restaurant.branchLabel}
                </span>
              )}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-secondary">
              <span className="inline-flex items-center gap-1">
                <Star className="size-3.5 fill-accent text-accent" aria-hidden />
                <span className="tnum font-semibold text-text">
                  {restaurant.rating.toFixed(1).replace(".", ",")}
                </span>
                ({restaurant.reviewCount})
              </span>
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5 text-primary" aria-hidden />
                {restaurant.quartier}
                {restaurant.addressLine && ` — ${restaurant.addressLine}`}
              </span>
              {/* The estimate is a DELIVERY time; pickup-only restaurants
                  don't promise one. */}
              {restaurant.acceptsDelivery && (
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-3.5 text-primary" aria-hidden />
                  {restaurant.deliveryEstimateMin} min
                </span>
              )}
              {restaurant.phone && (
                <a
                  href={`tel:${restaurant.phone.replace(/\s/g, "")}`}
                  className="inline-flex items-center gap-1 hover:text-primary"
                >
                  <Phone className="size-3.5 text-primary" aria-hidden />
                  {restaurant.phone}
                </a>
              )}
              <span>{t("cbr.minimum", { amount: formatMoney(restaurant.minimumOrder) })}</span>
            </div>
          </div>
        </div>

        <Link
          href={`/restaurants/${restaurant.slug}`}
          className="text-sm font-medium text-primary hover:underline"
        >
          {t("cbr.infoReviews")}
        </Link>
      </header>

      <MenuOrderer
        menu={menu}
        restaurant={{ id: restaurant.id, name: restaurant.name, slug: restaurant.slug }}
        acceptingOrders={restaurant.isAcceptingOrders}
      />
    </div>
  );
}