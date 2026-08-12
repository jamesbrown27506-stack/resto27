import { AdminPage } from "@/components/layout/admin-shell";
import { RestaurantsTable } from "./restaurants-table";
import { listRestaurantsForAdmin, listServiceAreasForAdmin } from "@/lib/data/admin";

/**
 * Reads live data, so it cannot be prerendered at build time — a restaurant
 * approved a minute ago must appear on the next load, not the next deploy.
 */
export const dynamic = "force-dynamic";

export default async function AdminRestaurantsPage() {
  const [restaurants, areas] = await Promise.all([
    listRestaurantsForAdmin(),
    listServiceAreasForAdmin(),
  ]);

  // Quartiers come from the lookup table rather than from the restaurants
  // themselves, so a quartier with no restaurants yet is still filterable.
  const quartiers = areas.flatMap((a) => a.quartiers.map((q) => q.name)).sort();

  return (
    <AdminPage title="Restaurants" description="Approbations, suspensions et réactivations.">
      <RestaurantsTable restaurants={restaurants} quartiers={quartiers} />
    </AdminPage>
  );
}
