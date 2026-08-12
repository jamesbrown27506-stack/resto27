"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Bike,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  Compass,
  Pause,
  Play,
  Search,
  ShoppingBag,
  Star,
  UtensilsCrossed,
  Users,
} from "lucide-react";
import { BookArt, ExploreArt, OrderArt } from "./hero-art";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { usePrefersReducedMotion } from "@/lib/hooks/use-prefers-reduced-motion";
import { useLocale } from "@/lib/i18n/use-locale";
import { cn } from "@/lib/utils";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import type { PublicStats } from "@/lib/data/public";

/**
 * The hero.
 *
 * Layout: copy on the left with the search card directly beneath it,
 * illustration on the right. The search panel sits in the reading flow rather
 * than beside it, so someone scanning the headline lands on the input next
 * instead of having to jump columns.
 *
 * Three slides rotate on a 5-second timer and loop. The rotation is genuinely
 * optional at every moment: arrows and dots take manual control, hovering or
 * focusing anything inside pauses it, and there is an explicit pause button.
 * `prefers-reduced-motion` disables auto-advance entirely — auto-motion the
 * user did not ask for is the one kind they cannot anticipate.
 *
 * The illustration is inline SVG, so all three slides cost zero network
 * requests and the LCP element is already painted.
 */

const SLIDE_MS = 5000;

type Mode = "order" | "book" | "explore";

interface Slide {
  mode: Mode;
  tabLabel: TranslationKey;
  TabIcon: typeof ShoppingBag;
  tag: TranslationKey;
  titleLead: TranslationKey;
  titleAccent: TranslationKey;
  subtitle: TranslationKey;
  Art: typeof OrderArt;
  badge: { icon: typeof Bike };
}

const SLIDES: Slide[] = [
  {
    mode: "order",
    tabLabel: "hero.mode.order",
    TabIcon: ShoppingBag,
    tag: "hero.order.tag",
    titleLead: "hero.order.titleLead",
    titleAccent: "hero.order.titleAccent",
    subtitle: "hero.order.subtitle",
    Art: OrderArt,
    badge: { icon: Bike },
  },
  {
    mode: "book",
    tabLabel: "hero.mode.book",
    TabIcon: CalendarCheck,
    tag: "hero.book.tag",
    titleLead: "hero.book.titleLead",
    titleAccent: "hero.book.titleAccent",
    subtitle: "hero.book.subtitle",
    Art: BookArt,
    badge: { icon: CalendarCheck },
  },
  {
    mode: "explore",
    tabLabel: "hero.mode.explore",
    TabIcon: Compass,
    tag: "hero.explore.tag",
    titleLead: "hero.explore.titleLead",
    titleAccent: "hero.explore.titleAccent",
    subtitle: "hero.explore.subtitle",
    Art: ExploreArt,
    badge: { icon: Compass },
  },
];

