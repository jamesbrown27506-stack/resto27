"use client";

import Link from "@/components/layout/public-link";
import Image from "next/image";
import { ArrowRight, Bike, ChefHat, CreditCard, Search, ShoppingBag, Star, Store } from "lucide-react";
import { Hero } from "@/components/marketing/hero";
import { Faq } from "@/components/marketing/faq";
import { PricingGrid } from "@/components/marketing/pricing-grid";
import type { PublicPlan } from "@/lib/data/plans";
import {
  CtaBanner,
  SectionHeader,
  StatStrip,
  StepList,
  TestimonialGrid,
} from "@/components/marketing/sections";
import { RestaurantCard, RestaurantGrid } from "@/components/restaurant/restaurant-card";
import { buttonClasses } from "@/components/ui/button";
import { formatMoney } from "@/lib/format/currency";
import { useLocale } from "@/lib/i18n/use-locale";
import { useDates } from "@/lib/format/use-dates";
import { planCtaHref } from "@/lib/nav";
import type { PublicRestaurant, PublicStats, FeaturedReview } from "@/lib/data/public";
import type { DishGroup } from "@/lib/menu-summary";
import type { Appearance } from "@/lib/appearance";
import type { HomeStatsVisibility } from "@/lib/home-stats";

/**
 * Homepage body.
 *
 * Split from page.tsx because `metadata` requires a Server Component while
 * `useLocale` requires a Client one. The server file keeps the SEO surface;
 * everything a human reads lives here and is translated.
 *
 * This file is composition only. In the PHP build the homepage was a
 * 3 959-line self-contained document with its own <head> and stylesheet —
 * §10 calls it "the single worst structural decision in the codebase".
 */
