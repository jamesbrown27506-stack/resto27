import Link from "next/link";
import { Plus, UtensilsCrossed } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/format/currency";
import { splitTags, DIETARY_TAG_LABEL } from "@/lib/format/tags";
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

/**
 * Dish card for the homepage's "popular dishes" strip and the public menu.
 *
 * The add button is a link into the restaurant, not an add-to-cart: a dish
 * with required options (§3) cannot be added without asking which ones, and a
 * "+" that silently picks defaults produces orders the kitchen cannot fill.
 */
export function DishCard({
  item,
  restaurantSlug,
  restaurantName,
}: {
  item: MenuItem;
  restaurantSlug: string;
  restaurantName?: string;
}) {
  const tags = splitTags(item.dietaryTags);
  const soldOut = !item.isAvailable || (item.trackStock && item.stockQuantity === 0);

  return (
    <article className="group relative overflow-hidden rounded-lg border border-border bg-surface transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className="relative aspect-[4/3] overflow-hidden">
        <DishImage className="transition-transform duration-500 group-hover:scale-105" />
        {soldOut && (
          <div className="absolute inset-0 grid place-items-center bg-text/55">
            <span className="rounded-full bg-surface px-3 py-1 text-xs font-bold text-text">
              Épuisé
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
      </div>

      <div className="flex items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <h3 className="truncate font-semibold">
            <Link href={`/restaurants/${restaurantSlug}`} className="after:absolute after:inset-0">
              {item.name}
            </Link>
          </h3>
          <p className="tnum text-sm font-bold text-primary">{formatMoney(item.price)}</p>
          {restaurantName && (
            <p className="mt-0.5 truncate text-xs text-text-light">{restaurantName}</p>
          )}
        </div>

        <span
          aria-hidden
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-full transition-transform",
            soldOut
              ? "bg-surface-2 text-text-light"
              : "bg-primary text-primary-fg group-hover:scale-110",
          )}
        >
          <Plus className="size-4" />
        </span>
      </div>
    </article>
  );
}
