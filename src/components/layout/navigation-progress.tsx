"use client";

import { LoaderCircle } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/i18n/use-locale";

const SHOW_AFTER_MS = 140;
/** A route still loading after this point needs a clear acknowledgement. */
const SLOW_CONNECTION_AFTER_MS = 5_000;

export function NavigationProgress() {
  const pathname = usePathname();
  const { t } = useLocale();
  const [shown, setShown] = useState(false);
  const [slowShown, setSlowShown] = useState(false);
  const [leftFrom, setLeftFrom] = useState<string | null>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /*
    A completed route renders a new pathname. Deriving both indicators from it
    prevents a timer that fires just after arrival from covering the new page.
  */
  const active = shown && leftFrom !== null && leftFrom === pathname;
  const slow = slowShown && leftFrom !== null && leftFrom === pathname;

  useEffect(() => {
    function clearTimers() {
      if (showTimer.current) clearTimeout(showTimer.current);
      if (slowTimer.current) clearTimeout(slowTimer.current);
      showTimer.current = null;
      slowTimer.current = null;
    }

    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = (event.target as Element | null)?.closest?.("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || anchor.hasAttribute("download")) return;
      if (anchor.target && anchor.target !== "_self") return;

      let destination: URL;
      try {
        destination = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (destination.origin !== window.location.origin) return;
      if (
        destination.pathname === window.location.pathname &&
        destination.search === window.location.search
      ) {
        return;
      }

      const origin = window.location.pathname;
      clearTimers();
      setLeftFrom(origin);
      setShown(false);
      setSlowShown(false);
      showTimer.current = setTimeout(() => setShown(true), SHOW_AFTER_MS);
      slowTimer.current = setTimeout(() => {
        if (window.location.pathname === origin) setSlowShown(true);
      }, SLOW_CONNECTION_AFTER_MS);
    }

    document.addEventListener("click", onClick, { capture: true });
    return () => {
      document.removeEventListener("click", onClick, { capture: true });
      clearTimers();
    };
  }, []);

  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5"
      >
        <div
          className={
            "h-full bg-accent transition-opacity duration-150 " +
            (active ? "animate-nav-progress opacity-100" : "w-0 opacity-0")
          }
        />
      </div>

      {slow && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed inset-0 z-[101] grid place-items-center bg-black/20 p-4 backdrop-blur-[1px]"
        >
          <div className="flex max-w-sm items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-left shadow-lg">
            <LoaderCircle className="size-5 shrink-0 animate-spin text-primary" aria-hidden />
            <div>
              <p className="text-sm font-bold">{t("common.slowConnectionTitle")}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-text-secondary">
                {t("common.slowConnectionBody")}
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}