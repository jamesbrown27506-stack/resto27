import { AdminPage } from "@/components/layout/admin-shell";
import { CouponsClient } from "./coupons-client";
import { listPlatformCoupons } from "@/lib/data/platform";

export const dynamic = "force-dynamic";

export default async function CouponsPage() {
  const coupons = await listPlatformCoupons();
  const active = coupons.filter((c) => c.isActive).length;

  return (
    <AdminPage
      title="Coupons"
      description={`${active} active · ${coupons.length} total. Codes customers can enter at checkout, run by the platform.`}
    >
      <CouponsClient coupons={coupons} />
    </AdminPage>
  );
}
