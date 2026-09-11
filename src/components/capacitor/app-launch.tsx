"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { App } from "@capacitor/app";
import { SplashScreen } from "@capacitor/splash-screen";
import { BellRing, Soup } from "lucide-react";
import { isNativeApp } from "@/lib/capacitor/platform";
import { hasOnboarded, markOnboarded, rememberAppLocale, savedAppLocale } from "@/lib/capacitor/app-prefs";
import { launchLocaleHref, localeFromTag, splashIsHeld } from "@/lib/capacitor/app-launch-rules";
import { useLocale } from "@/lib/i18n/use-locale";
import { LOCALES, LOCALE_SHORT, type Locale } from "@/lib/i18n/dictionaries";
import { cn } from "@/lib/utils";

/**
 * The installed app's opening — the welcome the first time, the animated mark
 * every time after.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  HOW IT HANDS OVER FROM ANDROID'S OWN LAUNCH SCREEN.
 *
 *  Android draws the launch screen natively (white by day, Resto237 green at
 *  night — res/values(-night)/colors.xml) and the splash plugin holds it
 *  until something calls hide(). This component is that something: it paints
 *  the same ground and the same mark, then takes the native screen down, so
 *  the hand-over cannot be seen — and the mark starts moving only once it is
 *  the one on screen. Before this, the native screen hid on a fixed timer and
 *  whatever the page had (or had not yet) drawn showed through.
 *
 *  It also settles the app's LANGUAGE before anything is shown: the phone's
 *  on the very first launch, the person's own choice after that. Public pages
 *  take their language from the URL, so this may reload once into ?lang=en,
 *  still behind the native screen.
 *
 *  Once per WebView session (sessionStorage), so navigating or reloading does
 *  not replay it. Nothing at all outside the installed app.
 * ─────────────────────────────────────────────────────────────────────────
 */

const LAUNCHED_KEY = "resto237:launched";
/** How long the mark plays before the site is revealed. */
const MARK_MS = 1300;
const FADE_MS = 320;

type Phase = "idle" | "showing" | "leaving";
type Mode = "mark" | "welcome";

function alreadyLaunched(): boolean {
  try {
    return sessionStorage.getItem(LAUNCHED_KEY) === "1";
  } catch {
    return false;
  }
}

function hideSplash() {
  void SplashScreen.hide({ fadeOutDuration: 150 }).catch(() => undefined);
}

