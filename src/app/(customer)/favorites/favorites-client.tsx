"use client";

import Link from "next/link";
import { useState } from "react";
import { Heart } from "lucide-react";
import { AccountShell } from "@/components/layout/account-shell";
import { RestaurantCard, RestaurantGrid } from "@/components/restaurant/restaurant-card";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { toggleFavorite } from "@/lib/data/customer-actions";
import { useLocale } from "@/lib/i18n/use-locale";
import type { PublicRestaurant } from "@/lib/data/public";
import type { SessionUser } from "@/lib/session";

export function FavoritesClient({
  user,
  initial,
  restaurants,
}: {
  user: SessionUser;
  initial: string[];
  restaurants: PublicRestaurant[];
}) {
  const { toast } = useToast();
  const { t } = useLocale();
  const [ids, setIds] = useState<string[]>(initial);
  const favorites = restaurants.filter((r) => ids.includes(r.id));

  async function remove(restaurant: PublicRestaurant) {
    setIds((c) => c.filter((id) => id !== restaurant.id));
    const result = await toggleFavorite(restaurant.id);
    if (!result.ok) {
      setIds((c) => [...c, restaurant.id]);
      toast(result.error, "error");
    }
  }

  return (
    <AccountShell
      user={user}
      title={t("cfv.title")}
      description={t("cfv.subtitle")}
    >
      {favorites.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState
            icon={<Heart />}
            title={t("cfv.empty")}
            description={t("cfv.emptyBody")}
            action={
              <Link href="/browse" className={buttonClasses()}>
                {t("cfv.discover")}
              </Link>
            }
          />
        </div>
      ) : (
        <RestaurantGrid>
          {favorites.map((r) => (
            <RestaurantCard
              key={r.id}
              restaurant={r}
              href={`/browse/${r.slug}`}
              action={
                <button
                  type="button"
                  onClick={() => remove(r)}
                  aria-label={t("cfv.remove", { name: r.name })}
                  className="relative z-10 grid size-9 place-items-center rounded-full bg-surface text-error backdrop-blur-sm transition-transform hover:scale-110"
                >
                  <Heart className="size-4 fill-current" aria-hidden />
                </button>
              }
            />
          ))}
        </RestaurantGrid>
      )}
    </AccountShell>
  );
}