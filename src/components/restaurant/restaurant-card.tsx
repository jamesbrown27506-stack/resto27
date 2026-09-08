"use client";

import Link from "@/components/layout/public-link";
import { BadgeCheck, Bike, Clock, MapPin, ShoppingBag } from "lucide-react";
import { OpenBadge } from "@/components/restaurant/open-badge";
import { RatingStars } from "@/components/ui/rating-stars";
import { formatMoney } from "@/lib/format/currency";
import { useLocale } from "@/lib/i18n/use-locale";
import { cn } from "@/lib/utils";
import type { PublicRestaurant as Restaurant } from "@/lib/data/public";

/** Deterministic gradient placeholder until real photography exists. */
function CoverPlaceholder({ seed, className }: { seed: string; className?: string }) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  const angle = Math.abs(hash) % 360;

  return (
    <div
      aria-hidden
      className={cn("size-full bg-primary-light", className)}
      style={{
        background: `linear-gradient(${angle}deg, var(--primary-light), var(--surface-2) 60%, color-mix(in oklab, var(--accent) 22%, var(--surface)))`,
      }}
    />
  );
}

export function RestaurantCard({
  restaurant,
  href,
  action,
}: {
  restaurant: Restaurant;
  /** Defaults to the public route; the signed-in area passes /browse/…. */
  href?: string;
  /** Favourite toggle, injected by the customer directory. */
  action?: React.ReactNode;
}) {
  const { t } = useLocale();
  const target = href ?? `/restaurants/${restaurant.slug}`;

  return (
    <article className="group relative overflow-hidden rounded-lg border border-border bg-surface transition-all duration-200 hover:-translate-y-1 hover:shadow-md">
      <div className="relative aspect-[4/3] overflow-hidden">
        {/*
          THE LOGO IS THE RESTAURANT'S FACE IN A LIST.

          A directory is a row of restaurants being told apart, and the mark is
          what does that — it is designed to be recognised at thumbnail size,
          which a photograph of a dining room is not. The cover photo has its
          own place: the full-width banner on the restaurant's own page, where
          it is large enough to be atmosphere rather than a smudge.

          CONTAINED, NEVER CROPPED. `object-cover` on a square mark inside a
          4:3 tile throws away the top and bottom — tiles came out as the
          middle third of a wordmark with the words cut in half. A cover
          photograph is made to be cropped; a logo is not. So it sits whole on
          a neutral ground, and only a restaurant with no logo at all falls
          back to its cover photo, which IS croppable.
        */}
        {restaurant.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={restaurant.logoUrl}
            alt=""
            loading="lazy"
            className="size-full bg-surface-2 object-contain p-6 transition-transform duration-500 group-hover:scale-105"
          />
        ) : restaurant.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={restaurant.coverUrl}
            alt=""
            loading="lazy"
            className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <CoverPlaceholder
            seed={restaurant.slug}
            className="transition-transform duration-500 group-hover:scale-105"
          />
        )}
        <div className="absolute top-3.5 left-3.5">
          <OpenBadge
            hours={restaurant.hours}
            acceptingOrders={restaurant.isAcceptingOrders}
          />
        </div>
        {action && <div className="absolute top-3 right-3">{action}</div>}
      </div>

      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-display text-lg leading-snug font-bold">
            {/* Stretched link: the whole card is the hit area, but the accessible
                name and the focus target stay on the heading link. */}
            <Link href={target} className="after:absolute after:inset-0">
              {restaurant.name}
            </Link>
            {restaurant.isVerified && (
              <span
                title={t("cbr.verifiedTitle")}
                className="ml-1.5 inline-flex translate-y-0.5 items-center gap-0.5 text-sm font-semibold text-primary"
              >
                <BadgeCheck className="size-4" aria-hidden />
                <span className="sr-only">{t("cbr.verified")}</span>
              </span>
            )}
            {!restaurant.isPrimary && (
              <span className="ml-1.5 text-sm font-normal text-text-light">
                {restaurant.branchLabel}
              </span>
            )}
          </h3>
        </div>

        <p className="mt-1 line-clamp-2 text-sm text-text-secondary">{restaurant.description}</p>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-text-secondary">
          <RatingStars value={restaurant.rating} size="sm" showValue count={restaurant.reviewCount} />
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-3 text-primary" aria-hidden />
            {restaurant.quartier}
          </span>
          {/* The estimate is a DELIVERY time; a pickup-only restaurant must not
              promise one. The mode badges below carry its real offer. */}
          {restaurant.acceptsDelivery && (
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3 text-primary" aria-hidden />
              {restaurant.deliveryEstimateMin} min
            </span>
          )}
          {restaurant.acceptsDelivery && (
            <span className="inline-flex items-center gap-1">
              <Bike className="size-3 text-primary" aria-hidden />
              min. {formatMoney(restaurant.minimumOrder)}
            </span>
          )}
          {restaurant.acceptsPickup && !restaurant.acceptsDelivery && (
            <span className="inline-flex items-center gap-1">
              <ShoppingBag className="size-3 text-primary" aria-hidden />
              {t("cbr.pickup")}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

export function RestaurantGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}
