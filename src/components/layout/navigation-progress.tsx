"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * A top progress bar that appears the moment a navigation starts.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY THIS EXISTS.
 *
 *  Tapping a restaurant card produced no response at all until the next
 *  screen was ready. On a good connection that is a few hundred milliseconds
 *  and nobody notices. On the connections this platform actually runs on it
 *  is seconds of a page that looks like it ignored the tap — so people tap
 *  again, and again.
 *
 *  WHY A DOCUMENT-LEVEL LISTENER RATHER THAN `useLinkStatus`.
 *
 *  `useLinkStatus` is the precise tool, but it only reports for the <Link>
 *  it is rendered inside. Fifty-one files in this app import `next/link`
 *  directly, so using it would mean editing every one of them and would still
 *  miss plain <a> elements. One capture-phase listener covers every link in
 *  the app, including ones added later, from a single mount point.
 *
 *  WHY THE BAR IS DERIVED AND NOT RESET IN AN EFFECT.
 *
 *  The obvious shape — an effect on `pathname` that switches the bar off — is
 *  an unconditional setState in an effect body, which cascades a second render
 *  on every navigation in the app. Instead the arrival is DERIVED: the click
 *  records the path it left from, and the bar is on only while that is still
 *  the current path. When the route changes, the same render that shows the
 *  new page also hides the bar.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** Long enough that an instant, prefetched navigation never flashes the bar. */
const SHOW_AFTER_MS = 140;

/**
 * A click that does not navigate must not leave the bar running forever.
 * Nothing here takes eight seconds to route; if it has, the bar is lying.
 */
const SAFETY_TIMEOUT_MS = 8000;

export function NavigationProgress() {
  const pathname = usePathname();
  const [shown, setShown] = useState(false);
  const [leftFrom, setLeftFrom] = useState<string | null>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const safetyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /*
    Derived, not stored: once the path differs from the one the tap left, the
    destination has rendered and there is nothing left to wait for.
  */
  const active = shown && leftFrom !== null && leftFrom === pathname;

  useEffect(() => {
    function clearTimers() {
      if (showTimer.current) clearTimeout(showTimer.current);
      if (safetyTimer.current) clearTimeout(safetyTimer.current);
      showTimer.current = null;
      safetyTimer.current = null;
    }

    function onClick(event: MouseEvent) {
      // Anything but a plain left click is the browser's business: a cmd-click
      // opens a tab and never navigates this document.
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = (event.target as Element | null)?.closest?.("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      // Downloads, new tabs, mailto:, tel: — none replace this page.
      if (anchor.hasAttribute("download")) return;
      if (anchor.target && anchor.target !== "_self") return;

      let destination: URL;
      try {
        destination = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (destination.origin !== window.location.origin) return;

      // Same page, different anchor — no navigation to wait for.
      if (
        destination.pathname === window.location.pathname &&
        destination.search === window.location.search
      ) {
        return;
      }

      clearTimers();
      setLeftFrom(window.location.pathname);
      setShown(false);
      showTimer.current = setTimeout(() => setShown(true), SHOW_AFTER_MS);
      safetyTimer.current = setTimeout(() => setShown(false), SAFETY_TIMEOUT_MS);
    }

    // Capture phase: a handler that stops propagation on its own click should
    // not also suppress the feedback the tap earned.
    document.addEventListener("click", onClick, { capture: true });
    return () => {
      document.removeEventListener("click", onClick, { capture: true });
      clearTimers();
    };
  }, []);

  return (
    <div
      aria-hidden
      // Not a live region: this is reassurance that the tap landed, and the
      // screen reader already announces the new page when it arrives.
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5"
    >
      <div
        className={
          "h-full bg-accent transition-opacity duration-150 " +
          (active ? "animate-nav-progress opacity-100" : "w-0 opacity-0")
        }
      />
    </div>
  );
}
