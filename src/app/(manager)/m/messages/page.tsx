import type { Metadata } from "next";
import { ManagerPage } from "@/components/layout/manager-shell";
import { ManagerMessagesView } from "./messages-view";
import { requireBranch } from "@/lib/auth/branch";
import { getBranding } from "@/lib/branding";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/locale-server";

// A new conversation lands while this page is open; a cached copy would hide
// it until someone reloads.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: DICTIONARIES[locale]["mchat.title"] };
}

export default async function ManagerMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const [{ active, profile }, brand, params] = await Promise.all([
    requireBranch(),
    getBranding(),
    searchParams,
  ]);

  return (
    <ManagerPage titleKey="mchat.title" descriptionKey="mchat.subtitle">
      <ManagerMessagesView
        myId={profile.id}
        restaurantId={active.restaurantId}
        platformName={brand.name}
        initialConversationId={params.c ?? null}
      />
    </ManagerPage>
  );
}
