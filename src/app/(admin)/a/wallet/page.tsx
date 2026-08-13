import { AdminPage } from "@/components/layout/admin-shell";
import { WalletInbox } from "./wallet-inbox";
import { listWithdrawalRequests } from "@/lib/data/wallet";
import { requireRole } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function WalletPage() {
  const [admin, requests] = await Promise.all([
    requireRole("admin"),
    listWithdrawalRequests(),
  ]);

  const pending = requests.filter((r) => r.status === "pending").length;

  return (
    <AdminPage
      title="Wallet"
      description={
        pending > 0
          ? `${pending} withdrawal${pending === 1 ? "" : "s"} awaiting approval`
          : "Restaurant wallets — credits and withdrawal requests."
      }
    >
      <WalletInbox adminName={admin.name} requests={requests} />
    </AdminPage>
  );
}
