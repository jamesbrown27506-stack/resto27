"use client";

import { cn } from "@/lib/utils";
import { Delete } from "lucide-react";
import { useLocale } from "@/lib/i18n/use-locale";
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH } from "@/lib/wallet/withdraw-rules";

/**
 * A secret code with its own numeric keypad.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  Some Android keyboards/WebViews ignore numeric input hints, including
 *  type=tel. A read-only field prevents the system keyboard from opening;
 *  the visible keypad has only digits and backspace. Physical keyboards and
 *  paste still work. No code is submitted until the person confirms the
 *  operation. Unknown legacy lengths expand from four to six boxes as typed.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function PinField({
  id,
  value,
  onChange,
  length,
  invalid = false,
  autoFocus = false,
  "aria-label": ariaLabel,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Known length, or automatic entry for a legacy code without metadata. */
  length?: 4 | 5 | 6;
  invalid?: boolean;
  autoFocus?: boolean;
  "aria-label"?: string;
}) {
  const { t } = useLocale();
  const maximum = length ?? PIN_MAX_LENGTH;
  const boxes = length ?? Math.max(PIN_MIN_LENGTH, value.length);
  const change = (next: string) => onChange(next.replace(/\D/g, "").slice(0, maximum));
  return (
    <div className="w-full max-w-xs space-y-3">
      <div className="group relative">
      <input
        id={id}
        type="password"
        readOnly
        inputMode="none"
        pattern={length ? `[0-9]{${length}}` : `[0-9]{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}`}
        minLength={length ?? PIN_MIN_LENGTH}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        maxLength={maximum}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        value={value}
        onKeyDown={(event) => {
          if (event.ctrlKey || event.metaKey || event.altKey) return;
          if (/^[0-9]$/.test(event.key)) {
            event.preventDefault();
            change(value + event.key);
          } else if (event.key === "Backspace" || event.key === "Delete") {
            event.preventDefault();
            change(value.slice(0, -1));
          }
        }}
        onPaste={(event) => {
          event.preventDefault();
          change(event.clipboardData.getData("text"));
        }}
        // Transparent text and caret: the boxes below are what is seen. 16px so
        // iOS does not zoom the page when the field takes focus.
        className="absolute inset-0 z-10 h-full w-full cursor-text bg-transparent text-base text-transparent caret-transparent opacity-0 outline-none"
      />
      {/* Boxes shrink to fit: six of them must sit inside a dialog on a 320px phone. */}
      <div aria-hidden className="flex w-full gap-1.5">
        {Array.from({ length: boxes }, (_, index) => {
          const filled = index < value.length;
          const current = index === Math.min(value.length, boxes - 1);
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
      <div role="group" aria-label={t("mwd.pin.keypad")} className="grid grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
          <button key={digit} type="button" aria-controls={id}
            onClick={() => change(value + digit)}
            className="min-h-11 rounded-md border border-border bg-surface-2 text-xl font-semibold text-text transition-colors hover:border-primary active:bg-primary-light focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none">
            {digit}
          </button>
        ))}
        <span aria-hidden />
        <button type="button" aria-controls={id} onClick={() => change(value + "0")}
          className="min-h-11 rounded-md border border-border bg-surface-2 text-xl font-semibold text-text transition-colors hover:border-primary active:bg-primary-light focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none">0</button>
        <button type="button" aria-controls={id} aria-label={t("mwd.pin.erase")}
          onClick={() => change(value.slice(0, -1))}
          className="grid min-h-11 place-items-center rounded-md border border-border bg-surface-2 text-text transition-colors hover:border-primary active:bg-primary-light focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none">
          <Delete className="size-5" aria-hidden />
        </button>
      </div>
    </div>
  );
}
