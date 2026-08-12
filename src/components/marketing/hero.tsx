"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  Bike,
  CalendarCheck,
  Compass,
  MapPin,
  Search,
  ShoppingBag,
  Star,
  Users,
  UtensilsCrossed,
} from "lucide-react";
import { useLocale } from "@/lib/i18n/use-locale";
import { cn } from "@/lib/utils";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import type { PublicStats } from "@/lib/data/public";
import type { Appearance } from "@/lib/appearance";

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
  cuisines,
  quartiers,
  stats,
  appearance,
}: {
  cuisines: string[];
  quartiers: string[];
  stats: PublicStats;
  appearance: Appearance;
}) {
  const router = useRouter();
  const { t } = useLocale();

  const [index, setIndex] = useState(0);
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("");
  const [guests, setGuests] = useState("2");
  const [date, setDate] = useState("");

  const slide = SLIDES[index];
  const numberFormat = new Intl.NumberFormat("fr-FR");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // The homepage search must actually search (§14.1) — the PHP hero's form
    // was decorative on some panels, which is worse than having no search.
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (city) params.set("quartier", city);
    if (slide.mode === "book") {
      params.set("booking", "1");
      if (guests) params.set("guests", guests);
      if (date) params.set("date", date);
    }
    if (slide.mode === "explore") params.set("sort", "rating");
    router.push(`/restaurants?${params.toString()}`);
  }

  return (
    <section className="relative isolate overflow-hidden">
      {/* ── The photograph, full bleed ─────────────────────────────────── */}
      {SLIDES.map((s, i) => (
        <div
          key={s.mode}
          aria-hidden={i !== index}
          className={cn(
            "absolute inset-0 transition-opacity duration-700",
            i === index ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        >
          <Image
            src={appearance[s.art]}
            alt={i === index ? t(s.artAlt) : ""}
            fill
            sizes="100vw"
            className="object-cover"
            // The first slide's photo IS the LCP element of the whole site.
            priority={i === 0}
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
      <div className="container-page relative flex flex-col gap-8 pt-14 pb-24 sm:pt-16 lg:min-h-[86vh] lg:justify-center lg:pt-20 lg:pb-32">
        {/* Mode tabs — frosted, on the photo. */}
        <div
          role="tablist"
          aria-label={t("hero.modeGroup")}
          className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-full bg-white/10 p-1 ring-1 ring-white/25 backdrop-blur-md"
        >
          {SLIDES.map((s, i) => (
            <button
              key={s.mode}
              role="tab"
              type="button"
              aria-selected={i === index}
              onClick={() => setIndex(i)}
              className={cn(
                "inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors",
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
        <div key={slide.mode} aria-live="polite" aria-atomic="true" className="max-w-3xl">
          <p className="flex items-center gap-3 text-[12px] font-bold tracking-[0.22em] text-accent uppercase">
            <span aria-hidden className="h-px w-10 bg-accent" />
            <span>{t(slide.tag)}</span>
          </p>

          {/* Each fragment in its own element — loose text siblings are what
              the translator merges and reorders. */}
          <h1 className="mt-5 font-display text-[2.6rem] leading-[1.05] font-bold text-white sm:text-6xl lg:text-7xl">
            <span>{t(slide.titleLead)} </span>
            <em className="text-accent italic">{t(slide.titleAccent)}</em>
            <span>.</span>
          </h1>

          <p className="mt-5 max-w-xl text-lg leading-relaxed text-white/85">
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

        {/* ── One-tap paths: the cuisines people actually search ─────────── */}
        {cuisines.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-sm font-medium text-white/70">{t("hero.popular")}</span>
            {cuisines.slice(0, 6).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => router.push(`/restaurants?cuisine=${encodeURIComponent(c)}`)}
                className="rounded-full bg-white/10 px-4 py-1.5 text-sm font-medium text-white ring-1 ring-white/25 backdrop-blur-md transition-colors hover:bg-white hover:text-neutral-900"
              >
                <span>{c}</span>
              </button>
            ))}
          </div>
        )}

        {/* ── Trust, quietly ─────────────────────────────────────────────── */}
        <ul className="flex flex-wrap items-center gap-x-7 gap-y-2 text-sm text-white/80">
          <li className="inline-flex items-center gap-2">
            <Star className="size-4 fill-accent text-accent" aria-hidden />
            <strong className="tnum font-semibold text-white">
              {stats.averageRating > 0 ? `${stats.averageRating.toFixed(1).replace(".", ",")}/5` : "—"}
            </strong>
            <span>{t("hero.trust.rating")}</span>
          </li>
          <li className="inline-flex items-center gap-2">
            <UtensilsCrossed className="size-4 text-accent" aria-hidden />
            <strong className="tnum font-semibold text-white">
              {numberFormat.format(stats.restaurantCount)}
            </strong>
            <span>{t("hero.trust.restaurants")}</span>
          </li>
          <li className="inline-flex items-center gap-2">
            <Bike className="size-4 text-accent" aria-hidden />
            <strong className="tnum font-semibold text-white">
              {Math.round(stats.averageDeliveryMinutes)} min
            </strong>
            <span>{t("home.stats.delivery")}</span>
          </li>
          <li className="text-white/60">{t("hero.search.noAccount")}</li>
        </ul>
      </div>
    </section>
  );
}
