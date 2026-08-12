import { AdminPage } from "@/components/layout/admin-shell";
import { AreasList } from "./areas-list";
import { listServiceAreasForAdmin } from "@/lib/data/admin";

export const dynamic = "force-dynamic";

export default async function AreasPage() {
  const areas = await listServiceAreasForAdmin();

  return (
    <AdminPage
      title="Service areas"
      description="Cities you operate in, their currency, timezone and neighbourhoods."
    >
      <AreasList areas={areas} />
    </AdminPage>
  );
}
