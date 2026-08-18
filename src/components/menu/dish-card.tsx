import Link from "next/link";
import { useState } from "react";
import { Plus, UtensilsCrossed } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { RatingStars } from "@/components/ui/rating-stars";
import { formatMoney } from "@/lib/format/currency";
import { splitTags, DIETARY_TAG_LABEL } from "@/lib/format/tags";
import { useLocale } from "@/lib/i18n/use-locale";
import type { MenuItem } from "@/lib/data/manager";
import { cn } from "@/lib/utils";

function DishImage({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "grid size-full place-items-center bg-surface-2 text-text-light",
        className,
      )}
    >
      <UtensilsCrossed className="size-8 opacity-40" />
    </div>
  );
}

function DishPhoto({ src, className }: { src: string; className?: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <DishImage className={className} />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn("size-full object-cover", className)}
    />
  );
}

/**
 * Dish card for the homepage's "popular dishes" strip.
 *
 * The card sells the DISH with its photo, then hands the credit to the
 * RESTAURANT: an identity footer with the logo, the name and the rating —
 * "this is where you get it" is what turns a craving into an order. The
 * whole card is one stretched link into the restaurant's page.
 *
 * The "+" is deliberately NOT an add-to-cart button: a dish with required
 * options (§3) cannot be added without asking which ones, and a "+" that
 * silently picks defaults produces orders the kitchen cannot fill.
 */
export function DishCard({
  item,
  restaurantSlug,
  restaurantName,
  restaurantLogo,
  restaurantRating,
}: {
  item: MenuItem;
  restaurantSlug: string;
  restaurantName?: string;
  restaurantLogo?: string | null;
  restaurantRating?: number;
}) {
  const { t } = useLocale();
  const tags = splitTags(item.dietaryTags);
  const soldOut = !item.isAvailable || (item.trackStock && item.stockQuantity === 0);

  return (
    <article className="group relative overflow-hidden rounded-lg border border-border bg-surface transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className="relative aspect-[4/3] overflow-hidden">
        {item.imageUrl ? (
          <DishPhoto
            src={item.imageUrl}
            className="transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <DishImage className="transition-transform duration-500 group-hover:scale-105" />
        )}

        {/* The scrim keeps the price pill readable over any photo. */}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/45 to-transparent"
        />

        {soldOut && (
          <div className="absolute inset-0 grid place-items-center bg-text/55">
            <span className="rounded-full bg-surface px-3 py-1 text-xs font-bold text-text">
              {t("cbr.soldOut")}
            </span>
          </div>
        )}

        {tags.length > 0 && (
          <div className="absolute top-3 left-3 flex flex-wrap gap-1">
            {tags.slice(0, 2).map((tag) => (
              <Badge key={tag} tone="success" className="bg-surface/90">
                {DIETARY_TAG_LABEL[tag] ?? tag}
              </Badge>
            ))}
          </div>
        )}

        <span className="tnum absolute bottom-3 left-3 rounded-full bg-surface/95 px-3 py-1 text-sm font-bold text-text shadow-sm">
          {formatMoney(item.price)}
        </span>

        <span
          aria-hidden
          className={cn(
            "absolute top-3 right-3 grid size-9 place-items-center rounded-full transition-transform",
            soldOut
              ? "bg-surface/80 text-text-light"
              : "bg-primary/90 text-primary-fg backdrop-blur-sm group-hover:scale-110",
          )}
        >
          <Plus className="size-4" />
        </span>
      </div>

      <div className="p-4">
        <h3 className="truncate font-semibold">
          <Link href={`/restaurants/${restaurantSlug}`} className="after:absolute after:inset-0">
            {item.name}
          </Link>
        </h3>
        {item.description && (
          <p className="mt-1 line-clamp-2 text-sm text-text-secondary">{item.description}</p>
        )}

        {restaurantName && (
          <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
            <Avatar name={restaurantName} src={restaurantLogo} size="xs" />
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-secondary">
              {restaurantName}
            </span>
            {restaurantRating !== undefined && restaurantRating > 0 && (
              <RatingStars value={restaurantRating} size="sm" showValue />
            )}
          </div>
        )}
      </div>
    </article>
  );
}