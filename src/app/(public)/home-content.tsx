"use client";

import Link from "next/link";
import Image from "next/image";
import { Bike, ChefHat, CreditCard, Search, ShoppingBag, Star, Store } from "lucide-react";
import { Hero } from "@/components/marketing/hero";
import { Faq } from "@/components/marketing/faq";
import { PricingGrid } from "@/components/marketing/pricing-grid";
import type { PublicPlan } from "@/lib/data/plans";
import {
  CtaBanner,
  FeatureRow,
  SectionHeader,
  StatStrip,
  StepList,
  TestimonialGrid,
} from "@/components/marketing/sections";
import { RestaurantCard, RestaurantGrid } from "@/components/restaurant/restaurant-card";
import { DishCard } from "@/components/menu/dish-card";
import { buttonClasses } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/use-locale";
import { useDates } from "@/lib/format/use-dates";
import { planCtaHref } from "@/lib/nav";
import type { PopularDish, PublicRestaurant, PublicStats, FeaturedReview } from "@/lib/data/public";
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
  dishes: PopularDish[];
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
  const { t } = useLocale();
  const dates = useDates();
  const featured = restaurants.slice(0, 6);
  const numberFormat = new Intl.NumberFormat("fr-FR");

  return (
    <>
      {freeModeInfo.active && (
        <div className="border-b border-primary/20 bg-primary/5 px-4 py-2.5 text-center text-sm">
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
        cuisines={cuisines}
        quartiers={quartiers}
        stats={stats}
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
                  value: stats.averageRating.toFixed(1).replace(".", ","),
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

      {/* ── Popular dishes ─────────────────────────────────────────────── */}
      <section className="bg-primary-light py-20">
        <div className="container-page">
          <SectionHeader
            tag={t("home.popular.tag")}
            title={t("home.popular.title")}
            subtitle={t("home.popular.subtitle")}
          />
          <div className="relative mb-12 h-56 overflow-hidden rounded-xl sm:h-72 lg:h-80">
            <Image
              src={appearance.homeDishes}
              alt={t("home.alt.dishes")}
              fill
              sizes="100vw"
              className="object-cover"
            />
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {dishes.map(
              ({ item, restaurantSlug, restaurantName, restaurantLogo, restaurantRating, restaurantQuartier }) => (
                <DishCard
                  key={item.id}
                  item={item}
                  restaurantSlug={restaurantSlug}
                  restaurantName={restaurantName}
                  restaurantLogo={restaurantLogo}
                  restaurantRating={restaurantRating}
                  restaurantQuartier={restaurantQuartier}
                />
              ),
            )}
          </div>
        </div>
      </section>

      {/* ── Featured restaurants ───────────────────────────────────────── */}
      <section className="container-page py-20">
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
      <section className="container-page py-20">
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
      <section className="bg-surface-2 py-20">
        <div className="container-page">
          <SectionHeader
            tag={t("home.owners.tag")}
            title={t("home.owners.title")}
            subtitle={t("home.owners.subtitle")}
          />

          <div className="flex flex-col gap-20">
            <FeatureRow
              icon={<ChefHat />}
              title={t("home.kitchen.title")}
              description={t("home.kitchen.body")}
              bullets={[t("home.kitchen.b1"), t("home.kitchen.b2"), t("home.kitchen.b3")]}
              cta={{ href: planCtaHref(userArea), label: t("home.kitchen.cta") }}
              visual={
                <div className="relative size-full">
                  <Image
                    src={appearance.homeKitchen}
                    alt={t("home.alt.kitchen")}
                    fill
                    sizes="(min-width: 1024px) 50vw, 100vw"
                    className="object-cover"
                  />
                </div>
              }
            />

            <FeatureRow
              reverse
              icon={<Store />}
              title={t("home.branches.title")}
              description={t("home.branches.body")}
              bullets={[t("home.branches.b1"), t("home.branches.b2"), t("home.branches.b3")]}
              cta={{ href: "/pricing", label: t("home.branches.cta") }}
              visual={
                <div className="relative size-full">
                  <Image
                    src={appearance.homeBranches}
                    alt={t("home.alt.branches")}
                    fill
                    sizes="(min-width: 1024px) 50vw, 100vw"
                    className="object-cover"
                  />
                </div>
              }
            />

            <FeatureRow
              icon={<CreditCard />}
              title={t("home.payment.title")}
              description={t("home.payment.body")}
              bullets={[t("home.payment.b1"), t("home.payment.b2"), t("home.payment.b3")]}
              cta={{ href: "/pricing", label: t("home.payment.cta") }}
              visual={
                <div className="relative size-full">
                  <Image
                    src={appearance.homePayment}
                    alt={t("home.alt.payment")}
                    fill
                    sizes="(min-width: 1024px) 50vw, 100vw"
                    className="object-cover"
                  />
                </div>
              }
            />
          </div>
        </div>
      </section>

      {/* ── Testimonials — the platform's best real reviews ─────────────── */}
      {testimonials.length > 0 && (
        <section className="container-page py-20">
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
      <section className="bg-surface-2 py-20">
        <div className="container-page">
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
      <section className="container-page py-20">
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
