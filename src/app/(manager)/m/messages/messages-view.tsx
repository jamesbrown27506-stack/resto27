"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LifeBuoy, Megaphone, Users } from "lucide-react";
import { ChatInbox } from "@/components/chat/chat-inbox";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs } from "@/components/ui/tabs";
import { markBroadcastNotificationsRead } from "@/lib/data/notify-actions";
import { formatDateTime } from "@/lib/format/datetime";
import { useLocale } from "@/lib/i18n/use-locale";

interface Announcement {
  id: string;
  subject: string;
  body: string;
  sentAt: string;
}

type MessageTab = "customers" | "platform" | "announcements";

export function ManagerMessagesView({
  myId,
  restaurantId,
  platformName,
  initialConversationId,
  initialTab,
  announcements,
}: {
  myId: string;
  restaurantId: string;
  platformName: string;
  initialConversationId?: string | null;
  initialTab?: MessageTab;
  announcements: Announcement[];
}) {
  const { t } = useLocale();
  const router = useRouter();
  const [tab, setTab] = useState<MessageTab>(
    initialConversationId ? "customers" : (initialTab ?? "customers"),
  );

  useEffect(() => {
    if (tab !== "announcements") return;
    void markBroadcastNotificationsRead().then((result) => {
      if (result.ok) router.refresh();
    });
  }, [router, tab]);

  return (
    <>
      <Tabs
        className="mb-5"
        value={tab}
        onChange={(value) => setTab(value as MessageTab)}
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
          {
            value: "announcements",
            label: t("mchat.tab.announcements"),
            icon: <Megaphone aria-hidden />,
          },
        ]}
      />

      {tab === "customers" ? (
        <ChatInbox
          key={restaurantId}
          mode="staff"
          myId={myId}
          restaurantId={restaurantId}
          platformName={platformName}
          initialConversationId={initialConversationId}
        />
      ) : tab === "platform" ? (
        <div>
          <p className="mb-4 flex items-start gap-2.5 rounded-md border border-border bg-surface-2 p-4 text-sm text-text-secondary">
            <LifeBuoy className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <span>{t("msup.subtitle", { name: platformName })}</span>
          </p>
          <ChatInbox mode="platform" myId={myId} platformName={platformName} />
        </div>
      ) : (
        <Card className="overflow-hidden">
          <div className="border-b border-border bg-primary-light/30 px-5 py-4">
            <p className="flex items-center gap-2 font-display text-lg font-bold">
              <Megaphone className="size-5 text-primary" aria-hidden />
              <span>{t("mchat.announcements.title")}</span>
            </p>
            <p className="mt-1 text-sm text-text-secondary">
              {t("mchat.announcements.subtitle", { name: platformName })}
            </p>
          </div>
          {announcements.length === 0 ? (
            <EmptyState
              icon={<Megaphone />}
              title={t("mchat.announcements.empty")}
              description={t("mchat.announcements.emptyBody")}
            />
          ) : (
            <ol className="divide-y divide-border">
              {announcements.map((announcement, index) => (
                <li
                  key={announcement.id}
                  className="grid gap-3 px-5 py-5 sm:grid-cols-[2.5rem_1fr]"
                >
                  <span
                    className="grid size-10 place-items-center rounded-full bg-primary text-sm font-bold text-primary-fg"
                    aria-hidden
                  >
                    {index === 0 ? (
                      <Megaphone className="size-4" />
                    ) : (
                      announcement.subject.slice(0, 1).toUpperCase()
                    )}
                  </span>
                  <article className="min-w-0">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h2 className="font-semibold text-text">{announcement.subject}</h2>
                      <time
                        className="tnum shrink-0 text-xs text-text-light"
                        dateTime={announcement.sentAt}
                      >
                        {formatDateTime(announcement.sentAt)}
                      </time>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">
                      {announcement.body}
                    </p>
                  </article>
                </li>
              ))}
            </ol>
          )}
        </Card>
      )}
    </>
  );
}
