import { AdminPage } from "@/components/layout/admin-shell";
import { BroadcastComposer } from "./broadcast-composer";
import { getAudienceCounts, listBroadcasts } from "@/lib/data/platform";

export const dynamic = "force-dynamic";

export default async function BroadcastPage() {
  const [history, counts] = await Promise.all([listBroadcasts(), getAudienceCounts()]);

  return (
    <AdminPage title="Broadcast" description="One message to a chosen audience.">
      <BroadcastComposer history={history} counts={counts} />
    </AdminPage>
  );
}
