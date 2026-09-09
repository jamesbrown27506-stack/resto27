"use client";

import { useEffect, useRef, useState } from "react";
import { publicHref } from "@/lib/seo-config";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  CalendarCheck,
  Compass,
  MapPin,
  Search,
  ShoppingBag,
  Users,
} from "lucide-react";
import { useLocale } from "@/lib/i18n/use-locale";
import { cn } from "@/lib/utils";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import type { Appearance } from "@/lib/appearance";
import { allHomeStatsHidden, type HomeStatsVisibility } from "@/lib/home-stats";
import { usePrefersReducedMotion } from "@/lib/hooks/use-prefers-reduced-motion";

/**
 * The hero — full-bleed photography, editorial type, one search pill.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHAT REPLACED THE CAROUSEL, AND WHY.
 *
 *  The previous hero was a split layout: copy and a boxed, labelled search
 *  form on the left, a small clipped photo on the right, and a 5-second
 *  auto-rotation with its whole support apparatus — arrows, dots, a pause
 *  button, a progress bar, reduced-motion handling. All of that chrome was
 *  spent managing motion nobody asked for.
 *
 *  This design puts the FOOD at full bleed and the words on top of it. The
 *  three modes survive as tabs the visitor presses — the photo and copy
 *  change only on intent, so every piece of carousel machinery is simply
 *  gone rather than restyled. The search collapsed from a four-field card
 *  into one pill, because "what do you want to eat, and where are you" is
 *  the entire question the homepage needs to ask.
 *
 *  THE TEXT ON THE PHOTO IS ALWAYS WHITE, IN BOTH THEMES, on a dark scrim.
 *  The photograph carries its own palette; putting token-driven text over an
 *  arbitrary image is how a pale word lands on a pale plate. The scrim is the
 *  contract that keeps contrast honest, and it is theme-independent — which
 *  is why raw white/black classes are correct here and nowhere else.
 * ─────────────────────────────────────────────────────────────────────────
 */

type Mode = "order" | "book" | "explore";

interface Slide {
  mode: Mode;
  tabLabel: TranslationKey;
  TabIcon: typeof ShoppingBag;
  tag: TranslationKey;
  titleLead: TranslationKey;
  titleAccent: TranslationKey;
  subtitle: TranslationKey;
  art: keyof Pick<Appearance, "heroOrder" | "heroBook" | "heroExplore">;
  artAlt: TranslationKey;
}

/**
 * How long each mode holds before the lap moves on.
 *
 * Long enough to read a three-word tag and a headline, short enough that the
 * whole demonstration is over in under fourteen seconds — before a visitor
 * who is scrolling has left, and well before it could become something to
 * wait out.
 */
const DWELL_MS = 4500;

const SLIDES: Slide[] = [
  {
    mode: "order",
    tabLabel: "hero.mode.order",
    TabIcon: ShoppingBag,
    tag: "hero.order.tag",
    titleLead: "hero.order.titleLead",
    titleAccent: "hero.order.titleAccent",
    subtitle: "hero.order.subtitle",
    art: "heroOrder",
    artAlt: "hero.order.alt",
  },
  {
    mode: "book",
    tabLabel: "hero.mode.book",
    TabIcon: CalendarCheck,
    tag: "hero.book.tag",
    titleLead: "hero.book.titleLead",
    titleAccent: "hero.book.titleAccent",
    subtitle: "hero.book.subtitle",
    art: "heroBook",
    artAlt: "hero.book.alt",
  },
  {
    mode: "explore",
    tabLabel: "hero.mode.explore",
    TabIcon: Compass,
    tag: "hero.explore.tag",
    titleLead: "hero.explore.titleLead",
    titleAccent: "hero.explore.titleAccent",
    subtitle: "hero.explore.subtitle",
    art: "heroExplore",
    artAlt: "hero.explore.alt",
  },
];

