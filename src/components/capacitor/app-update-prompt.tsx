"use client";

import { useEffect, useRef, useState } from "react";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import type { PluginListenerHandle } from "@capacitor/core";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BannerCard } from "@/components/notifications/pwa-prompts";
import { useLocale } from "@/lib/i18n/use-locale";
import { isNativeApp } from "@/lib/capacitor/platform";
import { isOutdated } from "@/lib/capacitor/app-launch-rules";
import { AppUpdater, inAppUpdateAvailable } from "@/lib/capacitor/app-updater";
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
 * ─────────────────────────────────────────────────────────────────────────
 *  FROM 1.4 THE UPDATE INSTALLS FROM INSIDE THE APP.
 *
 *  Sending people to the browser went wrong in a very ordinary way: every
 *  download was named Resto237.apk, Chrome kept them all as "Resto237 (1)",
 *  "(2)"… and the one opened was an old one. The native AppUpdater now
 *  downloads the file into the app's own storage with a progress bar and
 *  opens Android's "Update this app?" screen itself. The first time, Android
 *  sends the person to "Allow from this source"; the install resumes by
 *  itself when they come back. Builds older than 1.4 have no updater and
 *  still get the browser download, now under a versioned file name.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * OPTIONAL BY DEFAULT: "Plus tard" hides it until the next launch. The admin
 * switch "Require the latest app version" (/a/settings → Mobile app) turns it
 * into a screen that cannot be dismissed — for an update that fixes something
 * broken, not for every release.
 */
const LATER_KEY = "resto237:update-later";
const android = release.android;
const APK_URL = `${PUBLIC_SITE_URL}${android.url}`;
const FILE_NAME = android.url.split("/").pop() ?? "resto237.apk";

type Step =
  | { kind: "offer" }
  | { kind: "downloading"; percent: number }
  | { kind: "permission" }
  | { kind: "failed" };

export function AppUpdatePrompt({ required }: { required: boolean }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>({ kind: "offer" });
  const progressListener = useRef<PluginListenerHandle | null>(null);

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

  // Waiting on "Allow from this source": Android brings the person back to
  // the app, and the install picks up from there without another tap.
  useEffect(() => {
    if (step.kind !== "permission") return;
    let cancelled = false;
    let handle: PluginListenerHandle | undefined;
    void App.addListener("resume", () => {
      AppUpdater.install({ fileName: FILE_NAME })
        .then((result) => {
          if (!cancelled && result.status === "installer-opened") setStep({ kind: "offer" });
        })
        .catch(() => {
          if (!cancelled) setStep({ kind: "failed" });
        });
    }).then((registered) => {
      if (cancelled) void registered.remove();
      else handle = registered;
    });
    return () => {
      cancelled = true;
      void handle?.remove();
    };
  }, [step.kind]);

  useEffect(() => () => void progressListener.current?.remove(), []);

  async function install() {
    const result = await AppUpdater.install({ fileName: FILE_NAME });
    setStep(result.status === "needs-permission" ? { kind: "permission" } : { kind: "offer" });
  }

  async function update() {
    if (!inAppUpdateAvailable()) {
      void Browser.open({ url: APK_URL }).catch(() => undefined);
      return;
    }
    setStep({ kind: "downloading", percent: 0 });
    try {
      progressListener.current = await AppUpdater.addListener("progress", ({ percent }) =>
        setStep({ kind: "downloading", percent }),
      );
      await AppUpdater.download({ url: APK_URL, fileName: FILE_NAME });
      void progressListener.current.remove();
      progressListener.current = null;
      await install();
    } catch (error) {
      console.error("[capacitor] in-app update failed", error);
      setStep({ kind: "failed" });
    }
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

  const busy = step.kind === "downloading";
  const message =
    step.kind === "downloading"
      ? t("appupd.downloading", { percent: step.percent })
      : step.kind === "permission"
        ? t("appupd.permission")
        : step.kind === "failed"
          ? t("appupd.failed")
          : t("appupd.body", { version: android.versionName });

  const details = (
    <>
      <p className="text-sm leading-relaxed text-text-secondary">
        <span>{message}</span>
      </p>
      {busy && (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={step.percent}
          className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2"
        >
          <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${step.percent}%` }} />
        </div>
      )}
    </>
  );

  const action =
    step.kind === "permission" ? (
      <Button size="sm" onClick={() => void install().catch(() => setStep({ kind: "failed" }))}>
        <span>{t("appupd.retry")}</span>
      </Button>
    ) : (
      <Button size="sm" loading={busy} disabled={busy} onClick={() => void update()}>
        <Download className="size-4" aria-hidden />
        <span>{step.kind === "failed" ? t("appupd.retry") : t("appupd.action")}</span>
      </Button>
    );

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
          <div className="mt-2">{details}</div>
          {step.kind === "offer" && <p className="mt-2 text-sm font-semibold">{t("appupd.required")}</p>}
          <div className="mt-5 flex justify-center">{action}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-[250] flex flex-col items-center p-3 sm:p-4 lg:bottom-0">
      <BannerCard icon={<Download className="size-4.5" aria-hidden />} title={t("appupd.title")} onClose={later} closeLabel={t("pwa.dismiss")}>
        <div className="mt-0.5">{details}</div>
        <div className="mt-3 flex flex-wrap gap-2">
          {action}
          {!busy && (
            <Button size="sm" variant="outline" onClick={later}>
              <span>{t("appupd.later")}</span>
            </Button>
          )}
        </div>
      </BannerCard>
    </div>
  );
}
