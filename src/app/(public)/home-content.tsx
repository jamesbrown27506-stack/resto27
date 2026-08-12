"use client";

import Link from "next/link";
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
import type { PopularDish, PublicRestaurant } from "@/lib/data/public";

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
}: {
  plans: PublicPlan[];
  restaurants: PublicRestaurant[];
  dishes: PopularDish[];
  cuisines: string[];
  quartiers: string[];
}) {
  const { t } = useLocale();
  const featured = restaurants.slice(0, 6);

  return (
    <>
      <Hero cuisines={cuisines} quartiers={quartiers} />

      <StatStrip
        items={[
          { value: "61", label: t("home.stats.restaurants"), icon: <Store /> },
          { value: "12 400", label: t("home.stats.orders"), icon: <ShoppingBag /> },
          { value: "4,6", label: t("home.stats.rating"), icon: <Star /> },
          { value: "32 min", label: t("home.stats.delivery"), icon: <Bike /> },
        ]}
      />

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

      {/* ── Popular dishes ─────────────────────────────────────────────── */}
      <section className="bg-primary-light py-20">
        <div className="container-page">
          <SectionHeader
            tag={t("home.popular.tag")}
            title={t("home.popular.title")}
            subtitle={t("home.popular.subtitle")}
          />
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {dishes.map(({ item, restaurantSlug, restaurantName }) => (
              <DishCard
                key={item.id}
                item={item}
                restaurantSlug={restaurantSlug}
                restaurantName={restaurantName}
              />
            ))}
          </div>
        </div>
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
              cta={{ href: "/register/restaurant", label: t("home.kitchen.cta") }}
              visual={
                <div className="grid size-full place-items-center bg-primary-light text-primary">
                  <ChefHat className="size-20 opacity-30" aria-hidden />
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
                <div className="grid size-full place-items-center bg-surface">
                  <Store className="size-20 text-primary opacity-25" aria-hidden />
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
                <div className="grid size-full place-items-center bg-primary-light text-primary">
                  <CreditCard className="size-20 opacity-30" aria-hidden />
                </div>
              }
            />
          </div>
        </div>
      </section>

      {/* ── Testimonials ───────────────────────────────────────────────── */}
      <section className="container-page py-20">
        <SectionHeader tag={t("home.testimonials.tag")} title={t("home.testimonials.title")} />
        <TestimonialGrid
          items={[
            {
              body: t("home.testimonials.t1"),
              name: "Marie Ngo",
              meta: t("home.testimonials.t1meta"),
              rating: 5,
            },
            {
              body: t("home.testimonials.t2"),
              name: "Paul Mbarga",
              meta: t("home.testimonials.t2meta"),
              rating: 5,
            },
            {
              body: t("home.testimonials.t3"),
              name: "Estelle Manga",
              meta: t("home.testimonials.t3meta"),
              rating: 4,
            },
          ]}
        />
      </section>

      {/* ── Pricing ────────────────────────────────────────────────────── */}
      <section className="bg-surface-2 py-20">
        <div className="container-page">
          <SectionHeader
            tag={t("home.pricing.tag")}
            title={t("home.pricing.title")}
            subtitle={t("home.pricing.subtitle")}
          />
          <PricingGrid plans={plans} compact />
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
        secondary={{ href: "/register/restaurant", label: t("hero.cta.register") }}
      />
    </>
  );
}
