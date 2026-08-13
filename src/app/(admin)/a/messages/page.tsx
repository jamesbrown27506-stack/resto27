import { AdminPage } from "@/components/layout/admin-shell";
import { ChatInbox } from "@/components/chat/chat-inbox";
import { requireRole } from "@/lib/auth/session";

// A new conversation lands while this page is open; a cached copy would hide
// it until someone reloads.
export const dynamic = "force-dynamic";

export default async function AdminMessagesPage() {
  const admin = await requireRole("admin");

  return (
    <AdminPage
      title="Messages"
      description="Customer conversations with the RestoLink team."
    >
      <ChatInbox mode="admin" myId={admin.id} />
    </AdminPage>
  );
}
