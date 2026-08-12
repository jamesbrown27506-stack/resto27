import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Bike, CalendarCheck, Clock, MapPin, Phone, ShoppingBag, Store } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { RatingStars } from "@/components/ui/rating-stars";
import { HoursTable, ReviewList } from "@/components/restaurant/restaurant-detail-parts";
import { splitTags, ALLERGEN_LABEL, DIETARY_TAG_LABEL } from "@/lib/format/tags";
import { fetchMenuSections, fetchPublicRestaurantBySlug } from "@/lib/data/public";
import { fetchReviews } from "@/lib/data/reviews";
import { formatMoney } from "@/lib/format/currency";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const restaurant = await fetchPublicRestaurantBySlug(slug);
  if (!restaurant) return { title: "Restaurant introuvable" };

  return {
    title: `${restaurant.name} — ${restaurant.quartier}, Douala`,
    description: restaurant.description,
    alternates: { canonical: `/restaurants/${restaurant.slug}` },
  };
}

export default async function RestaurantDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const restaurant = await fetchPublicRestaurantBySlug(slug);
  if (!restaurant) notFound();

  const [menu, reviews] = await Promise.all([
    fetchMenuSections(restaurant.id),
    fetchReviews(restaurant.id),
  ]);

  /** `Restaurant` JSON-LD (§14.1) — feeds the rich result for the listing. */
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: `${restaurant.name}${restaurant.isPrimary ? "" : ` — ${restaurant.branchLabel}`}`,
    description: restaurant.description,
    servesCuisine: restaurant.cuisine,
    telephone: restaurant.phone,
    address: {
      "@type": "PostalAddress",
      addressLocality: "Douala",
      addressRegion: restaurant.quartier,
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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div
        aria-hidden
        className="h-48 w-full sm:h-64"
        style={{
          background:
            "linear-gradient(120deg, var(--primary-light), var(--surface-2) 55%, color-mix(in oklab, var(--accent) 25%, var(--surface)))",
        }}
      />

      <div className="container-page pb-16">
        <header className="-mt-12 flex flex-wrap items-end justify-between gap-6">
          <div>
            <span className="grid size-24 place-items-center rounded-lg border-4 border-bg bg-surface shadow-md">
              <Store className="size-9 text-primary" aria-hidden />
            </span>

            <h1 className="mt-4 font-display text-3xl font-bold sm:text-4xl">
              {restaurant.name}
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
                {restaurant.quartier}, Douala
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clock className="size-3.5 text-primary" aria-hidden />
                environ {restaurant.deliveryEstimateMin} min
              </span>
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
                  Livraison dès {formatMoney(restaurant.minimumOrder)}
                </Badge>
              )}
              {restaurant.acceptsPickup && <Badge tone="neutral">À emporter</Badge>}
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link href={`/browse/${restaurant.slug}`} className={buttonClasses({ size: "lg" })}>
              <ShoppingBag className="size-4" aria-hidden />
              Commander
            </Link>
            <Link
              href={`/reservations?restaurant=${restaurant.slug}`}
              className={buttonClasses({ variant: "outline", size: "lg" })}
            >
              <CalendarCheck className="size-4" aria-hidden />
              Réserver une table
            </Link>
          </div>
        </header>

        <p className="mt-6 max-w-2xl leading-relaxed text-text-secondary">
          {restaurant.description}
        </p>

        <div className="mt-12 grid gap-10 lg:grid-cols-[1fr_20rem]">
          <div className="min-w-0">
            <h2 className="font-display text-2xl font-bold">Menu</h2>

            {menu.map(({ category, items }) => (
              <section key={category.id} className="mt-8">
                <h3 className="font-display text-lg font-bold text-primary">{category.name}</h3>

                <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface">
                  {items.map((item) => {
                    const soldOut =
                      !item.isAvailable || (item.trackStock && item.stockQuantity === 0);
                    const tags = splitTags(item.dietaryTags);
                    const allergens = splitTags(item.allergens);

                    return (
                      <li key={item.id} className="flex items-start justify-between gap-5 p-5">
                        <div className="min-w-0">
                          <p className="font-semibold">
                            {item.name}
                            {soldOut && (
                              <span className="ml-2 text-xs font-normal text-error">Épuisé</span>
                            )}
                          </p>
                          <p className="mt-1 text-sm leading-relaxed text-text-secondary">
                            {item.description}
                          </p>

                          {(tags.length > 0 || allergens.length > 0) && (
                            <div className="mt-2.5 flex flex-wrap gap-1.5">
                              {tags.map((t) => (
                                <Badge key={t} tone="success">
                                  {DIETARY_TAG_LABEL[t] ?? t}
                                </Badge>
                              ))}
                              {allergens.map((a) => (
                                <Badge key={a} tone="warning">
                                  {ALLERGEN_LABEL[a] ?? a}
                                </Badge>
                              ))}
                            </div>
                          )}

                          {item.optionGroups.length > 0 && (
                            <p className="mt-2 text-xs text-text-light">
                              {item.optionGroups.map((g) => g.name).join(" · ")}
                            </p>
                          )}
                        </div>

                        <p className="tnum shrink-0 font-display text-lg font-bold text-primary">
                          {formatMoney(item.price)}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}

            <section className="mt-12">
              <h2 className="font-display text-2xl font-bold">
                Avis <span className="text-text-light">({restaurant.reviewCount})</span>
              </h2>
              <div className="mt-5">
                <ReviewList reviews={reviews} />
              </div>
            </section>
          </div>

          <aside className="flex flex-col gap-5 lg:sticky lg:top-24 lg:self-start">
            <Card>
              <CardBody>
                <CardTitle>Horaires</CardTitle>
                <div className="mt-3">
                  <HoursTable hours={restaurant.hours} />
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardBody>
                <CardTitle>Livraison</CardTitle>
                <dl className="mt-3 flex flex-col gap-2.5 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-text-secondary">Commande minimum</dt>
                    <dd className="tnum font-semibold">{formatMoney(restaurant.minimumOrder)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-text-secondary">Délai estimé</dt>
                    <dd className="tnum font-semibold">{restaurant.deliveryEstimateMin} min</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-text-secondary">Frais de livraison</dt>
                    {/*
                      Never render "0 FCFA" here (§14.3). The fee is QUOTED by
                      the restaurant on confirmation, based on the quartier —
                      showing zero is a promise we are about to break.
                    */}
                    <dd className="font-semibold text-text-light">à confirmer</dd>
                  </div>
                </dl>
                <p className="mt-3 border-t border-border pt-3 text-xs leading-relaxed text-text-light">
                  Les frais de livraison sont fixés par le restaurant lorsqu&apos;il confirme votre
                  commande, selon votre quartier.
                </p>
              </CardBody>
            </Card>
          </aside>
        </div>
      </div>
    </>
  );
}
