"use client";

import { useState } from "react";
import { AlertTriangle, Bell, BellRing, Mail } from "lucide-react";
import { AccountShell } from "@/components/layout/account-shell";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { NotificationSettings } from "@/components/notifications/notification-settings";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import { TypedConfirmDialog } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useLocale } from "@/lib/i18n/use-locale";
import { deleteOwnAccount, saveOwnPreferences } from "@/lib/data/customer-actions";
import {
  CUSTOMER_TOPICS,
  NOTIFICATION_CHANNEL_KEYS,
  type CustomerTopicKey,
  type NotificationChannelKey,
} from "@/lib/notifications/customer-topics";
import type { CustomerPreferences } from "@/lib/data/customer";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import type { SessionUser } from "@/lib/session";

/**
 * KEYS, NOT SENTENCES.
 *
 * The catalogue — which topics exist, their defaults, and which channels
 * cannot be switched off — lives in lib/notifications/customer-topics, so the
 * screen and the notifier read one definition. `key` doubles as the dictionary
 * suffix (`cst.evt.<key>` / `cst.evtBody.<key>`), and `defineDict` fails the
 * build if either translation is missing.
 */
const CHANNEL_ICON: Record<NotificationChannelKey, typeof Bell> = {
  inApp: Bell,
  email: Mail,
  push: BellRing,
};

export function SettingsClient({
  user,
  initial,
}: {
  user: SessionUser;
  initial: CustomerPreferences;
}) {
  const { toast } = useToast();
  const { t } = useLocale();
  const [prefs, setPrefs] = useState(initial);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    // No client-side pinning of locked channels: `saveOwnPreferences` re-applies
    // them server-side, which is the copy that decides.
    const result = await saveOwnPreferences(prefs);
    setBusy(false);
    /*
      The TRANSLATED sentence, not `result.error`.

      The action's message is a hard-coded French string, so an English
      interface was reporting its one failure in French — an English settings
      page answering a save with "Les préférences n'ont pas pu être
      enregistrées." There is no per-case detail in it worth surfacing: every
      cause means the same thing to the person reading it, and the log carries
      the Postgres code for whoever is debugging.
    */
    if (result.ok) toast(t("cst.saved"), "success");
    else toast(t("cst.saveFailed"), "error");
  }

  function setChannel(key: CustomerTopicKey, channel: NotificationChannelKey, value: boolean) {
    setPrefs((current) => ({
      ...current,
      [key]: { ...current[key], [channel]: value },
    }));
  }

  async function confirmDelete() {
    setBusy(true);
    const result = await deleteOwnAccount();
    setBusy(false);
    if (result.ok) {
      toast(t("cst.deleted"), "info");
      window.location.assign("/");
    } else {
      toast(result.error, "error");
      setDeleteOpen(false);
    }
  }

  return (
    <AccountShell user={user} title={t("cst.title")} description={t("cst.subtitle")}>
      <div className="flex flex-col gap-6">
        <Panel title={t("cst.appearance")}>
          <div className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div>
              <p className="text-sm font-medium">{t("cst.theme")}</p>
              <p className="mt-0.5 text-sm text-text-secondary">{t("cst.themeBody")}</p>
            </div>
            <ThemeToggle />
          </div>
        </Panel>

        {/* The three MASTER channels — in-app, email, push — and the browser
            permission behind push. The same panel the manager and the
            administrator see. These are kill switches: the grid below chooses
            a channel per subject, and both have to say yes for anything to be
            delivered. */}
        <NotificationSettings />

        {/*
          ONE ROW PER TOPIC, THREE ANSWERS PER ROW.

          This was one switch per topic, and that switch meant "in the app AND
          by email" — so the only way to stop being emailed about every order
          was to stop being told about your orders. Three separate questions
          are three separate switches.

          Not a <table>: on a phone the three channels sit under the topic name
          as a wrapping row of chips, and a table would either scroll sideways
          or squeeze the labels to nothing. The channel name is repeated on
          every row rather than living in a header, so a row read on its own
          still says which switch is which.
        */}
        <Panel title={t("cst.topics")} description={t("cst.topicsBody")}>
          <ul className="divide-y divide-border">
            {CUSTOMER_TOPICS.map((topic) => (
              <li key={topic.key} className="p-5">
                <p className="text-sm font-medium">
                  {t(`cst.evt.${topic.key}` as TranslationKey)}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-text-light">
                  {t(`cst.evtBody.${topic.key}` as TranslationKey)}
                </p>

                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-3">
                  {NOTIFICATION_CHANNEL_KEYS.map((channel) => {
                    const locked = topic.locked.includes(channel);
                    const Icon = CHANNEL_ICON[channel];
                    return (
                      <Switch
                        key={channel}
                        // The accessible name has to carry BOTH halves: on a
                        // screen reader "Email" alone, six times over, says
                        // nothing about which topic it belongs to.
                        aria-label={`${t(`cst.evt.${topic.key}` as TranslationKey)} — ${t(
                          `cst.ch.${channel}` as TranslationKey,
                        )}`}
                        label={t(`cst.ch.${channel}` as TranslationKey)}
                        checked={prefs[topic.key][channel]}
                        disabled={busy || locked}
                        title={locked ? t("cst.locked") : undefined}
                        onChange={(e) => setChannel(topic.key, channel, e.target.checked)}
                        className="min-w-0 flex-none gap-2"
                      >
                        <Icon className="size-3.5" aria-hidden />
                      </Switch>
                    );
                  })}
                </div>

                {topic.locked.length > 0 && (
                  <p className="mt-2 text-xs text-text-light italic">{t("cst.lockedInApp")}</p>
                )}
              </li>
            ))}
          </ul>
          <div className="border-t border-border p-5">
            <Button disabled={busy} loading={busy} onClick={save}>
              {t("common.save")}
            </Button>
          </div>
        </Panel>

        {/*
          §14.3 + hard rule #7 — deletion ANONYMISES, it does not delete.
          Removing the rows would destroy the restaurant's sales history and
          the platform's commission record. The copy says so plainly rather
          than promising an erasure we will not perform.
        */}
        <Panel title={t("cst.delete")} description={t("cst.deleteBody")}>
          <div className="p-5">
            <div className="flex items-start gap-3 rounded-md border border-error/25 bg-error-light p-4">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-error" aria-hidden />
              <div className="text-sm">
                <p className="font-semibold text-error">{t("cst.deleteWhat")}</p>
                <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 text-text-secondary">
                  <li>{t("cst.deletePoint1")}</li>
                  <li>{t("cst.deletePoint2")}</li>
                  <li>{t("cst.deletePoint3")}</li>
                </ul>
              </div>
            </div>

            <Button
              variant="danger"
              className="mt-5"
              disabled={busy}
              onClick={() => setDeleteOpen(true)}
            >
              {t("cst.delete")}
            </Button>
          </div>
        </Panel>
      </div>

      <TypedConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={confirmDelete}
        title={t("cst.deleteTitle")}
        message={t("cst.deleteMessage")}
        phrase={t("cst.deletePhrase")}
        confirmLabel={t("cst.delete")}
        hint={t("cst.deleteHint")}
      />
    </AccountShell>
  );
}
