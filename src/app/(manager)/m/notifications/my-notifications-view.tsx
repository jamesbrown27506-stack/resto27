"use client";

import { Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardBody, Panel } from "@/components/ui/card";
import { NotificationSettings } from "@/components/notifications/notification-settings";
import { useNotifications } from "@/components/notifications/notification-provider";
import { useLocale } from "@/lib/i18n/use-locale";
import { cn } from "@/lib/utils";

/**
 * The ring first (is it audible on THIS screen right now?), then the shared
 * per-person channel panel. Testing the sound is also the tap that unlocks
 * it, which is exactly what a new tablet needs at opening time.
 */
export function MyNotificationsView() {
  const { t } = useLocale();
  const { playSound, soundReady, soundBlocked } = useNotifications();

  const ready = soundReady && !soundBlocked;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Panel title={t("mops.notif.soundTitle")} description={t("mops.notif.soundBody")}>
        <CardBody className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={playSound}>
            <Volume2 className="size-4" aria-hidden />
            <span>{t("mops.notif.soundTest")}</span>
          </Button>
          <p className={cn("text-sm font-medium", ready ? "text-success" : "text-warning")}>
            {ready ? t("mops.notif.soundReady") : t("mops.notif.soundBlocked")}
          </p>
        </CardBody>
      </Panel>

      <NotificationSettings />
    </div>
  );
}
