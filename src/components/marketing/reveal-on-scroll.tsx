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
 *  A SECTION IS HIDDEN ONLY ONCE THIS HAS ARMED IT, never by a page-wide
 *  switch. The first version hid every `.reveal` as soon as a flag on <html>
 *  was set — but this component lives in the layout, which renders while the
 *  page is still behind its loading screen. It looked for sections before
 *  they existed, and the ones that streamed in afterwards were hidden and
 *  never observed: the whole homepage below the fold went blank. Now a
 *  section this never reaches simply stays visible, and a MutationObserver
 *  arms the ones that arrive later.
 *
 *  AND ARMING WRITES NOTHING REACT COMPARES. It used to add `reveal-armed`
 *  and `is-visible` classes — but a section is armed the instant it streams
 *  into the DOM, BEFORE React hydrates it, so React found a className it had
 *  never rendered and logged a hydration mismatch on every homepage load.
 *  The hidden state is now a PAUSED Web Animation held on its first frame:
 *  it paints the section at opacity 0 without touching an attribute, and
 *  playing it is the fade-in. The grids inside (`.stagger-in`) keep their CSS
 *  entrance, paused the same way until their section arrives — it used to
 *  play on page load, far below the fold, and be long over by the time
 *  anyone scrolled down.
 *
 *  Visitors who asked for reduced motion are skipped entirely.
 * ─────────────────────────────────────────────────────────────────────────
 */

const LIFT: Keyframe[] = [
  { opacity: 0, transform: "translateY(28px)" },
  { opacity: 1, transform: "translateY(0)" },
];

const TIMING: KeyframeAnimationOptions = { duration: 700, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" };

export function RevealOnScroll() {
  useEffect(() => {
    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !("IntersectionObserver" in window) ||
      typeof Element.prototype.animate !== "function" ||
      typeof Element.prototype.getAnimations !== "function"
    ) {
      return;
    }

    // Each armed section's held animations: its own fade, then its grids'.
    const waiting = new Map<Element, Animation[]>();
    const armed = new WeakSet<Element>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          waiting.get(entry.target)?.forEach((animation) => animation.play());
          waiting.delete(entry.target);
          observer.unobserve(entry.target);
        }
      },
      // Threshold 0 with a bottom inset rather than a percentage of the
      // section: a tall section could otherwise never reach the threshold.
      { rootMargin: "0px 0px -12% 0px", threshold: 0 },
    );

    const arm = (element: Element) => {
      if (armed.has(element)) return;
      armed.add(element);
      // Read the grids' entrances BEFORE adding the fade, and leave any that
      // already ran alone — playing a finished animation replays it.
      const grids = element.getAnimations({ subtree: true }).filter((a) => a.playState !== "finished");
      const fade = element.animate(LIFT, TIMING);
      fade.pause();
      grids.forEach((animation) => animation.pause());
      waiting.set(element, [fade, ...grids]);
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
      // Nothing may stay parked at opacity 0 once nobody is watching for it.
      waiting.forEach((animations) => animations.forEach((animation) => animation.play()));
    };
  }, []);

  return null;
}
