"use client";

import { useEffect } from "react";

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
 *  A SECTION IS HIDDEN ONLY ONCE THIS HAS ARMED IT (`.reveal-armed`), never
 *  by a page-wide switch. The first version hid every `.reveal` as soon as a
 *  flag on <html> was set — but this component lives in the layout, which
 *  renders while the page is still behind its loading screen. It looked for
 *  sections before they existed, and the ones that streamed in afterwards
 *  were hidden and never observed: the whole homepage below the fold went
 *  blank. Now a section this never reaches simply stays visible, and a
 *  MutationObserver arms the ones that arrive later.
 *
 *  Visitors who asked for reduced motion are skipped entirely.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function RevealOnScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;

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

    const arm = (element: Element) => {
      if (element.classList.contains("reveal-armed")) return;
      element.classList.add("reveal-armed");
      observer.observe(element);
    };
    const armWithin = (node: Node) => {
      if (!(node instanceof Element)) return;
      if (node.matches(".reveal")) arm(node);
      node.querySelectorAll(".reveal").forEach(arm);
    };

    armWithin(document.body);
    // Sections that stream in after the loading screen, or arrive with the
    // next page of a client-side navigation.
    const mutations = new MutationObserver((records) => {
      for (const record of records) record.addedNodes.forEach(armWithin);
    });
    mutations.observe(document.body, { childList: true, subtree: true });

    return () => {
      mutations.disconnect();
      observer.disconnect();
    };
  }, []);

  return null;
}