export function AppLaunch({ brandName }: { brandName: string }) {
  const router = useRouter();
  const { locale, setLocale } = useLocale();
  const [phase, setPhase] = useState<Phase>("idle");
  const [mode, setMode] = useState<Mode>("mark");
  const [dark, setDark] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (!isNativeApp() || started.current) return;
    started.current = true;
    if (alreadyLaunched()) {
      hideSplash();
      return;
    }

    void (async () => {
      const [onboarded, saved, info] = await Promise.all([
        hasOnboarded(),
        savedAppLocale(),
        App.getInfo().catch(() => null),
      ]);
      const target = saved ?? localeFromTag(navigator.language);
      if (!saved) await rememberAppLocale(target);

      if (target !== locale) {
        setLocale(target);
        const href = launchLocaleHref(window.location.pathname + window.location.search + window.location.hash, target);
        if (href) {
          window.location.replace(href);
          return;
        }
        router.refresh();
      }

      // Builds before 1.3 hid Android's launch screen on a timer, so the page
      // is already showing: the mark would only cover it and hand it back.
      // They still get the welcome — it is content, not a transition.
      if (onboarded && !splashIsHeld(info?.build)) {
        try {
          sessionStorage.setItem(LAUNCHED_KEY, "1");
        } catch {
          // Storage unavailable — this check simply runs again next load.
        }
        hideSplash();
        return;
      }

      setDark(document.documentElement.getAttribute("data-theme") === "dark");
      setMode(onboarded ? "mark" : "welcome");
      setPhase("showing");
    })().catch((error) => {
      console.error("[capacitor] launch screen failed", error);
      hideSplash();
    });
  }, [locale, router, setLocale]);

  // On screen: the native launch screen underneath looks the same, take it down.
  useEffect(() => {
    if (phase !== "showing") return;
    hideSplash();
    if (mode !== "mark") return;
    const timer = setTimeout(() => setPhase("leaving"), MARK_MS);
    return () => clearTimeout(timer);
  }, [phase, mode]);

  useEffect(() => {
    if (phase !== "leaving") return;
    const timer = setTimeout(() => {
      try {
        sessionStorage.setItem(LAUNCHED_KEY, "1");
      } catch {
        // Storage unavailable — the mark simply plays again on the next load.
      }
      setPhase("idle");
    }, FADE_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  function finishWelcome() {
    void markOnboarded().catch(() => undefined);
    setPhase("leaving");
  }

  if (phase === "idle") return null;

  return (
    <div
      className={cn(
        "fixed inset-0 z-[300] flex flex-col transition-opacity ease-out",
        dark ? "bg-[#263622] text-[#f7f4ed]" : "bg-white text-[#1c1c1c]",
        phase === "leaving" ? "pointer-events-none opacity-0" : "opacity-100",
      )}
      style={{
        transitionDuration: `${FADE_MS}ms`,
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {mode === "welcome" ? (
        <Welcome brandName={brandName} dark={dark} onDone={finishWelcome} />
      ) : (
        <AnimatedMark brandName={brandName} dark={dark} />
      )}
    </div>
  );
}

/** The app icon — the mark on its white disc — landing like a pin on a map. */
function AnimatedMark({ brandName, dark }: { brandName: string; dark: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4" aria-hidden>
      <div className="flex flex-col items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/app-icon-192.png" alt="" width={160} height={160} className="size-40 rounded-full motion-safe:animate-launch-drop" />
        <span className={cn("h-2 w-20 rounded-full motion-safe:animate-launch-shadow", dark ? "bg-black/30" : "bg-black/10")} />
      </div>
      <span className="font-display text-2xl font-bold motion-safe:animate-launch-word">{brandName}</span>
    </div>
  );
}

/** Three swipeable slides, the first time the app opens — never again. */
function Welcome({ brandName, dark, onDone }: { brandName: string; dark: boolean; onDone: () => void }) {
  const { t, locale, setLocale } = useLocale();
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  const circle = cn("grid size-32 place-items-center rounded-full", dark ? "bg-white/10 text-[#d8ae7e]" : "bg-primary-light text-primary");
  const slides = [
    {
      key: "welcome",
      // eslint-disable-next-line @next/next/no-img-element
      visual: <img src="/app-icon-192.png" alt="" width={128} height={128} className="size-32 rounded-full shadow-lg" />,
      title: t("applaunch.welcomeTitle", { name: brandName }),
      body: t("applaunch.welcomeBody"),
    },
    {
      key: "compare",
      visual: <span className={circle}><Soup className="size-14" aria-hidden /></span>,
      title: t("applaunch.compareTitle"),
      body: t("applaunch.compareBody"),
    },
    {
      key: "track",
      visual: <span className={circle}><BellRing className="size-14" aria-hidden /></span>,
      title: t("applaunch.trackTitle"),
      body: t("applaunch.trackBody"),
    },
  ];
  const last = index === slides.length - 1;

  function goTo(next: number) {
    const element = track.current;
    if (element) element.scrollTo({ left: next * element.clientWidth, behavior: "smooth" });
  }

  function onScroll() {
    const element = track.current;
    if (element && element.clientWidth > 0) setIndex(Math.round(element.scrollLeft / element.clientWidth));
  }

  function switchLanguage(next: Locale) {
    if (next === locale) return;
    setLocale(next);
    const href = launchLocaleHref(window.location.pathname + window.location.search + window.location.hash, next);
    if (href) window.location.replace(href);
  }

  const solid = dark ? "bg-[#f7f4ed] text-[#263622]" : "bg-primary text-primary-fg";

  return (
    <div role="dialog" aria-modal="true" aria-label={t("applaunch.welcomeTitle", { name: brandName })} className="flex flex-1 flex-col">
      <div className="flex items-center justify-between px-5 pt-4">
        <div
          role="radiogroup"
          aria-label={t("applaunch.language")}
          className={cn("flex gap-1 rounded-full p-1 ring-1", dark ? "ring-[#f7f4ed]/25" : "ring-[#e4ddd0]")}
        >
          {LOCALES.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={value === locale}
              onClick={() => switchLanguage(value)}
              className={cn("rounded-full px-3 py-1 text-xs font-bold", value === locale ? solid : "opacity-70")}
            >
              {LOCALE_SHORT[value]}
            </button>
          ))}
        </div>
        <button type="button" onClick={onDone} className="rounded-full px-3 py-1.5 text-sm font-semibold opacity-75 hover:opacity-100">
          {t("applaunch.skip")}
        </button>
      </div>

      <div ref={track} onScroll={onScroll} className="no-scrollbar flex flex-1 snap-x snap-mandatory overflow-x-auto">
        {slides.map((slide) => (
          <section key={slide.key} className="flex w-full shrink-0 snap-center flex-col items-center justify-center gap-6 px-8 text-center">
            {slide.visual}
            <h2 className="max-w-xs font-display text-3xl font-bold">{slide.title}</h2>
            <p className={cn("max-w-xs text-base leading-relaxed", dark ? "text-[#f7f4ed]/75" : "text-[#5a5a52]")}>{slide.body}</p>
          </section>
        ))}
      </div>

      <div className="flex flex-col items-center gap-5 px-6 pb-6">
        <div className="flex gap-2" aria-hidden>
          {slides.map((slide, i) => (
            <span
              key={slide.key}
              className={cn(
                "h-2 rounded-full transition-all",
                i === index ? cn("w-6", dark ? "bg-[#f7f4ed]" : "bg-primary") : cn("w-2", dark ? "bg-[#f7f4ed]/30" : "bg-[#d5cbb8]"),
              )}
            />
          ))}
        </div>
        <button type="button" onClick={() => (last ? onDone() : goTo(index + 1))} className={cn("w-full max-w-sm rounded-full py-3.5 text-base font-semibold", solid)}>
          {last ? t("applaunch.start") : t("applaunch.next")}
        </button>
      </div>
    </div>
  );
}
