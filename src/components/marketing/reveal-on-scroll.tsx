"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Fades each `.reveal` section in as it scrolls into view — in every browser.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY THIS REPLACED THE SCROLL-DRIVEN CSS VERSION.
 *
 *  The reveal used `animation-timeline: view()`: no JavaScript at all, but it
 *  ran only in Chromium, and its 18 px lift was subtle enough that people
 *  asked for a fade-in the page already "had". An IntersectionObserver is not
 *  a scroll handler — the browser reports crossings off the hot path, and
 *  each section is unobserved the moment it has arrived — so it costs next
 *  to nothing on the phones this runs on, and it works on all of them.
 *
 *  Nothing is hidden until this has run: the CSS only hides `.reveal` under
 *  `html[data-reveal="on"]`, which is set here. A script that never loads
 *  leaves the page exactly as it would be without any reveal, never blank.
 *  Visitors who asked for reduced motion are skipped entirely.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function RevealOnScroll() {
  const pathname = usePathname();

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;

    const root = document.documentElement;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      },
      // Threshold 0 with a bottom inset rather than a percentage of the
      // section: a tall section could otherwise never reach the threshold.
      { rootMargin: "0px 0px -12% 0px", threshold: 0 },
    );

    for (const element of document.querySelectorAll(".reveal:not(.is-visible)")) observer.observe(element);
    root.dataset.reveal = "on";

    return () => {
      observer.disconnect();
      delete root.dataset.reveal;
    };
  }, [pathname]);

  return null;
}