export function HomeContent({
  plans,
  restaurants,
  dishes,
  cuisines,
  quartiers,
  stats,
  statsVisible,
  testimonials,
  appearance,
  userArea = null,
  freeModeInfo = { active: false, days: 0, endsAt: null },
}: {
  plans: PublicPlan[];
  restaurants: PublicRestaurant[];
  /** One tile per dish, not per restaurant — see lib/menu-summary. */
  dishes: DishGroup[];
  cuisines: string[];
  quartiers: string[];
  stats: PublicStats;
  /** Which of the four figures the admin advertises. See lib/home-stats. */
  statsVisible: HomeStatsVisibility;
  testimonials: FeaturedReview[];
  appearance: Appearance;
  /** The signed-in user's area — pricing CTAs route to it (planCtaHref). */
  userArea?: "admin" | "manager" | "customer" | null;
  /**
   * Free mode — the announcement lives on the home page and nowhere else:
   * "the platform is free for restaurants for {days} day(s)". Gated on the
   * flag, so a configured countdown without the flag announces nothing.
   */
  freeModeInfo?: { active: boolean; days: number; endsAt: string | null };
}) {
  const { t, locale } = useLocale();
  const dates = useDates();
  const featured = restaurants.slice(0, 6);
  const numberFormat = new Intl.NumberFormat("fr-FR");

  return (
    <>
      {freeModeInfo.active && (
        <div className="hidden border-b border-primary/20 bg-primary/5 px-4 py-2.5 text-center text-sm sm:block">
          <span className="font-semibold text-primary">{t("home.freeBanner.title")}</span>{" "}
          <span className="opacity-70">
            {t(
              freeModeInfo.endsAt
                ? "home.freeBanner.bodyDate"
                : freeModeInfo.days > 0
                  ? "home.freeBanner.bodyDays"
                  : "home.freeBanner.body",
              freeModeInfo.endsAt
                ? { days: freeModeInfo.days, date: dates.date(freeModeInfo.endsAt) }
                : freeModeInfo.days > 0
                  ? { days: freeModeInfo.days }
                  : undefined,
            )}
          </span>
        </div>
      )}
      <Hero
        quartiers={quartiers}
        statsVisible={statsVisible}
        appearance={appearance}
      />

      {/*
        Each figure appears only if the admin is willing to advertise it. When
        all four are off the strip is not rendered at all — an empty bordered
        band is worse than no band, and StatStrip refuses an empty list anyway
        so no future caller can paint one either.
      */}
      <StatStrip
        items={[
          ...(statsVisible.restaurants
            ? [
                {
                  value: numberFormat.format(stats.restaurantCount),
                  label: t("home.stats.restaurants"),
                  icon: <Store />,
                },
              ]
            : []),
          ...(statsVisible.orders
            ? [
                {
                  value: numberFormat.format(stats.deliveredOrderCount),
                  label: t("home.stats.orders"),
                  icon: <ShoppingBag />,
                },
              ]
            : []),
          ...(statsVisible.rating
            ? [
                {
                  value: stats.reviewCount ? stats.averageRating.toFixed(1).replace(".", ",") : "—",
                  label: t("home.stats.rating"),
                  icon: <Star />,
                },
              ]
            : []),
          ...(statsVisible.delivery
            ? [
                {
                  value: `${Math.round(stats.averageDeliveryMinutes)} min`,
                  label: t("home.stats.delivery"),
                  icon: <Bike />,
                },
              ]
            : []),
        ]}
      />

      <nav
        aria-label={locale === "fr" ? "Découvrir par cuisine" : "Discover by cuisine"}
        className="container-page flex flex-col gap-4 py-8 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="stagger-in no-scrollbar flex gap-2 overflow-x-auto pb-1">
          {cuisines.slice(0, 6).map((cuisine) => (
            <Link
              key={cuisine}
              href={`/restaurants?cuisine=${encodeURIComponent(cuisine)}`}
              className="shrink-0 rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold transition-colors hover:border-primary hover:text-primary"
            >
              {cuisine}
            </Link>
          ))}
        </div>
        <Link href="/explore" className="group inline-flex shrink-0 items-center gap-2 text-sm font-semibold text-primary transition-all hover:text-primary-hover">
          {locale === "fr" ? "Tout explorer" : "Explore everything"}
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden />
        </Link>
      </nav>

      {/* ── Popular dishes ─────────────────────────────────────────────── */}
      <section className="reveal bg-gradient-to-br from-primary/10 via-primary-light to-surface py-20">
        <div className="container-page">
          <SectionHeader
            tag={t("home.popular.tag")}
            title={t("home.popular.title")}
            subtitle={t("home.popular.subtitle")}
          />
          <div className="relative mb-12 h-56 overflow-hidden rounded-2xl shadow-xl sm:h-72 lg:h-80 transition-transform duration-500 hover:scale-[1.02]">
            <Image
              src={appearance.homeDishes}
              alt={t("home.alt.dishes")}
              fill
              sizes="100vw"
              className="object-cover transition-transform duration-700 hover:scale-105"
            />
          </div>
          {/*
            The dish, not the restaurant: each tile opens the dish's explore
            page, which lists every restaurant serving it with its price and
            neighbourhood — so the visitor picks the nearest or the cheapest.
          */}
          <div className="stagger-in grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {dishes.map((dish) => (
              <Link
                key={dish.slug}
                href={`/explore/food/${dish.slug}`}
                className="group relative min-h-52 overflow-hidden rounded-xl border border-border bg-brand-solid text-white shadow-sm transition-shadow hover:shadow-lg"
              >
                {dish.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={dish.imageUrl}
                    alt={`${dish.name} — Douala`}
                    loading="lazy"
                    className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                )}
                <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-black/5" />
                <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-5">
                  <span className="min-w-0">
                    <span className="block font-display text-xl font-bold">{dish.name}</span>
                    <span className="mt-1 block text-xs text-white/75">
                      <span>
                        {dish.restaurantCount === 1
                          ? t("home.popular.oneRestaurant")
                          : t("home.popular.restaurants", { count: dish.restaurantCount })}
                      </span>
                      {dish.minPrice !== null && (
                        <span> · {t("home.popular.from", { price: formatMoney(dish.minPrice) })}</span>
                      )}
                    </span>
                  </span>
                  <ArrowRight className="size-5 shrink-0 transition-transform group-hover:translate-x-1" aria-hidden />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── Featured restaurants ───────────────────────────────────────── */}
      <section className="reveal container-page py-20">
        <SectionHeader
          align="left"
          tag={t("home.featured.tag")}
          title={t("home.featured.title")}
          subtitle={t("home.featured.subtitle")}
          action={
            <Link href="/restaurants" className={buttonClasses({ variant: "outline" })}>
              {t("home.featured.all")}
            </Link>
          }
        />
        <RestaurantGrid>
          {featured.map((r) => (
            <RestaurantCard key={r.id} restaurant={r} />
          ))}
        </RestaurantGrid>
      </section>

      {/* ── How it works ───────────────────────────────────────────────── */}
      <section className="reveal container-page py-20">
        <SectionHeader
          tag={t("home.how.tag")}
          title={t("home.how.title")}
          subtitle={t("home.how.subtitle")}
        />
        <StepList
          stepLabel={t("home.how.step")}
          steps={[
            {
              icon: <Search />,
              title: t("home.how.step1.title"),
              description: t("home.how.step1.body"),
            },
            {
              icon: <ShoppingBag />,
              title: t("home.how.step2.title"),
              description: t("home.how.step2.body"),
            },
            {
              icon: <Bike />,
              title: t("home.how.step3.title"),
              description: t("home.how.step3.body"),
            },
          ]}
        />
      </section>

      {/* ── For restaurants ────────────────────────────────────────────── */}
      <section className="reveal bg-gradient-to-tr from-surface-2 via-surface to-accent/5 py-20 relative overflow-hidden">
        <div className="absolute top-0 right-0 -mr-20 -mt-20 w-96 h-96 rounded-full bg-primary/5 blur-3xl" aria-hidden="true" />
        <div className="container-page relative z-10">
          <SectionHeader
            align="left"
            tag={t("home.owners.tag")}
            title={t("home.owners.title")}
            subtitle={t("home.owners.subtitle")}
          />

          <div className="grid gap-6 lg:grid-cols-[1.08fr_.92fr]">
            <div className="relative min-h-[28rem] overflow-hidden rounded-2xl border border-border shadow-2xl transition-all duration-500 hover:shadow-primary/20">
              <Image
                src={appearance.homeKitchen}
                alt={t("home.alt.kitchen")}
                fill
                sizes="(min-width: 1024px) 54vw, 100vw"
                className="object-cover transition-transform duration-700 hover:scale-105"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-6 pt-32 text-white sm:p-8 backdrop-blur-[2px]">
                <p className="max-w-md font-display text-2xl font-bold sm:text-3xl drop-shadow-md">
                  {t("home.kitchen.title")}
                </p>
                <p className="mt-2 max-w-lg text-sm leading-relaxed text-white/90 drop-shadow">
                  {t("home.kitchen.body")}
                </p>
              </div>
            </div>

            <div className="stagger-in grid gap-4">
              {[
                {
                  Icon: ChefHat,
                  title: t("home.kitchen.title"),
                  body: t("home.kitchen.b1"),
                },
                {
                  Icon: Store,
                  title: t("home.branches.title"),
                  body: t("home.branches.body"),
                },
                {
                  Icon: CreditCard,
                  title: t("home.payment.title"),
                  body: t("home.payment.body"),
                },
              ].map(({ Icon, title, body }) => (
                <article key={title} className="group flex gap-4 rounded-xl border border-border bg-white/60 p-5 backdrop-blur-md shadow-sm transition-all duration-300 hover:shadow-md hover:bg-white hover:-translate-y-1 dark:bg-surface-2/60 dark:hover:bg-surface-2">
                  <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary-light text-primary transition-transform duration-300 group-hover:scale-110 group-hover:bg-primary group-hover:text-white">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <div>
                    <h3 className="font-display text-lg font-bold group-hover:text-primary transition-colors">{title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-text-secondary">{body}</p>
                  </div>
                </article>
              ))}
              <div className="flex flex-wrap gap-3 pt-2">
                <Link href={planCtaHref(userArea)} className={buttonClasses()}>
                  {t("home.kitchen.cta")}
                </Link>
                <Link href="/pricing" className={buttonClasses({ variant: "outline" })}>
                  {t("home.branches.cta")}
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Testimonials — the platform's best real reviews ─────────────── */}
      {testimonials.length > 0 && (
        <section className="reveal container-page py-20">
          <SectionHeader tag={t("home.testimonials.tag")} title={t("home.testimonials.title")} />
          <TestimonialGrid
            items={testimonials.map((r) => ({
              body: r.body,
              name: r.name,
              meta: r.meta,
              rating: r.rating,
            }))}
          />
        </section>
      )}

      {/* ── Pricing ────────────────────────────────────────────────────── */}
      <section className="reveal bg-gradient-to-br from-surface to-surface-2 py-20 relative">
        <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-96 h-96 rounded-full bg-accent/5 blur-3xl" aria-hidden="true" />
        <div className="container-page relative z-10">
          <SectionHeader
            tag={t("home.pricing.tag")}
            title={t("home.pricing.title")}
            subtitle={t("home.pricing.subtitle")}
          />
          <PricingGrid plans={plans} compact userArea={userArea} />
          <p className="mt-8 text-center text-sm text-text-secondary">
            {t("home.pricing.question")}{" "}
            <Link
              href="/pricing"
              className="font-semibold text-primary underline underline-offset-4"
            >
              {t("home.pricing.detail")}
            </Link>
          </p>
        </div>
      </section>

      {/* ── FAQ ────────────────────────────────────────────────────────── */}
      <section className="reveal container-page py-20">
        <SectionHeader tag={t("home.faq.tag")} title={t("home.faq.title")} />
        <Faq
          items={[
            { question: t("home.faq.q1"), answer: t("home.faq.a1") },
            { question: t("home.faq.q2"), answer: t("home.faq.a2") },
            { question: t("home.faq.q3"), answer: t("home.faq.a3") },
            { question: t("home.faq.q4"), answer: t("home.faq.a4") },
            { question: t("home.faq.q5"), answer: t("home.faq.a5") },
            { question: t("home.faq.q6"), answer: t("home.faq.a6") },
          ]}
        />
      </section>

      <CtaBanner
        title={t("home.cta.title")}
        description={t("home.cta.body")}
        primary={{ href: "/restaurants", label: t("hero.cta.browse") }}
        secondary={{ href: planCtaHref(userArea), label: t("hero.cta.register") }}
      />
    </>
  );
}
