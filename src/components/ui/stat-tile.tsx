import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * KPI tile for the four dashboards.
 *
 * `positiveIsGood` exists because a rising number is not always good news —
 * cancellations and refunds go up, and a green arrow on a growing refund rate
 * is actively misleading.
 */
export function StatTile({
  label,
  value,
  hint,
  icon,
  delta,
  positiveIsGood = true,
  tone = "default",
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: React.ReactNode;
  /** Percentage change vs the previous period. */
  delta?: number;
  positiveIsGood?: boolean;
  tone?: "default" | "primary" | "dark";
  className?: string;
}) {
  const good = delta === undefined ? null : positiveIsGood ? delta >= 0 : delta <= 0;

  return (
    <div
      className={cn(
        "rounded-lg border p-5",
        tone === "dark"
          ? "border-transparent bg-primary text-primary-fg"
          : tone === "primary"
            ? "border-primary/20 bg-primary-light"
            : "border-border bg-surface",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p
          className={cn(
            "text-[11px] font-bold tracking-[0.1em] uppercase",
            tone === "dark" ? "text-primary-fg/70" : "text-text-light",
          )}
        >
          {label}
        </p>
        {icon && (
          <span
            className={cn(
              "shrink-0 [&>svg]:size-4",
              tone === "dark" ? "text-primary-fg/70" : "text-primary",
            )}
            aria-hidden
          >
            {icon}
          </span>
        )}
      </div>

      <p className="tnum mt-2 font-display text-3xl leading-none font-bold">{value}</p>

      <div className="mt-2 flex items-center gap-2">
        {delta !== undefined && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-xs font-semibold",
              good ? "text-success" : "text-error",
            )}
          >
            {delta >= 0 ? (
              <ArrowUpRight className="size-3" aria-hidden />
            ) : (
              <ArrowDownRight className="size-3" aria-hidden />
            )}
            {Math.abs(delta).toFixed(1).replace(".", ",")} %
          </span>
        )}
        {hint && (
          <span
            className={cn(
              "text-xs",
              tone === "dark" ? "text-primary-fg/60" : "text-text-light",
            )}
          >
            {hint}
          </span>
        )}
      </div>
    </div>
  );
}
