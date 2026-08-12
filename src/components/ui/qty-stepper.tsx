"use client";

import { Minus, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Quantity control for cart lines and table-side ordering.
 *
 * At quantity 1 the decrement button becomes a bin: "− then gone" is a two-step
 * interaction where the second step is destructive and unlabelled. Showing the
 * bin makes the consequence visible before the tap.
 */
export function QtyStepper({
  value,
  onChange,
  onRemove,
  min = 1,
  max = 99,
  size = "md",
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  /** When provided, decrementing below `min` calls this instead. */
  onRemove?: () => void;
  min?: number;
  max?: number;
  size?: "sm" | "md";
  className?: string;
}) {
  const atMin = value <= min;
  const showBin = atMin && Boolean(onRemove);
  const btn =
    size === "sm"
      ? "size-7 [&>svg]:size-3"
      : "size-9 [&>svg]:size-3.5";

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border border-border bg-surface-2",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => (showBin ? onRemove?.() : onChange(value - 1))}
        disabled={atMin && !onRemove}
        aria-label={showBin ? "Retirer l'article" : "Diminuer la quantité"}
        className={cn(
          "grid shrink-0 place-items-center rounded-full transition-colors",
          btn,
          showBin
            ? "text-error hover:bg-error-light"
            : "text-text-secondary hover:bg-border/50 disabled:pointer-events-none disabled:opacity-40",
        )}
      >
        {showBin ? <Trash2 aria-hidden /> : <Minus aria-hidden />}
      </button>

      <span
        className={cn(
          "tnum min-w-7 text-center font-semibold",
          size === "sm" ? "text-xs" : "text-sm",
        )}
        aria-live="polite"
        aria-label={`Quantité : ${value}`}
      >
        {value}
      </span>

      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={value >= max}
        aria-label="Augmenter la quantité"
        className={cn(
          "grid shrink-0 place-items-center rounded-full text-text-secondary transition-colors hover:bg-border/50",
          "disabled:pointer-events-none disabled:opacity-40",
          btn,
        )}
      >
        <Plus aria-hidden />
      </button>
    </div>
  );
}
