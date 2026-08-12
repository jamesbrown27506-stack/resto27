"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

const SIZES = { sm: "size-3", md: "size-4", lg: "size-6" } as const;

/**
 * Read-only rating. Rendered as a single accessible label rather than five
 * icons, so a screen reader announces "4,5 sur 5" instead of five stars.
 */
export function RatingStars({
  value,
  size = "md",
  showValue = false,
  count,
  className,
}: {
  value: number;
  size?: keyof typeof SIZES;
  showValue?: boolean;
  /** Number of reviews, shown as "(24)". */
  count?: number;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <span className="inline-flex" role="img" aria-label={`${value.toFixed(1)} sur 5`}>
        {[0, 1, 2, 3, 4].map((i) => {
          const fill = Math.max(0, Math.min(1, value - i));
          return (
            <span key={i} className="relative inline-block" aria-hidden>
              <Star className={cn(SIZES[size], "text-border")} />
              {fill > 0 && (
                <span
                  className="absolute inset-0 overflow-hidden"
                  style={{ width: `${fill * 100}%` }}
                >
                  <Star className={cn(SIZES[size], "fill-accent text-accent")} />
                </span>
              )}
            </span>
          );
        })}
      </span>
      {showValue && (
        <span className="tnum text-sm font-semibold">{value.toFixed(1).replace(".", ",")}</span>
      )}
      {count !== undefined && <span className="text-xs text-text-light">({count})</span>}
    </span>
  );
}

/** Editable rating — real radio inputs so it works by keyboard and without JS. */
export function RatingInput({
  name,
  value,
  onChange,
  size = "lg",
  className,
}: {
  name: string;
  value: number;
  onChange: (value: number) => void;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;

  return (
    <fieldset className={cn("inline-flex items-center gap-1", className)} onMouseLeave={() => setHover(0)}>
      <legend className="sr-only">Note sur 5</legend>
      {[1, 2, 3, 4, 5].map((star) => (
        <label
          key={star}
          className="cursor-pointer p-0.5"
          onMouseEnter={() => setHover(star)}
          title={`${star} étoile${star > 1 ? "s" : ""}`}
        >
          <input
            type="radio"
            name={name}
            value={star}
            checked={value === star}
            onChange={() => onChange(star)}
            className="sr-only"
          />
          <Star
            className={cn(
              SIZES[size],
              "transition-colors",
              star <= shown ? "fill-accent text-accent" : "text-border",
            )}
            aria-hidden
          />
          <span className="sr-only">{star} étoiles</span>
        </label>
      ))}
    </fieldset>
  );
}
