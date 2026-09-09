import { publicMetadata } from "@/lib/seo";
import { absolutePublicUrl, isUsableDescription } from "@/lib/seo-config";
import { getLocale } from "@/lib/i18n/locale-server";
import type { Metadata } from "next";
import Link from "@/components/layout/public-link";
import { notFound } from "next/navigation";
import { BadgeCheck, Bike, CalendarCheck, Clock, MapPin, Phone, Store } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { RatingStars } from "@/components/ui/rating-stars";
import { OpenBadge } from "@/components/restaurant/open-badge";
import { HoursTable, ReviewList } from "@/components/restaurant/restaurant-detail-parts";
import { MenuOrderer } from "@/components/menu/menu-orderer";
import { fetchMenuSections, fetchPublicRestaurantBySlug } from "@/lib/data/public";
import { fetchReviews } from "@/lib/data/reviews";
import { formatMoney } from "@/lib/format/currency";
import { getTranslator } from "@/lib/i18n/locale-server";
import { composeStreetAddress, formatQuartier, regionForCity } from "@/lib/geo-cm";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const restaurant = await fetchPublicRestaurantBySlug(slug);
  if (!restaurant) return { title: "Restaurant introuvable" };

  const locale = await getLocale();
  const place = [formatQuartier(restaurant.quartier), "Douala"].filter(Boolean).join(", ");
  // A partner description is used only when it is actually usable prose in
  // this page's language — see `isUsableDescription`. Otherwise the composed
  // sentence wins, which is always correct if less characterful.
  const description = isUsableDescription(restaurant.description, locale)
    ? restaurant.description
    : locale === "fr"
      ? `Consultez le menu, les prix et les horaires de ${restaurant.name} à ${place}. Commandez en livraison ou à emporter sur Resto237.`
      : `Browse the menu, prices and opening hours for ${restaurant.name} in ${place}. Order for delivery or pickup on Resto237.`;
  return publicMetadata("/restaurants/" + restaurant.slug, restaurant.name + " — " + place, description, restaurant.coverUrl ?? restaurant.logoUrl);
}

