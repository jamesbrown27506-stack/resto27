import { cn } from "@/lib/utils";

export type BadgeTone =
  | "neutral"
  | "primary"
  | "accent"
  | "success"
  | "warning"
  | "info"
  | "error";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-text-secondary border-border",
  primary: "bg-primary-light text-primary border-primary/25",
  accent: "bg-accent/15 text-accent-hover border-accent/30",
  success: "bg-success-light text-success border-success/25",
  warning: "bg-warning-light text-warning border-warning/25",
  info: "bg-info-light text-info border-info/25",
  error: "bg-error-light text-error border-error/25",
};

export function Badge({
  tone = "neutral",
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5",
        "text-xs font-semibold whitespace-nowrap",
        TONES[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

/** Small uppercase eyebrow above a section title. */
export function SectionTag({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-block rounded-full bg-primary-light px-3.5 py-1",
        "text-[11px] font-bold tracking-[0.12em] text-primary uppercase",
        className,
      )}
    >
      {children}
    </span>
  );
}
