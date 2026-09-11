"use client";

import { useEffect, useState } from "react";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BannerCard } from "@/components/notifications/pwa-prompts";
import { useLocale } from "@/lib/i18n/use-locale";
import { isNativeApp } from "@/lib/capacitor/platform";
import { isOutdated } from "@/lib/capacitor/app-launch-rules";
import { PUBLIC_SITE_URL } from "@/lib/seo-config";
import release from "@/lib/app-release.json";

/**
 * "A new version is available" — inside the installed app only.
 *
 * The app compares its own versionCode with the APK the site publishes
 * (lib/app-release.json, written by `npm run mobile:apk`). Because this is
 * website code, every installed version sees it the moment a new APK is
 * deployed — including versions released before this prompt existed.
 *
 * OPTIONAL BY DEFAULT: "Plus tard" hides it until the next launch. The admin
 * switch "Require the latest app version" (/a/settings → Mobile app) turns it
 * into a screen that cannot be dismissed — for an update that fixes something
 * broken, not for every release. A sideloaded app cannot update itself: the
 * button downloads the new APK, and Android installs it over this one.
 */
const LATER_KEY = "resto237:update-later";
const android = release.android;

export function AppUpdatePrompt({ required }: { required: boolean }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!isNativeApp()) return;
    let cancelled = false;
    App.getInfo()
      .then((info) => {
        if (cancelled || !isOutdated(info.build, android.versionCode)) return;
        let postponed = false;
        try {
          postponed = sessionStorage.getItem(LATER_KEY) === String(android.versionCode);
        } catch {
          // Storage unavailable — ask again, which is the safe side.
        }
        if (required || !postponed) setOpen(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [required]);

  function update() {
    void Browser.open({ url: `${PUBLIC_SITE_URL}${android.url}?v=${android.versionCode}` }).catch(() => undefined);
  }

  function later() {
    try {
      sessionStorage.setItem(LATER_KEY, String(android.versionCode));
    } catch {
      // Storage unavailable — it returns on the next page, still dismissible.
    }
    setOpen(false);
  }

  if (!open) return null;
  const body = t("appupd.body", { version: android.versionName });

  if (required) {
    return (
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="app-update-title"
        className="fixed inset-0 z-[250] grid place-items-center bg-bg/95 p-6 backdrop-blur-sm"
      >
        <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 text-center shadow-xl">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-primary-light text-primary">
            <Download className="size-6" aria-hidden />
          </span>
          <h2 id="app-update-title" className="mt-4 font-display text-xl font-bold">{t("appupd.title")}</h2>
          <p className="mt-2 text-sm text-text-secondary">{body}</p>
          <p className="mt-2 text-sm font-semibold">{t("appupd.required")}</p>
          <Button className="mt-5" fullWidth onClick={update}>
            <Download className="size-4" aria-hidden />
            <span>{t("appupd.action")}</span>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-[250] flex flex-col items-center p-3 sm:p-4 lg:bottom-0">
      <BannerCard icon={<Download className="size-4.5" aria-hidden />} title={t("appupd.title")} onClose={later} closeLabel={t("pwa.dismiss")}>
        <p className="mt-0.5 text-xs leading-relaxed text-text-secondary">
          <span>{body}</span>
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={update}>
            <span>{t("appupd.action")}</span>
          </Button>
          <Button size="sm" variant="outline" onClick={later}>
            <span>{t("appupd.later")}</span>
          </Button>
        </div>
      </BannerCard>
    </div>
  );
}
