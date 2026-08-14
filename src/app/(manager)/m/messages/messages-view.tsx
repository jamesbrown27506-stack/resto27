"use client";

import { useState } from "react";
import { LifeBuoy, Users } from "lucide-react";
import { ChatInbox } from "@/components/chat/chat-inbox";
import { Tabs } from "@/components/ui/tabs";
import { useLocale } from "@/lib/i18n/use-locale";

/**
 * The restaurant's two inboxes, side by side behind one tab strip.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THEY POINT IN OPPOSITE DIRECTIONS, AND THAT IS WHY THEY ARE SEPARATE.
 *
 *   · Customers — diners writing to this branch. The restaurant answers.
 *     Branch-scoped: switching location must never carry one restaurant's
 *     threads into another's.
 *   · Support   — this restaurant writing to the platform. An admin answers.
 *     NOT branch-scoped: the thread belongs to the person, not the location,
 *     because "my subscription is wrong" is not a question about a branch.
 *
 *  Merging them into one list would put the tenant on both sides of the same
 *  inbox, where "unread" would mean two different things in adjacent rows.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function ManagerMessagesView({
  myId,
  restaurantId,
  platformName,
}: {
  myId: string;
  restaurantId: string;
  /** The platform's own name, so "write to the team" names the right team. */
  platformName: string;
}) {
  const { t } = useLocale();
  const [tab, setTab] = useState<"customers" | "platform">("customers");

  return (
    <>
      <Tabs
        className="mb-5"
        value={tab}
        onChange={(value) => setTab(value as "customers" | "platform")}
        items={[
          {
            value: "customers",
            label: t("mchat.tab.customers"),
            icon: <Users aria-hidden />,
          },
          {
            value: "platform",
            label: t("mchat.tab.platform"),
            icon: <LifeBuoy aria-hidden />,
          },
        ]}
      />

      {tab === "customers" ? (
        // Keyed on the branch: staff inboxes are per-branch, and switching
        // location must not carry one restaurant's threads into another's.
        <ChatInbox
          key={restaurantId}
          mode="staff"
          myId={myId}
          restaurantId={restaurantId}
          platformName={platformName}
        />
      ) : (
        <div>
          <p className="mb-4 flex items-start gap-2.5 rounded-md border border-border bg-surface-2 p-4 text-sm text-text-secondary">
            <LifeBuoy className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <span>{t("msup.subtitle", { name: platformName })}</span>
          </p>
          <ChatInbox mode="platform" myId={myId} platformName={platformName} />
        </div>
      )}
    </>
  );
}
