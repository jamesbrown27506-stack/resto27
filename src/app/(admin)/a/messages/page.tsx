import { AdminPage } from "@/components/layout/admin-shell";
import { ChatInbox } from "@/components/chat/chat-inbox";
import { requireRole } from "@/lib/auth/session";
import { getBranding } from "@/lib/branding";

// A new conversation lands while this page is open; a cached copy would hide
// it until someone reloads.
export const dynamic = "force-dynamic";

export default async function AdminMessagesPage() {
  const [admin, brand] = await Promise.all([requireRole("admin"), getBranding()]);

  return (
    <AdminPage
      title="Messages"
      description={`Conversations with the ${brand.name} team — from customers and from restaurants.`}
    >
      <ChatInbox mode="admin" myId={admin.id} platformName={brand.name} />
    </AdminPage>
  );
}