export function Hero({
  quartiers,
  statsVisible,
  appearance,
}: {
  quartiers: string[];
  /** Which figures may be shown. Same four switches as the strip below. */
  statsVisible: HomeStatsVisibility;
  appearance: Appearance;
}) {
  const router = useRouter();
  const { t, locale } = useLocale();

  const [index, setIndex] = useState(0);
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("");
  const [guests, setGuests] = useState("2");
  const [date, setDate] = useState("");
  const slide = SLIDES[index];

  /*
    ──────────────────────────────────────────────────────────────────────
     ONE LAP, THEN IT STOPS FOR GOOD.

     A carousel used to live here and was removed on purpose — see the note
     at the top of this file. This is not that. The objection to the old one
     was motion that never ended and had to be managed: arrows, dots, a pause
     button, a progress bar, all of it chrome spent fighting an animation
     nobody asked for.

     This runs the three modes once — order, book, explore, back to order —
     and then never moves again. It exists to answer "what is this site for"
     for a first-time visitor who would otherwise never learn that the hero
     has two other modes behind it. Ending on `order` is deliberate: the lap
     is a demonstration, and it puts the primary action back before it stops.

     It yields to intent immediately. Any pointer, touch, key or focus inside
     the hero cancels the rest of the lap — a visitor who has started reading
     or reaching for a tab has told us what they want, and moving the page
     under them at that moment is the actual sin the old carousel committed.

     `prefers-reduced-motion` skips the whole thing: the tabs still work, the
     hero simply never moves on its own.
    ──────────────────────────────────────────────────────────────────────
  */
  const reducedMotion = usePrefersReducedMotion();
  const heroRef = useRef<HTMLElement>(null);
  const rotationDone = useRef(false);
  /** Which photographs have actually painted — see the <Image> block below. */
  const [loaded, setLoaded] = useState<Set<Mode>>(new Set());
  const allLoaded = SLIDES.every(s2 => loaded.has(s2.mode));

  useEffect(() => {
    if (reducedMotion || rotationDone.current || !allLoaded) return;

    const hero = heroRef.current;
    let step = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function stop() {
      rotationDone.current = true;
      if (timer) clearTimeout(timer);
      timer = null;
    }

    function tick() {
      step += 1;
      // 1, 2, then 0 — three moves, ending where it began.
      setIndex(step % SLIDES.length);
      if (step >= SLIDES.length) {
        stop();
        return;
      }
      timer = setTimeout(tick, DWELL_MS);
    }

    /*
      The lap only starts once all three photographs have painted, which the
      <Image> block below reports through `loaded`. Advancing onto a frame
      that has not arrived would show the bare scrim, which is worse than not
      moving at all.

      This reads the real thing: `onLoad` fires for the exact optimised file
      next/image requested. An earlier version preloaded the raw URLs instead
      and waited on downloads that were never going to be displayed — so on a
      slow connection the gate never opened and the hero never moved.
    */
    timer = setTimeout(tick, DWELL_MS);

    // `capture` so a tab's own onClick does not have to remember to cancel.
    const events = ["pointerdown", "touchstart", "keydown", "focusin"] as const;
    for (const type of events) hero?.addEventListener(type, stop, { capture: true, passive: true });

    return () => {
      if (timer) clearTimeout(timer);
      for (const type of events) hero?.removeEventListener(type, stop, { capture: true });
    };
    /*
      `allLoaded` flips false -> true exactly once, so this effect runs a
      second time and starts the lap. `rotationDone` keeps any later run —
      from a re-render or a prop change — from restarting a finished lap.
    */
  }, [reducedMotion, allLoaded]);

  /*
    Deadlock breaker. The lap starts only when all three photographs have
    reported in, and `onLoad`/`onError` below are the only reporters. If
    neither ever fires — a request stalled mid-flight, a service worker
    gone odd — the hero would sit still forever, which is the exact bug
    that was reported against the preload attempt. Ten seconds in we stop
    waiting and run the lap with whatever is actually on screen.
  */
  useEffect(() => {
    if (allLoaded || rotationDone.current) return;
    const bail = setTimeout(() => setLoaded(new Set(SLIDES.map(s2 => s2.mode))), 10_000);
    return () => clearTimeout(bail);
  }, [allLoaded]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // The homepage search must actually search (§14.1) — the PHP hero's form
    // was decorative on some panels, which is worse than having no search.
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (city) params.set("quartier", city);

    if (slide.mode === "book") {
      // Booking is its own flow: sending guests/date to the restaurant
      // directory, which ignored them, just made the search feel broken.
      // The reservation form reads them back and pre-fills its fields.
      if (guests) params.set("guests", guests);
      if (date) params.set("date", date);
      router.push(publicHref(`/reservations?${params.toString()}`, locale));
      return;
    }

    if (slide.mode === "explore") params.set("sort", "rating");
    router.push(publicHref(`/restaurants?${params.toString()}`, locale));
  }

  return (
    <section ref={heroRef} className="relative isolate overflow-hidden">
      {/*
        ── The photographs, full bleed, ALL THREE MOUNTED ────────────────

        This used to mount only the active slide, keyed on its mode, so
        advancing unmounted one <Image> and mounted another. Two problems,
        and the second is why the lap sat still on real connections:

        1. The swap could not cross-fade — there was never a moment where
           both photographs existed — and on a slow link it showed the bare
           scrim while the new file downloaded.

        2. Trying to hide that by preloading the raw URLs was worse: next/image
           does not request those, it requests /_next/image with its own width
           and quality. So the preload fetched a second, much larger copy of
           every photograph, and the lap waited on a download that had nothing
           to do with what would actually be displayed. On a fast connection
           this merely wasted bandwidth. On a Douala connection it meant the
           gate never opened and the hero never moved, which is exactly what
           was reported.

        Stacking them lets next/image fetch each one once, at the size it will
        actually paint, and reduces advancing to an opacity change — which
        cannot show an empty frame because the image is already there.
      */}
      {SLIDES.map((s, i) => (
        <div
          key={s.mode}
          aria-hidden={i !== index}
          className={cn(
            "absolute inset-0 transition-opacity duration-700 ease-out",
            // `.hero-slide-active` drives the Ken Burns breath (globals.css);
            // class toggling is what restarts the zoom on re-activation.
            i === index ? "hero-slide-active opacity-100" : "opacity-0",
          )}
        >
          <Image
            src={appearance[s.art]}
            alt={i === index ? t(s.artAlt) : ""}
            fill
            sizes="100vw"
            className="object-cover"
            // Only the first is priority; the other two are ordinary loads
            // that resolve in the background while the visitor reads.
            priority={i === 0}
            onLoad={() => setLoaded(prev => (prev.has(s.mode) ? prev : new Set(prev).add(s.mode)))}
            // A photograph that fails — 404, offline, expired URL — must not
            // hold the gate shut forever. A rotation over a possibly-bare
            // frame is recoverable; a hero that never moves is not.
            onError={() => setLoaded(prev => (prev.has(s.mode) ? prev : new Set(prev).add(s.mode)))}
          />
        </div>
      ))}

      {/*
        The scrim. Two gradients rather than one flat wash: the left column is
        where the words live so it is darkest there, and the bottom eases into
        the overlapping stats card. Kept as CSS gradients — a blur filter this
        size is a real paint cost on mid-range Android.
      */}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/50 to-black/25"
      />
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/30"
      />

      {/* ── Content ────────────────────────────────────────────────────── */}
      <div
        className={cn(
          "container-page relative flex flex-col gap-5 pt-6 sm:gap-8 sm:pt-16 lg:min-h-[86vh] lg:justify-center lg:pt-20",
          /*
            The stat strip overlaps this section by -mt-14 / -lg:mt-20, and
            this padding is the room reserved for it. With every figure hidden
            there is no strip to overlap, and the allowance becomes a dead band
            of empty artwork at the bottom of the hero.
          */
          allHomeStatsHidden(statsVisible) ? "pb-14 lg:pb-20" : "pb-24 lg:pb-32",
        )}
      >
        {/* Mode tabs — frosted, on the photo. */}
        <div
          role="tablist"
          aria-label={t("hero.modeGroup")}
          className="grid w-full max-w-md grid-cols-3 gap-1 rounded-full bg-white/10 p-1 ring-1 ring-white/25 backdrop-blur-md"
        >
          {SLIDES.map((s, i) => (
            <button
              key={s.mode}
              role="tab"
              type="button"
              aria-selected={i === index}
              onClick={() => {
                setIndex(i);
              }}
              className={cn(
                "inline-flex min-w-0 items-center justify-center gap-1 rounded-full px-2 py-2.5 text-xs sm:gap-2 sm:text-sm font-semibold transition-colors",
                i === index ? "bg-white text-neutral-900 shadow-sm" : "text-white/80 hover:text-white",
              )}
            >
              <s.TabIcon className="size-4" aria-hidden />
              <span>{t(s.tabLabel)}</span>
            </button>
          ))}
        </div>

        {/*
          KEYED BY SLIDE — load-bearing, not cosmetic. Browser auto-translation
          rewrites text nodes in place; keying makes React replace the element
          rather than patch nodes the translator may have moved. This block is
          the highest-churn text on the site.
        */}
        <div key={slide.mode} aria-live="polite" aria-atomic="true" className="animate-copy-in max-w-3xl">
          <p className="flex items-center gap-3 text-[12px] font-bold tracking-[0.22em] text-accent uppercase">
            <span aria-hidden className="h-px w-10 bg-accent" />
            <span>{t(slide.tag)}</span>
          </p>

          {/* Each fragment in its own element — loose text siblings are what
              the translator merges and reorders. */}
          <h1 className="mt-4 font-display text-[2rem] leading-[1.05] font-bold text-white sm:text-6xl lg:text-7xl">
            <span>{t(slide.titleLead)} </span>
            <em className="text-accent italic">{t(slide.titleAccent)}</em>
            <span>.</span>
          </h1>

          <p className="mt-3 max-w-xl text-sm sm:text-lg leading-relaxed text-white/85">
            {t(slide.subtitle)}
          </p>
        </div>

        {/* ── The search pill ────────────────────────────────────────────── */}
        <form
          onSubmit={onSubmit}
          className="flex w-full max-w-3xl flex-col gap-2 rounded-3xl bg-white p-2 shadow-2xl sm:flex-row sm:items-center sm:rounded-full"
        >
          <label className="flex min-w-0 flex-1 items-center gap-3 rounded-full px-4 py-3">
            <Search className="size-5 shrink-0 text-neutral-400" aria-hidden />
            <span className="sr-only">{t("hero.search.query")}</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                slide.mode === "book"
                  ? t("hero.search.queryPlaceholderBook")
                  : t("hero.search.queryPlaceholder")
              }
              className="w-full min-w-0 bg-transparent text-[15px] text-neutral-900 outline-none placeholder:text-neutral-400"
            />
          </label>

          <div aria-hidden className="hidden h-8 w-px bg-neutral-200 sm:block" />

          <label className="flex items-center gap-2.5 rounded-full px-4 py-3 sm:w-52">
            <MapPin className="size-5 shrink-0 text-neutral-400" aria-hidden />
            <span className="sr-only">{t("hero.search.quartier")}</span>
            <select
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full cursor-pointer bg-transparent text-[15px] text-neutral-900 outline-none"
            >
              <option value="">{t("hero.search.allDouala")}</option>
              {quartiers.map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
            </select>
          </label>

          <button
            type="submit"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-primary px-7 py-3.5 text-[15px] font-bold text-primary-fg transition-colors hover:bg-primary-hover"
          >
            {/* Keyed so the label is replaced rather than patched. */}
            <span key={slide.mode}>
              {slide.mode === "book" ? t("hero.search.submitBook") : t("hero.search.submit")}
            </span>
          </button>
        </form>

        {/* Booking needs two more answers — a second pill, only in that mode. */}
        {slide.mode === "book" && (
          <div
            key="book-extras"
              className="flex w-full max-w-3xl flex-col gap-2 rounded-3xl bg-white/10 p-2 ring-1 ring-white/25 backdrop-blur-md sm:flex-row sm:rounded-full"
          >
            <label className="flex flex-1 items-center gap-2.5 rounded-full px-4 py-2.5 text-white">
              <Users className="size-4 shrink-0 text-white/60" aria-hidden />
              <span className="text-sm text-white/75">{t("hero.search.guests")}</span>
              <input
                type="number"
                min={1}
                max={20}
                value={guests}
                onChange={(e) => setGuests(e.target.value)}
                className="tnum w-16 bg-transparent text-right text-sm font-semibold text-white outline-none"
              />
            </label>
            <label className="flex flex-1 items-center gap-2.5 rounded-full px-4 py-2.5 text-white">
              <CalendarCheck className="size-4 shrink-0 text-white/60" aria-hidden />
              <span className="text-sm text-white/75">{t("hero.search.date")}</span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="flex-1 bg-transparent text-sm font-semibold text-white outline-none [color-scheme:dark]"
              />
            </label>
          </div>
        )}

        <p className="text-sm text-white/70">{t("hero.search.noAccount")}</p>
      </div>
    </section>
  );
}
