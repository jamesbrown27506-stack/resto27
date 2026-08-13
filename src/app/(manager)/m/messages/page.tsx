import type { Metadata } from "next";
import { ManagerPage } from "@/components/layout/manager-shell";
import { ChatInbox } from "@/components/chat/chat-inbox";
import { requireBranch } from "@/lib/auth/branch";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/locale-server";

// A new conversation lands while this page is open; a cached copy would hide
// it until someone reloads.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: DICTIONARIES[locale]["mchat.title"] };
}

export default async function ManagerMessagesPage() {
  const { active, profile } = await requireBranch();
  const locale = await getLocale();

  return (
    <ManagerPage titleKey="mchat.title" descriptionKey="mchat.subtitle">
      {/* Keyed on the branch: staff inboxes are per-branch, and switching
          location must not carry one restaurant's threads into another's. */}
      <ChatInbox
        key={active.restaurantId}
        mode="staff"
        myId={profile.id}
        restaurantId={active.restaurantId}
      />
    </ManagerPage>
  );
}