export function Hero({
  cuisines,
  quartiers,
  stats,
}: {
  cuisines: string[];
  quartiers: string[];
  stats: PublicStats;
}) {
  const router = useRouter();
  const { t } = useLocale();
  const reducedMotion = usePrefersReducedMotion();

  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  /** Set once the user takes control — the timer never restarts after that. */
  const [userTook, setUserTook] = useState(false);

  const [query, setQuery] = useState("");
  const [city, setCity] = useState("");
  const [cuisine, setCuisine] = useState("");
  const [guests, setGuests] = useState("2");
  const [date, setDate] = useState("");

  const slide = SLIDES[index];
  const autoplay = !reducedMotion && !paused && !userTook;
  const numberFormat = new Intl.NumberFormat("fr-FR");

  function badgeFor(mode: Mode) {
    if (mode === "order") {
      return {
        title: `${Math.round(stats.averageDeliveryMinutes)} min`,
        body: quartiers[0] ?? "Douala",
      };
    }
    if (mode === "explore") {
      return { title: numberFormat.format(stats.restaurantCount), body: "Douala" };
    }
    return { title: "19:30", body: "Table 4 · 2 pers." };
  }

  const badge = badgeFor(slide.mode);

  useEffect(() => {
    if (!autoplay) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % SLIDES.length);
    }, SLIDE_MS);
    return () => window.clearInterval(id);
  }, [autoplay]);

  const goTo = useCallback((next: number) => {
    setIndex((next + SLIDES.length) % SLIDES.length);
    setUserTook(true);
  }, []);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // The homepage search must actually search (§14.1) — the PHP hero's form
    // was decorative on some panels, which is worse than having no search.
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (city) params.set("quartier", city);
    if (cuisine) params.set("cuisine", cuisine);
    if (slide.mode === "book") {
      params.set("booking", "1");
      if (guests) params.set("guests", guests);
      if (date) params.set("date", date);
    }
    if (slide.mode === "explore") params.set("sort", "rating");
    router.push(`/restaurants?${params.toString()}`);
  }

  return (
    <section
      aria-roledescription="carousel"
      aria-label={t("hero.slider.label")}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      className="relative overflow-hidden"
    >
      {/* Decorative wash. A CSS gradient rather than blurred DOM nodes — large
          blur filters are a real paint cost on mid-range Android. */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(1100px 600px at 78% 8%, color-mix(in oklab, var(--primary) 12%, transparent), transparent 65%), radial-gradient(760px 520px at 8% 92%, color-mix(in oklab, var(--accent) 16%, transparent), transparent 62%)",
        }}
      />

      <div className="container-page grid items-center gap-10 py-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:gap-16 lg:py-20">
        {/* ── Left: copy, then the search card ───────────────────────────── */}
        <div className="flex flex-col gap-7">
          {/*
            KEYED BY SLIDE — and that is load-bearing, not cosmetic.

            Without the key, React patches the text nodes in place every five
            seconds. Browser auto-translation replaces those same text nodes
            with <font> wrappers, so React's next patch targets a node that is
            no longer in the tree and the page dies with
            "insertBefore … is not a child of this node".

            With the key, React discards the element and mounts a fresh one, so
            it never reaches for a node the translator moved. The rotating hero
            is the highest-churn text on the site, which made it the most
            reliable way to trigger that crash.
          */}
          <div
            key={slide.mode}
            // aria-live so a screen-reader user is told the copy changed under
            // them, rather than silently reading stale text.
            aria-live="polite"
            aria-atomic="true"
            className="flex flex-col gap-5"
          >
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-primary px-3.5 py-1 text-[11px] font-bold tracking-[0.1em] text-primary-fg uppercase">
              {t(slide.tag)}
            </span>

            {/* Each fragment of the headline gets its own element. Loose text
                siblings are exactly what the translator merges and reorders. */}
            <h1 className="font-display text-4xl leading-[1.1] font-bold sm:text-5xl lg:text-[3.25rem]">
              <span>{t(slide.titleLead)} </span>
              <em className="text-primary italic">{t(slide.titleAccent)}</em>
              <span>.</span>
            </h1>

            <p className="max-w-lg text-lg leading-relaxed text-text-secondary">
              {t(slide.subtitle)}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link href="/restaurants" className={buttonClasses({ size: "lg" })}>
              {t("hero.cta.browse")}
            </Link>
            <Link
              href="/register/restaurant"
              className={buttonClasses({ variant: "outline", size: "lg" })}
            >
              {t("hero.cta.register")}
            </Link>
          </div>

          {/* ── Search card, in the reading flow ─────────────────────────── */}
          <div className="rounded-xl border border-border bg-surface p-5 shadow-lg sm:p-6">
            <div
              role="tablist"
              aria-label={t("hero.modeGroup")}
              className="mb-5 flex gap-1 rounded-full bg-surface-2 p-1"
            >
              {SLIDES.map((s, i) => (
                <button
                  key={s.mode}
                  role="tab"
                  type="button"
                  aria-selected={i === index}
                  onClick={() => goTo(i)}
                  className={cn(
                    "inline-flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold transition-colors",
                    i === index
                      ? "bg-primary text-primary-fg shadow-sm"
                      : "text-text-secondary hover:text-text",
                  )}
                >
                  <s.TabIcon className="size-4" aria-hidden />
                  {t(s.tabLabel)}
                </button>
              ))}
            </div>

            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              <Field label={t("hero.search.query")} htmlFor="hero-q">
                <Input
                  id="hero-q"
                  icon={<Search />}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={
                    slide.mode === "book"
                      ? t("hero.search.queryPlaceholderBook")
                      : t("hero.search.queryPlaceholder")
                  }
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("hero.search.quartier")} htmlFor="hero-city">
                  <Select id="hero-city" value={city} onChange={(e) => setCity(e.target.value)}>
                    <option value="">{t("hero.search.allDouala")}</option>
                    {quartiers.map((q) => (
                      <option key={q} value={q}>
                        {q}
                      </option>
                    ))}
                  </Select>
                </Field>

                {slide.mode === "book" ? (
                  <Field key="guests" label={t("hero.search.guests")} htmlFor="hero-guests">
                    <Input
                      id="hero-guests"
                      icon={<Users />}
                      type="number"
                      min={1}
                      max={20}
                      value={guests}
                      onChange={(e) => setGuests(e.target.value)}
                    />
                  </Field>
                ) : (
                  <Field key="cuisine" label={t("hero.search.cuisine")} htmlFor="hero-cuisine">
                    <Select
                      id="hero-cuisine"
                      value={cuisine}
                      onChange={(e) => setCuisine(e.target.value)}
                    >
                      <option value="">{t("hero.search.allCuisines")}</option>
                      {cuisines.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
              </div>

              {slide.mode === "book" && (
                <Field label={t("hero.search.date")} htmlFor="hero-date">
                  <Input
                    id="hero-date"
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </Field>
              )}

              <Button type="submit" size="lg" fullWidth className="mt-1 rounded-md">
                {/* Keyed so the label is replaced rather than patched — see
                    the note on the copy block above. */}
                <span key={slide.mode}>
                  {slide.mode === "book"
                    ? t("hero.search.submitBook")
                    : t("hero.search.submit")}
                </span>
              </Button>
            </form>

            <p className="mt-4 text-center text-xs text-text-light">
              {t("hero.search.noAccount")}
            </p>
          </div>

            <ul className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-text-secondary">
              <li className="inline-flex items-center gap-1.5">
                <Star className="size-3.5 fill-accent text-accent" aria-hidden />
                <strong className="tnum font-semibold text-text">
                  {stats.averageRating > 0
                    ? `${stats.averageRating.toFixed(1).replace(".", ",")}/5`
                    : "—"}
                </strong>
                {t("hero.trust.rating")}
              </li>
              <li className="inline-flex items-center gap-1.5">
                <UtensilsCrossed className="size-3.5 text-primary" aria-hidden />
                <strong className="tnum font-semibold text-text">
                  {numberFormat.format(stats.restaurantCount)}
                </strong>
                {t("hero.trust.restaurants")}
              </li>
            </ul>
        </div>

        {/* ── Right: illustration ────────────────────────────────────────── */}
        <div className="relative order-first mx-auto w-full max-w-md lg:order-none">
          <div className="relative aspect-square">
            {SLIDES.map((s, i) => (
              <div
                key={s.mode}
                role="tabpanel"
                aria-hidden={i !== index}
                className={cn(
                  "absolute inset-0 transition-opacity duration-700",
                  i === index ? "opacity-100" : "pointer-events-none opacity-0",
                )}
              >
                <s.Art className="size-full" />
              </div>
            ))}

            {/* Floating badge — carried over from the PHP hero's info chip. */}
            <div
              key={slide.mode}
              className="animate-rise absolute bottom-6 -left-2 flex items-center gap-2.5 rounded-md border border-border bg-surface px-3.5 py-2.5 shadow-md sm:-left-4"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-light text-primary">
                <slide.badge.icon className="size-4" aria-hidden />
              </span>
              <span className="text-xs leading-tight">
                <strong className="tnum block text-sm font-bold text-text">
                  {badge.title}
                </strong>
                <span className="text-text-secondary">{badge.body}</span>
              </span>
            </div>

            <div className="absolute top-6 -right-2 flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-fg shadow-md sm:-right-4">
              <Star className="size-3.5 fill-accent text-accent" aria-hidden />
              <span className="tnum">4,6</span>
            </div>
          </div>

          {/* ── Controls ─────────────────────────────────────────────────── */}
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => goTo(index - 1)}
              aria-label={t("hero.slider.previous")}
              className="grid size-9 place-items-center rounded-full border border-border bg-surface text-text-secondary shadow-sm transition-colors hover:border-primary hover:bg-primary hover:text-primary-fg"
            >
              <ChevronLeft className="size-4" aria-hidden />
            </button>

            <div className="flex items-center gap-2">
              {SLIDES.map((s, i) => (
                <button
                  key={s.mode}
                  type="button"
                  onClick={() => goTo(i)}
                  aria-label={`${t("hero.slider.goTo")} ${i + 1}`}
                  aria-current={i === index}
                  className={cn(
                    "h-2 rounded-full transition-all duration-300",
                    i === index ? "w-7 bg-primary" : "w-2 bg-border hover:bg-border-strong",
                  )}
                />
              ))}
            </div>

            <button
              type="button"
              onClick={() => goTo(index + 1)}
              aria-label={t("hero.slider.next")}
              className="grid size-9 place-items-center rounded-full border border-border bg-surface text-text-secondary shadow-sm transition-colors hover:border-primary hover:bg-primary hover:text-primary-fg"
            >
              <ChevronRight className="size-4" aria-hidden />
            </button>

            {/* Explicit pause. Once the user has taken manual control the timer
                is off for good, so this becomes the way back to auto. */}
            {!reducedMotion && (
              <button
                type="button"
                onClick={() => setUserTook((taken) => !taken)}
                aria-label={userTook ? t("hero.slider.play") : t("hero.slider.pause")}
                title={userTook ? t("hero.slider.play") : t("hero.slider.pause")}
                className="ml-1 grid size-9 place-items-center rounded-full text-text-light transition-colors hover:bg-surface-2 hover:text-text"
              >
                {userTook ? (
                  <Play className="size-3.5" aria-hidden />
                ) : (
                  <Pause className="size-3.5" aria-hidden />
                )}
              </button>
            )}
          </div>

          {/* Progress bar — shows the timer is running and how much is left. */}
          {autoplay && (
            <div className="mx-auto mt-3 h-0.5 w-28 overflow-hidden rounded-full bg-border">
              <div
                key={index}
                className="h-full bg-primary"
                style={{ animation: `rl-progress ${SLIDE_MS}ms linear forwards` }}
              />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
