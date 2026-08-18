"use client";

import Link from "next/link";
import { Store, LifeBuoy, ShieldCheck } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/use-locale";

/**
 * Shown when someone reaches /m with no branch to operate.
 *
 * Three distinct causes, and the copy names all three rather than showing one
 * shrug: a manager whose restaurant is still awaiting approval, a manager
 * removed from the last branch they worked at, and an admin who arrived here
 * without starting an impersonation session. Guessing which one it is and
 * showing only that would be wrong more often than it is right.
 */
export function NoBranch({ name, isAdmin }: { name: string; isAdmin: boolean }) {
  const { t } = useLocale();
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center p-6">
      <div className="rounded-lg border border-border bg-surface p-8">
        <span className="grid size-12 place-items-center rounded-full bg-primary-light text-primary">
          <Store className="size-6" aria-hidden />
        </span>

        <h1 className="mt-5 font-display text-2xl font-bold">{t("m.noBranch.title")}</h1>

        <p className="mt-2 text-sm leading-relaxed text-text-secondary">
          {t("m.noBranch.body", { name })}
        </p>

        <ul className="mt-5 flex flex-col gap-3 text-sm text-text-secondary">
          {(isAdmin
            ? [
                {
                  Icon: ShieldCheck,
                  text: t("m.noBranch.admin"),
                },
              ]
            : [
                { Icon: Store, text: t("m.noBranch.pending") },
                { Icon: LifeBuoy, text: t("m.noBranch.removed") },
              ]
          ).map(({ Icon, text }) => (
            <li key={text} className="flex items-start gap-2.5">
              <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <span>{text}</span>
            </li>
          ))}
        </ul>

        <div className="mt-7 flex flex-wrap gap-3">
          <Link href={isAdmin ? "/a/impersonate" : "/contact"} className={buttonClasses()}>
            {isAdmin ? t("m.noBranch.choose") : t("m.noBranch.support")}
          </Link>
          <Link href="/" className={buttonClasses({ variant: "outline" })}>
            {t("m.noBranch.home")}
          </Link>
        </div>
      </div>
    </main>
  );
}
