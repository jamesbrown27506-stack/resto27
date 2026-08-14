"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
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
import type { CustomerPreferences } from "@/lib/data/customer";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import type { SessionUser } from "@/lib/session";

/**
 * KEYS, NOT SENTENCES.
 *
 * This list used to carry its French label and description inline, which is
 * why the whole screen stayed French whatever the toggle said. `key` doubles
 * as the dictionary suffix (`cst.evt.<key>` / `cst.evtBody.<key>`), so a new
 * topic cannot be added without both translations existing.
 */
const NOTIFICATIONS: { key: keyof CustomerPreferences; locked: boolean }[] = [
  // Locked: it is the order itself, not marketing.
  { key: "orderStatus", locked: true },
  { key: "reservations", locked: false },
  { key: "loyalty", locked: false },
  { key: "promotions", locked: false },
];

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
    const result = await saveOwnPreferences({
      ...prefs,
      orderStatus: true,
    });
    setBusy(false);
    if (result.ok) toast(t("cst.saved"), "success");
    else toast(result.error, "error");
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

        {/* The three channels — in-app, email, push — and the browser
            permission behind push. The same panel the manager and the
            administrator see; the switches below decide WHICH events, this
            one decides how they reach you at all. */}
        <NotificationSettings />

        <Panel title={t("cst.topics")} description={t("cst.topicsBody")}>
          <div className="flex flex-col gap-5 p-5">
            {NOTIFICATIONS.map((n) => {
              const body = t(`cst.evtBody.${n.key}` as TranslationKey);
              return (
                <Switch
                  key={n.key}
                  label={t(`cst.evt.${n.key}` as TranslationKey)}
                  description={n.locked ? `${body} ${t("cst.locked")}` : body}
                  checked={prefs[n.key]}
                  disabled={n.locked}
                  onChange={(e) => setPrefs({ ...prefs, [n.key]: e.target.checked })}
                />
              );
            })}
          </div>
          <div className="border-t border-border p-5">
            <Button disabled={busy} onClick={save}>
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
