import type { Metadata } from "next";
import { ManagerPage } from "@/components/layout/manager-shell";
import { ManagerMessagesView } from "./messages-view";
import { requireBranch } from "@/lib/auth/branch";
import { getBranding } from "@/lib/branding";
import { listBroadcastsForAudience } from "@/lib/data/platform";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/locale-server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: DICTIONARIES[locale]["mchat.title"] };
}

export default async function ManagerMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; tab?: string }>;
}) {
  const { active, profile } = await requireBranch();
  const [brand, params, announcements] = await Promise.all([
    getBranding(),
    searchParams,
    listBroadcastsForAudience("managers"),
  ]);

  return (
    <ManagerPage titleKey="mchat.title" descriptionKey="mchat.subtitle">
      <ManagerMessagesView
        myId={profile.id}
        restaurantId={active.restaurantId}
        platformName={brand.name}
        initialConversationId={params.c ?? null}
        initialTab={params.tab === "announcements" ? "announcements" : undefined}
        announcements={announcements}
      />
    </ManagerPage>
  );
}
