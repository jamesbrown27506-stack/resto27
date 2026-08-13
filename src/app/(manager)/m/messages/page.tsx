import type { Metadata } from "next";
import { ManagerPage } from "@/components/layout/manager-shell";
import { ManagerMessagesView } from "./messages-view";
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

  return (
    <ManagerPage titleKey="mchat.title" descriptionKey="mchat.subtitle">
      <ManagerMessagesView myId={profile.id} restaurantId={active.restaurantId} />
    </ManagerPage>
  );
}
