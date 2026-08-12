import { AdminPage } from "@/components/layout/admin-shell";
import { SupportInbox } from "./support-inbox";
import { listSupportMessages } from "@/lib/data/platform";

export const dynamic = "force-dynamic";

export default async function SupportPage() {
  const messages = await listSupportMessages();
  const open = messages.filter((m) => m.status === "open").length;

  return (
    <AdminPage
      title="Support"
      description={
        open > 0 ? `${open} open message${open === 1 ? "" : "s"}` : "Messages from the contact form."
      }
    >
      <SupportInbox messages={messages} />
    </AdminPage>
  );
}