export default async function RestaurantDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const restaurant = await fetchPublicRestaurantBySlug(slug);
  if (!restaurant) notFound();
  const t = await getTranslator();
  const locale = await getLocale();
  const pageUrl = absolutePublicUrl("/restaurants/" + restaurant.slug, locale);
  const place = [formatQuartier(restaurant.quartier), "Douala"].filter(Boolean).join(", ");

  const [menu, reviews] = await Promise.all([
    fetchMenuSections(restaurant.id),
    fetchReviews(restaurant.id),
  ]);

  /**
   * `Restaurant` JSON-LD (§14.1) — feeds the rich result for the listing.
   *
   * Empty values are OMITTED, never emitted. This used to ship
   * `"openingHoursSpecification": []` and `"servesCuisine": ""` for any
   * restaurant that had not filled those in during onboarding. Neither breaks
   * validation, but an empty array does not read as "unspecified" — it reads
   * as "explicitly never open", which is worse than saying nothing. Cameroon
   * has thin Google Business Profile coverage, so this page's own schema is
   * often the only structured source for these facts; getting it wrong costs
   * more here than it would in a GBP-saturated market.
   */
  const openingHours = restaurant.hours
    .filter(h => h.opensAt && h.closesAt)
    .map(h => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][h.weekday],
      opens: h.opensAt,
      closes: h.closesAt,
    }));

  const menuPrices = menu.flatMap(section => section.items.map(item => item.price)).filter(p => p > 0);
  const priceRange = menuPrices.length
    ? `${Math.min(...menuPrices)}–${Math.max(...menuPrices)} XAF`
    : undefined;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    "@id": pageUrl + "#restaurant",
    url: pageUrl,
    image: restaurant.coverUrl ? new URL(restaurant.coverUrl, pageUrl).href : undefined,
    // Point at the menu section of this page rather than the page itself, so
    // `hasMenu` resolves somewhere that actually is a menu.
    hasMenu: menu.length ? pageUrl + "#menu" : undefined,
    openingHoursSpecification: openingHours.length ? openingHours : undefined,
    name: `${restaurant.name}${restaurant.isPrimary ? "" : ` — ${restaurant.branchLabel}`}`,
    // Same gate as the meta description: a partner sentence that is neither
    // long enough nor in this page's language is worse than no description.
    description: isUsableDescription(restaurant.description, locale) ? restaurant.description : undefined,
    servesCuisine: restaurant.cuisine || undefined,
    priceRange,
    telephone: restaurant.phone,
    address: {
      "@type": "PostalAddress",
      // The quartier belongs in the street address; `addressRegion` is the
      // administrative region (Littoral for Douala), not the neighbourhood.
      streetAddress: composeStreetAddress(restaurant.addressLine, restaurant.quartier),
      addressLocality: "Douala",
      addressRegion: regionForCity("Douala") ?? undefined,
      addressCountry: "CM",
    },
    aggregateRating:
      restaurant.reviewCount > 0
        ? {
            "@type": "AggregateRating",
            ratingValue: restaurant.rating,
            reviewCount: restaurant.reviewCount,
          }
        : undefined,
  };

  return (
    <>
      {/*
        JSON.stringify does NOT escape '<', so a restaurant named
        `</script><script>…` would break out of this tag and run in the
        visitor's browser. Escaping `<` inside the string is the standard
        JSON-in-script defence — the parser reads \u003c back as `<`.
      */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />

      {/*
        THE BANNER IS THE COVER PHOTO. IT IS NEVER THE LOGO.

        This read `logoUrl ? … : coverUrl ? …`, so a restaurant that had
        uploaded a logo got that logo as its banner — `object-cover` on a
        square mark across a 100%-wide, 192px-tall strip, which crops it to a
        letterbox band of its middle and then repeats it forty pixels below as
        the actual logo. The restaurant appeared to have the same image twice,
        and its cover photo — the one picture chosen to be seen at this size —
        was never shown at all while a logo existed.

        A logo is a mark: square, small, meant to be read whole. A cover is a
        photograph: wide, croppable, meant to be atmosphere. Substituting one
        for the other is not a fallback, so the fallback is the gradient.
      */}
      {restaurant.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={restaurant.coverUrl}
          alt={`${restaurant.name} — ${place}`}
          className="h-48 w-full object-cover sm:h-64"
        />
      ) : (
        <div
          aria-hidden
          className="h-48 w-full sm:h-64"
          style={{
            background:
              "linear-gradient(120deg, var(--primary-light), var(--surface-2) 55%, color-mix(in oklab, var(--accent) 25%, var(--surface)))",
          }}
        />
      )}

      <div className="container-page pb-16">
        <header className="-mt-12 flex flex-wrap items-end justify-between gap-6">
          <div>
            {restaurant.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={restaurant.logoUrl}
                // Decorative on purpose: the restaurant name is the <h1>
                // immediately below, so describing the mark would make a
                // screen reader announce the same name twice.
                alt=""
                className="size-24 rounded-lg border-4 border-bg bg-surface object-cover shadow-md"
              />
            ) : (
              <span className="grid size-24 place-items-center rounded-lg border-4 border-bg bg-surface shadow-md">
                <Store className="size-9 text-primary" aria-hidden />
              </span>
            )}

            <h1 className="mt-4 font-display text-3xl font-bold sm:text-4xl">
              {restaurant.name}
              {restaurant.isVerified && (
                <span
                  title={t("cbr.verifiedTitle")}
                  className="ml-2 inline-flex translate-y-1 items-center gap-1 text-xl font-semibold text-primary"
                >
                  <BadgeCheck className="size-6" aria-hidden />
                  <span className="sr-only">{t("cbr.verified")}</span>
                </span>
              )}
              {!restaurant.isPrimary && (
                <span className="ml-2 text-xl font-normal text-text-light">
                  {restaurant.branchLabel}
                </span>
              )}
            </h1>

            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-text-secondary">
              <RatingStars value={restaurant.rating} showValue count={restaurant.reviewCount} />
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-3.5 text-primary" aria-hidden />
                {formatQuartier(restaurant.quartier)}, Douala
                {restaurant.addressLine && ` — ${restaurant.addressLine}`}
              </span>
              {/* The estimate is a DELIVERY time; pickup-only restaurants
                  don't promise one. */}
              {restaurant.acceptsDelivery && (
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="size-3.5 text-primary" aria-hidden />
                  {t("cbr.about", { minutes: restaurant.deliveryEstimateMin })}
                </span>
              )}
              {restaurant.phone && (
                <a
                  href={`tel:${restaurant.phone.replace(/\s/g, "")}`}
                  className="inline-flex items-center gap-1.5 hover:text-primary"
                >
                  <Phone className="size-3.5 text-primary" aria-hidden />
                  {restaurant.phone}
                </a>
              )}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <Badge tone="primary">{restaurant.cuisine}</Badge>
              {restaurant.acceptsDelivery && (
                <Badge tone="neutral">
                  <Bike className="size-3" aria-hidden />
                  {t("cbr.deliveryFrom", { amount: formatMoney(restaurant.minimumOrder) })}
                </Badge>
              )}
              {restaurant.acceptsPickup && <Badge tone="neutral">{t("cbr.pickup")}</Badge>}
            </div>
          </div>

          {/*
            ────────────────────────────────────────────────────────────────
             ONE CALL TO ACTION, AND IT IS THE ONE THE PAGE CANNOT DO ITSELF.

             There used to be two equal buttons here: "Order" and "Book a
             table". "Order" went to a second copy of this restaurant on
             another route — so the most prominent control on the page was a
             navigation to somewhere that looked identical, while the menu
             right below it was inert.

             Ordering is now what the menu does. Tapping a dish adds a dish;
             there is nothing left for an "Order" button to mean. Booking a
             table is the one intention this page genuinely cannot satisfy
             in place, so it is the one button — full width on a phone, where
             a pair of buttons in a wrapped flex row is what pushed this
             header sideways.
            ────────────────────────────────────────────────────────────────
          */}
          <div className="flex w-full flex-col gap-2 sm:w-auto">
            <Link
              href={`/reservations?restaurant=${restaurant.slug}`}
              className={buttonClasses({ size: "lg", fullWidth: true, className: "sm:w-auto" })}
            >
              <CalendarCheck className="size-4" aria-hidden />
              {t("cbr.bookHere")}
            </Link>
            <p className="text-center text-xs text-text-light sm:text-right">
              {t("cbr.orderBelow")}
            </p>
          </div>
        </header>

        <p className="mt-6 max-w-2xl leading-relaxed text-text-secondary">
          {restaurant.description}
        </p>

        <div className="mt-12 grid gap-10 lg:grid-cols-[1fr_20rem]">
          <div className="min-w-0">
            <h2 className="font-display text-2xl font-bold">{t("cbr.menu")}</h2>

            {/*
              THE MENU IS ORDERABLE, RIGHT HERE.

              Same component the signed-in route used to own, now shared: each
              dish opens the option sheet and adds to the basket, and a sticky
              bar carries the running total once anything is in it. A customer
              who arrived from a photograph of Water Fufu can add Water Fufu
              from the page that photograph led to.

              `acceptingOrders` is the restaurant's own pause switch — the menu
              still reads, but nothing can be added while it is off.
            */}
            <div id="menu" className="scroll-mt-24">
              <MenuOrderer
                menu={menu}
                restaurant={{ id: restaurant.id, name: restaurant.name, slug: restaurant.slug }}
                acceptingOrders={restaurant.isAcceptingOrders}
              />
            </div>

            <section className="mt-12">
              <h2 className="font-display text-2xl font-bold">
                {t("cbr.reviews")}{" "}
                <span className="text-text-light">{t("cbr.reviewCount", { count: restaurant.reviewCount })}</span>
              </h2>
              <div className="mt-5">
                <ReviewList reviews={reviews} />
              </div>
            </section>
          </div>

          <aside className="flex flex-col gap-5 lg:sticky lg:top-24 lg:self-start">
            <Card>
              <CardBody>
                <CardTitle>{t("cbr.hours")}</CardTitle>
                <div className="mt-3">
                  <OpenBadge
                    hours={restaurant.hours}
                    acceptingOrders={restaurant.isAcceptingOrders}
                  />
                </div>
                <div className="mt-3">
                  <HoursTable hours={restaurant.hours} today={new Date().getDay()} />
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardBody>
                <CardTitle>{t("cbr.delivery")}</CardTitle>
                <dl className="mt-3 flex flex-col gap-2.5 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-text-secondary">{t("cbr.minOrder")}</dt>
                    <dd className="tnum font-semibold">{formatMoney(restaurant.minimumOrder)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-text-secondary">{t("cbr.estTime")}</dt>
                    <dd className="tnum font-semibold">
                      {t("cbr.about", { minutes: restaurant.deliveryEstimateMin })}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-text-secondary">{t("cbr.fee")}</dt>
                    {/*
                      Never render "0 FCFA" here (§14.3). The fee is QUOTED by
                      the restaurant on confirmation, based on the quartier —
                      showing zero is a promise we are about to break.

                      But "to be confirmed" is a shrug, and it was the only
                      thing a customer had to budget with. When the restaurant
                      has declared a band (migration 0035) the real numbers go
                      here instead, and the ceiling is enforced when the
                      restaurant quotes.
                    */}
                    <dd className="tnum text-right font-semibold">
                      {restaurant.maxDeliveryFee > 0 ? (
                        `${formatMoney(restaurant.minDeliveryFee, { showSymbol: false })} – ${formatMoney(restaurant.maxDeliveryFee)}`
                      ) : restaurant.minDeliveryFee > 0 ? (
                        t("cbr.feeFrom", { amount: formatMoney(restaurant.minDeliveryFee) })
                      ) : (
                        <span className="font-semibold text-text-light">
                          {t("cbr.feeToConfirm")}
                        </span>
                      )}
                    </dd>
                  </div>
                </dl>
                <p className="mt-3 border-t border-border pt-3 text-xs leading-relaxed text-text-light">
                  {t("cbr.feeNote")}
                </p>
              </CardBody>
            </Card>
          </aside>
        </div>
      </div>
    </>
  );
}
