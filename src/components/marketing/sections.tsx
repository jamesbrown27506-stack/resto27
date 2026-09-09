import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { SectionTag } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Shared section heading. Keeps eyebrow/title/subtitle rhythm identical everywhere. */
export function SectionHeader({
  tag,
  title,
  subtitle,
  align = "center",
  action,
}: {
  tag?: string;
  title: string;
  subtitle?: string;
  align?: "center" | "left";
  action?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "mb-12 flex flex-wrap gap-4",
        align === "center" ? "flex-col items-center text-center" : "items-end justify-between",
      )}
    >
      <div className={cn(align === "center" && "flex flex-col items-center")}>
        {tag && <SectionTag className="mb-3.5">{tag}</SectionTag>}
        <h2 className="font-display text-3xl font-bold sm:text-4xl">{title}</h2>
        {subtitle && (
          <p className={cn("mt-3 text-text-secondary", align === "center" && "max-w-xl")}>
            {subtitle}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

/* ── Stats strip ───────────────────────────────────────────────────────── */

/**
 * Rendered directly under the full-bleed hero, OVERLAPPING its bottom edge —
 * the negative margin is the design, not a spacing bug. A floating card reads
 * as "the numbers that vouch for the photo above", where the old flat green
 * band read as a separator. Token-driven, so it holds in both themes.
 */
export function StatStrip({
  items,
}: {
  items: { value: string; label: string; icon: React.ReactNode }[];
}) {
  /*
    NO ITEMS, NO BAND. The strip overlaps the hero by design and carries its
    own border and shadow, so rendering it empty leaves a hairline box floating
    over the artwork. Refusing here means no caller can paint one by accident,
    however its list came to be empty.
  */
  if (items.length === 0) return null;

  return (
    <section className="container-page relative z-10 -mt-14 lg:-mt-20">
      <dl className="stagger-in grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border shadow-lg lg:grid-cols-4">
        {items.map((item) => (
          <div
            key={item.label}
            className="flex flex-col items-center gap-2 bg-surface px-4 py-7 text-center"
          >
            <span
              className="grid size-10 place-items-center rounded-full bg-primary-light text-primary [&>svg]:size-4.5"
              aria-hidden
            >
              {item.icon}
            </span>
            <dd className="tnum font-display text-3xl leading-none font-bold text-text sm:text-4xl">
              {item.value}
            </dd>
            <dt className="text-sm font-medium text-text-secondary">{item.label}</dt>
          </div>
        ))}
      </dl>
    </section>
  );
}

/* ── Alternating feature rows ──────────────────────────────────────────── */

export function FeatureRow({
  icon,
  title,
  description,
  bullets,
  cta,
  reverse = false,
  visual,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  bullets?: string[];
  cta?: { href: string; label: string };
  reverse?: boolean;
  visual: React.ReactNode;
}) {
  return (
    <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-20">
      <div className={cn(reverse && "lg:order-2")}>
        <span
          className="mb-5 grid size-12 place-items-center rounded-md bg-primary-light text-primary [&>svg]:size-5"
          aria-hidden
        >
          {icon}
        </span>
        <h3 className="font-display text-2xl font-bold sm:text-3xl">{title}</h3>
        <p className="mt-3.5 leading-relaxed text-text-secondary">{description}</p>

        {bullets && (
          <ul className="mt-5 flex flex-col gap-2.5">
            {bullets.map((b) => (
              <li key={b} className="flex items-start gap-2.5 text-sm">
                <span
                  className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary"
                  aria-hidden
                />
                <span className="text-text-secondary">{b}</span>
              </li>
            ))}
          </ul>
        )}

        {cta && (
          <Link href={cta.href} className={cn(buttonClasses({ variant: "outline" }), "mt-7")}>
            {cta.label}
          </Link>
        )}
      </div>

      <div
        className={cn(
          "aspect-[4/3] overflow-hidden rounded-xl border border-border",
          reverse && "lg:order-1",
        )}
      >
        {visual}
      </div>
    </div>
  );
}

/* ── How it works ──────────────────────────────────────────────────────── */

export function StepList({
  steps,
  stepLabel = "Étape",
}: {
  steps: { icon: React.ReactNode; title: string; description: string }[];
  /** Translated word for "Step". */
  stepLabel?: string;
}) {
  return (
    <ol className="stagger-in relative grid gap-10 sm:grid-cols-3">
      {/* Connector line, desktop only. Hidden below sm where the steps stack. */}
      <div
        aria-hidden
        className="absolute top-11 right-[16.67%] left-[16.67%] hidden h-px bg-border sm:block"
      />

      {steps.map((step, i) => (
        <li key={step.title} className="relative flex gap-5 text-left sm:flex-col sm:text-center">
          <span className="grid size-16 shrink-0 place-items-center rounded-full border-4 border-bg bg-primary-light text-primary shadow-sm sm:mx-auto sm:size-[5.5rem] [&>svg]:size-6 sm:[&>svg]:size-7">
            {step.icon}
          </span>
          <div>
            <p className="text-[11px] font-bold tracking-[0.1em] text-primary uppercase">
              {stepLabel} {i + 1}
            </p>
            <h3 className="mt-1.5 font-display text-xl font-bold">{step.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-text-secondary">{step.description}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ── Testimonials ──────────────────────────────────────────────────────── */

import { RatingStars } from "@/components/ui/rating-stars";
import { Avatar } from "@/components/ui/avatar";

export function TestimonialGrid({
  items,
}: {
  items: { body: string; name: string; meta: string; rating: number }[];
}) {
  return (
    <div className="stagger-in grid gap-6 md:grid-cols-3">
      {items.map((t) => (
        <figure
          key={t.name}
          className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-7"
        >
          <RatingStars value={t.rating} size="sm" />
          <blockquote className="flex-1 leading-relaxed text-text-secondary italic">
            « {t.body} »
          </blockquote>
          <figcaption className="flex items-center gap-3">
            <Avatar name={t.name} size="md" />
            <span>
              <span className="block text-sm font-semibold">{t.name}</span>
              <span className="block text-xs text-text-light">{t.meta}</span>
            </span>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

/* ── CTA banner ────────────────────────────────────────────────────────── */

export function CtaBanner({
  title,
  description,
  primary,
  secondary,
}: {
  title: string;
  description: string;
  primary: { href: string; label: string };
  secondary?: { href: string; label: string };
}) {
  return (
    <section className="reveal container-page py-16">
      <div className="relative overflow-hidden rounded-xl bg-primary px-6 py-16 text-center text-primary-fg sm:px-12">
        <div
          aria-hidden
          className="absolute -top-20 -right-20 size-72 rounded-full bg-primary-fg/5"
        />
        <div
          aria-hidden
          className="absolute -bottom-24 -left-10 size-64 rounded-full bg-accent/10"
        />

        <div className="relative">
          <h2 className="font-display text-3xl font-bold sm:text-4xl">{title}</h2>
          <p className="mx-auto mt-3 max-w-lg opacity-75">{description}</p>

          <div className="mt-9 flex flex-wrap justify-center gap-4">
            <Link
              href={primary.href}
              className={cn(
                buttonClasses({ size: "lg" }),
                "bg-primary-fg text-primary hover:bg-primary-fg/90",
              )}
            >
              {primary.label}
            </Link>
            {secondary && (
              <Link
                href={secondary.href}
                className={cn(
                  buttonClasses({ variant: "outline", size: "lg" }),
                  "border-primary-fg/30 text-primary-fg hover:border-primary-fg hover:bg-primary-fg/10 hover:text-primary-fg",
                )}
              >
                {secondary.label}
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
