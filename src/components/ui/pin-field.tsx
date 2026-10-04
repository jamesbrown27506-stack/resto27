"use client";

import { cn } from "@/lib/utils";

/**
 * A 4–6 digit secret code, entered like a phone PIN.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  `type="password"` + `inputMode="numeric"` was not enough: several mobile
 *  keyboards ignore inputMode on a password field and open the full
 *  alphabet, for a code that is only digits. A `type="tel"` input always
 *  opens the number pad — so that is the real field, laid transparently over
 *  six boxes that show a dot per digit typed. The digits themselves are
 *  never drawn on screen, and the field still behaves as one input for
 *  paste, autofill refusal, screen readers and the form.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function PinField({
  id,
  value,
  onChange,
  length = 6,
  invalid = false,
  autoFocus = false,
  "aria-label": ariaLabel,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Boxes drawn — the longest code accepted. */
  length?: number;
  invalid?: boolean;
  autoFocus?: boolean;
  "aria-label"?: string;
}) {
  return (
    <div className="group relative w-full max-w-xs">
      <input
        id={id}
        type="tel"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        maxLength={length}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, length))}
        // Transparent text and caret: the boxes below are what is seen. 16px so
        // iOS does not zoom the page when the field takes focus.
        className="absolute inset-0 z-10 h-full w-full cursor-text bg-transparent text-base text-transparent caret-transparent opacity-0 outline-none"
      />
      {/* Boxes shrink to fit: six of them must sit inside a dialog on a 320px phone. */}
      <div aria-hidden className="flex w-full gap-1.5">
        {Array.from({ length }, (_, index) => {
          const filled = index < value.length;
          const current = index === Math.min(value.length, length - 1);
          return (
            <span
              key={index}
              className={cn(
                "grid h-11 max-w-11 min-w-0 flex-1 place-items-center rounded-md border bg-surface text-xl font-bold transition-colors",
                invalid ? "border-error" : "border-border",
                // The box the next digit goes into lights up while the field has focus.
                current && "group-focus-within:border-primary group-focus-within:ring-2 group-focus-within:ring-primary/20",
              )}
            >
              {filled ? "•" : ""}
            </span>
          );
        })}
      </div>
    </div>
  );
}
