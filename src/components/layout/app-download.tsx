"use client";

import Image from "next/image";
import { useState } from "react";
import { Apple } from "lucide-react";
import { useNativeApp } from "@/lib/capacitor/platform";
import { useLocale } from "@/lib/i18n/use-locale";
import release from "@/lib/app-release.json";

/**
 * "Download our app" — the band above the footer and the links inside it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  ANDROID AND IPHONE ARE NOT OFFERED THE SAME THING, ON PURPOSE.
 *
 *  Android installs the signed APK straight from this site; `npm run
 *  mobile:apk` builds it and writes the version and size read below.
 *  iOS has no equivalent: apps install only through the App Store or
 *  TestFlight. Until the app is listed, the iPhone button explains the Home
 *  Screen install instead, which is this same site full screen, with push.
 *
 *  Both disappear inside the native app, where "download our app" is nonsense.
 *  Panels toggle with `hidden` rather than mounting, for the same browser
 *  auto-translation reason spelled out in components/ui/button.tsx.
 * ─────────────────────────────────────────────────────────────────────────
 */

const android = release.android;
// Changes with every release so no cache anywhere keeps serving an older build.
const apkHref = `${android.url}?v=${android.versionCode}`;

const STORE_BUTTON =
  "soft-press inline-flex min-h-14 items-center gap-3 rounded-xl bg-text px-5 py-2 text-left text-surface transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

const FOOTER_PILL =
  "inline-flex min-h-10 items-center gap-2 rounded-full bg-brand-on-solid/10 px-4 text-sm font-semibold text-brand-on-solid transition-colors hover:bg-accent hover:text-accent-fg";

/** The Android robot's head, the platform mark Google licenses for this use. */
function AndroidGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
      <path
        fillRule="evenodd"
        d="M3 18a9 9 0 0 1 18 0H3Zm5.5-4.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm7 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"
      />
      <path d="M7.2 10.6 5.3 7.4M16.8 10.6l1.9-3.2" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}

function StoreLabel({ kicker, name }: { kicker: string; name: string }) {
  return (
    <span className="flex flex-col leading-tight">
      <span className="text-[11px] opacity-75">{kicker}</span>
      <span className="text-base font-semibold">{name}</span>
    </span>
  );
}

export function AppDownloadBand({ brandName }: { brandName: string }) {
  const { t, locale } = useLocale();
  const native = useNativeApp();
  const [iosOpen, setIosOpen] = useState(false);
  if (native) return null;

  const size = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(android.sizeBytes / 1_048_576);

  return (
    <section aria-labelledby="app-download-title" className="container-page py-12 sm:py-16">
      <div className="relative overflow-hidden rounded-xl border border-border bg-surface-2 px-6 py-10 sm:px-10 lg:flex lg:items-center lg:justify-between lg:gap-14 lg:py-12">
        <div aria-hidden className="absolute -top-24 -right-20 size-80 rounded-full bg-primary/10 blur-3xl" />

        <div className="relative max-w-xl">
          <p className="text-[11px] font-bold tracking-[0.12em] text-primary uppercase">{t("appdl.tag")}</p>
          <h2 id="app-download-title" className="mt-2 font-display text-3xl font-bold sm:text-4xl">
            {t("appdl.title", { name: brandName })}
          </h2>
          <p className="mt-3 text-text-secondary">{t("appdl.body")}</p>

          <div className="mt-7 flex flex-wrap gap-3">
            <a href={apkHref} download="Resto237.apk" className={STORE_BUTTON}>
              <AndroidGlyph className="size-7 shrink-0" />
              <StoreLabel kicker={t("appdl.android.kicker")} name="Android" />
            </a>
            <button
              type="button"
              aria-expanded={iosOpen}
              aria-controls="app-download-ios"
              onClick={() => setIosOpen((open) => !open)}
              className={STORE_BUTTON}
            >
              <Apple className="size-7 shrink-0" aria-hidden />
              <StoreLabel kicker={t("appdl.ios.kicker")} name="iPhone" />
            </button>
          </div>

          <div id="app-download-ios" hidden={!iosOpen} className="mt-4 rounded-lg border border-border bg-surface p-4 text-sm">
            <p className="font-semibold">{t("appdl.ios.title")}</p>
            <p className="mt-1 text-text-secondary">{t("appdl.ios.body")}</p>
          </div>

          <p className="mt-4 text-xs text-text-light">
            {t("appdl.android.meta", { version: android.versionName, size })}
          </p>
          <p className="mt-1 text-xs text-text-light">{t("appdl.android.hint")}</p>
        </div>

        <div aria-hidden className="relative mx-auto mt-10 hidden w-44 shrink-0 sm:block lg:mx-0 lg:mt-0">
          <div className="rounded-[2.25rem] border-[6px] border-text/85 bg-surface p-3 shadow-xl">
            <div className="mx-auto h-1.5 w-12 rounded-full bg-text/15" />
            <div className="flex h-64 flex-col items-center justify-center gap-3">
              <Image src="/app-icon-192.png" alt="" width={76} height={76} className="rounded-2xl shadow-md" />
              <span className="font-display text-lg font-bold">{brandName}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function AppDownloadFooterLinks() {
  const { t } = useLocale();
  const native = useNativeApp();
  const [iosOpen, setIosOpen] = useState(false);
  if (native) return null;

  return (
    <div className="mt-6">
      <p className="font-sans text-[11px] font-bold tracking-[0.12em] text-brand-on-solid/45 uppercase">
        {t("appdl.footer")}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <a href={apkHref} download="Resto237.apk" className={FOOTER_PILL}>
          <AndroidGlyph className="size-4.5" />
          Android
        </a>
        <button
          type="button"
          aria-expanded={iosOpen}
          aria-controls="footer-app-ios"
          onClick={() => setIosOpen((open) => !open)}
          className={FOOTER_PILL}
        >
          <Apple className="size-4" aria-hidden />
          iPhone
        </button>
      </div>
      <p id="footer-app-ios" hidden={!iosOpen} className="mt-3 max-w-xs text-xs leading-relaxed text-brand-on-solid/65">
        {t("appdl.ios.body")}
      </p>
    </div>
  );
}
