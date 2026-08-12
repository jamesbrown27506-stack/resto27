"use client";

import { intlLocale, useLocale } from "@/lib/i18n/use-locale";
import { cn } from "@/lib/utils";
import { formatLimit, usageRatio } from "@/lib/format/subscription";

/**
 * Usage against a plan limit — the control that tells a tenant they are about
 * to hit the ceiling (§5). Turns amber at 80% and red at 100% so the wall
 * arrives with warning rather than as a refusal at the point of action.
 *
 * An unlimited plan renders an empty bar, never a full one: a maxed-out meter
 * on an Enterprise plan reads as "you are out of room" and is exactly wrong.
 */
export function UsageMeter({
  label,
  used,
  limit,
  className,
}: {
  label: string;
  used: number;
  /** null = unlimited */
  limit: number | null;
  className?: string;
}) {
  const { locale } = useLocale();
  const tag = intlLocale(locale);

  const ratio = usageRatio(used, limit);
  const pct = Math.round(ratio * 100);
  const tone = limit === null ? "ok" : ratio >= 1 ? "over" : ratio >= 0.8 ? "near" : "ok";

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium text-text">{label}</span>
        <span
          className={cn(
            "tnum font-semibold",
            tone === "over" ? "text-error" : tone === "near" ? "text-warning" : "text-text-secondary",
          )}
        >
          <span>{used.toLocaleString(tag)}</span>
          <span> / </span>
          <span>{formatLimit(limit, tag)}</span>
        </span>
      </div>
      <div
        role="meter"
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={limit ?? undefined}
        aria-label={label}
        className="h-1.5 w-full overflow-hidden rounded-full bg-border"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500",
            tone === "over" ? "bg-error" : tone === "near" ? "bg-warning" : "bg-primary",
          )}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}

/** Plain progress bar — order preparation, upload, generic percentages. */
export function ProgressBar({
  value,
  tone = "primary",
  className,
  label,
}: {
  /** 0–100 */
  value: number;
  tone?: "primary" | "success" | "warning" | "error";
  className?: string;
  label?: string;
}) {
  const bg = {
    primary: "bg-primary",
    success: "bg-success",
    warning: "bg-warning",
    error: "bg-error",
  }[tone];

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-border", className)}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-500", bg)}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}
