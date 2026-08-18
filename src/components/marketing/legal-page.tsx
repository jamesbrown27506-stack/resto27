"use client";

import { formatDate } from "@/lib/format/datetime";
import { useLocale } from "@/lib/i18n/use-locale";

export interface LegalSection {
  id: string;
  heading: string;
  paragraphs: string[];
}

/**
 * Shared shell for /privacy and /terms.
 *
 * The brand name is passed in rather than hardcoded (§14.1) — once P2's
 * `lib/branding` exists it comes from settings, so renaming the platform
 * renames the legal pages too instead of leaving the old name in the one place
 * nobody re-reads.
 */
export function LegalPage({
  title,
  intro,
  updatedAt,
  sections,
}: {
  title: string;
  intro: string;
  updatedAt: string;
  sections: LegalSection[];
}) {
  const { t } = useLocale();
  return (
    <div className="container-page py-14 lg:py-20">
      <header className="max-w-2xl">
        <h1 className="font-display text-4xl font-bold sm:text-5xl">{title}</h1>
        <p className="mt-4 text-lg text-text-secondary">{intro}</p>
        <p className="mt-3 text-sm text-text-light">
          {t("leg.shell.updated")} <time dateTime={updatedAt}>{formatDate(updatedAt)}</time>
        </p>
      </header>

      <div className="mt-12 grid gap-12 lg:grid-cols-[16rem_1fr]">
        <nav aria-label={t("leg.shell.tocAria")} className="lg:sticky lg:top-24 lg:self-start">
          <h2 className="text-[11px] font-bold tracking-[0.12em] text-text-light uppercase">
            {t("leg.shell.toc")}
          </h2>
          <ol className="mt-3 flex flex-col gap-1.5">
            {sections.map((s, i) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="flex gap-2 text-sm text-text-secondary transition-colors hover:text-primary"
                >
                  <span className="tnum text-text-light">{i + 1}.</span>
                  {s.heading}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="min-w-0 max-w-2xl">
          {sections.map((section, i) => (
            <section key={section.id} id={section.id} className="mb-10">
              <h2 className="font-display text-xl font-bold">
                <span className="tnum mr-2 text-text-light">{i + 1}.</span>
                {section.heading}
              </h2>
              {section.paragraphs.map((p, j) => (
                <p key={j} className="mt-3 leading-relaxed text-text-secondary">
                  {p}
                </p>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
