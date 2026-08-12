import { FavoritesClient } from "./favorites-client";
import { requireUser } from "@/lib/auth/session";
import { fetchFavoriteRestaurantIds } from "@/lib/data/customer";
import { fetchActiveRestaurants } from "@/lib/data/public";

export default async function FavoritesPage() {
  const user = await requireUser();

  const [ids, restaurants] = await Promise.all([
    fetchFavoriteRestaurantIds(user.id),
    fetchActiveRestaurants(),
  ]);

  return <FavoritesClient user={user} initial={ids} restaurants={restaurants} />;
}