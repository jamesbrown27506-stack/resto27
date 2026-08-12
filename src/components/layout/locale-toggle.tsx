"use client";

import { Languages } from "lucide-react";
import { useLocale } from "@/lib/i18n/use-locale";
import { LOCALES, LOCALE_LABEL, LOCALE_SHORT } from "@/lib/i18n/dictionaries";
import { cn } from "@/lib/utils";

/**
 * FR / EN switch.
 *
 * Both labels are always visible rather than showing only the inactive one —
 * a single "EN" button is ambiguous about whether it means "you are in
 * English" or "switch to English", and users guess wrong about half the time.
 */
export function LocaleToggle({ className }: { className?: string }) {
  const { locale, setLocale } = useLocale();

  return (
    <div
      role="radiogroup"
      aria-label="Language / Langue"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border border-border bg-surface-2 p-0.5",
        className,
      )}
    >
      <Languages className="ml-1.5 size-3 shrink-0 text-text-light" aria-hidden />
      {LOCALES.map((value) => {
        const active = locale === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={LOCALE_LABEL[value]}
            title={LOCALE_LABEL[value]}
            onClick={() => setLocale(value)}
            className={cn(
              "rounded-full px-2 py-1 text-[11px] font-bold transition-colors",
              active
                ? "bg-primary text-primary-fg"
                : "text-text-light hover:bg-border/40 hover:text-text",
            )}
          >
            {LOCALE_SHORT[value]}
          </button>
        );
      })}
    </div>
  );
}
