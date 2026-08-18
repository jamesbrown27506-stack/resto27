"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Check, Clock, Eye, EyeOff, Info, X } from "lucide-react";
import { Input, type InputProps } from "@/components/ui/input";
import { useLocale } from "@/lib/i18n/use-locale";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { cn } from "@/lib/utils";

/* ── Page heading ──────────────────────────────────────────────────────── */

export function AuthHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-7">
      <h1 className="font-display text-3xl font-bold">{title}</h1>
      {subtitle && <p className="mt-2 text-sm leading-relaxed text-text-secondary">{subtitle}</p>}
    </div>
  );
}

/* ── Login failure reasons ─────────────────────────────────────────────── */

/**
 * §14.2: login returns a SPECIFIC reason on failure — invalid / pending /
 * pending-manager / suspended.
 *
 * This looks like an information leak and is not: the credentials have already
 * been proven correct in every case except `invalid`, so naming the reason
 * tells the user nothing an attacker could not already establish. What it does
 * change is whether a restaurant applicant waits patiently or concludes we
 * lost their registration.
 */
export type LoginReason = "invalid" | "pending" | "pending-manager" | "suspended";

const REASON_TONES: Record<LoginReason, "error" | "warning" | "info"> = {
  invalid: "error",
  pending: "info",
  "pending-manager": "info",
  suspended: "error",
};

const REASON_ICONS: Record<LoginReason, typeof AlertTriangle> = {
  invalid: X,
  pending: Clock,
  "pending-manager": Clock,
  suspended: AlertTriangle,
};

export function LoginReasonAlert({ reason }: { reason: LoginReason }) {
  const { t } = useLocale();
  const tone = REASON_TONES[reason];
  const Icon = REASON_ICONS[reason];
  const title = t(`auth.reason.${reason}.title` as TranslationKey);
  const body = t(`auth.reason.${reason}.body` as TranslationKey);

  return (
    <div
      role="alert"
      className={cn(
        "mb-5 flex items-start gap-3 rounded-md border p-3.5",
        tone === "error" && "border-error/30 bg-error-light text-error",
        tone === "warning" && "border-warning/30 bg-warning-light text-warning",
        tone === "info" && "border-info/30 bg-info-light text-info",
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 text-sm">
        <p className="font-semibold">{title}</p>
        <p className="mt-0.5 leading-relaxed opacity-85">{body}</p>
      </div>
    </div>
  );
}

/* ── Info / success notice ─────────────────────────────────────────────── */

export function AuthNotice({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "success" | "warning" | "error";
  title: string;
  children?: React.ReactNode;
}) {
  const TONES = {
    info: { cls: "border-info/30 bg-info-light text-info", Icon: Info },
    success: { cls: "border-success/30 bg-success-light text-success", Icon: Check },
    warning: { cls: "border-warning/30 bg-warning-light text-warning", Icon: AlertTriangle },
    error: { cls: "border-error/30 bg-error-light text-error", Icon: X },
  } as const;

  const { cls, Icon } = TONES[tone];

  return (
    <div role="status" className={cn("flex items-start gap-3 rounded-md border p-4", cls)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 text-sm">
        <p className="font-semibold">{title}</p>
        {children && <div className="mt-1 leading-relaxed opacity-85">{children}</div>}
      </div>
    </div>
  );
}

/* ── Password input with reveal ────────────────────────────────────────── */

export function PasswordInput({ id, ...props }: InputProps) {
  const { t } = useLocale();
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input id={id} type={visible ? "text" : "password"} className="pr-11" {...props} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? t("auth.hidePassword") : t("auth.showPassword")}
        aria-pressed={visible}
        className="absolute top-1/2 right-3 -translate-y-1/2 rounded p-1 text-text-light transition-colors hover:text-text"
      >
        {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
    </div>
  );
}

/* ── Password strength ─────────────────────────────────────────────────── */

const RULE_KEYS: { key: TranslationKey; test: (v: string) => boolean }[] = [
  { key: "auth.pw.min", test: (v) => v.length >= 8 },
  { key: "auth.pw.upper", test: (v) => /[A-ZÀ-Þ]/.test(v) },
  { key: "auth.pw.digit", test: (v) => /\d/.test(v) },
  { key: "auth.pw.special", test: (v) => /[^\w\s]/.test(v) },
];

/**
 * Shows which rules are met rather than a single "weak/strong" bar.
 *
 * A bar tells someone their password is weak; it does not tell them what to
 * add. The checklist is also what the server enforces, so the two cannot drift.
 */
export function PasswordStrength({ value }: { value: string }) {
  const { t } = useLocale();
  const results = useMemo(
    () => RULE_KEYS.map((r) => ({ ...r, label: t(r.key), ok: r.test(value) })),
    [value, t],
  );
  const met = results.filter((r) => r.ok).length;

  return (
    <div className="mt-2">
      <div className="flex gap-1" aria-hidden>
        {RULE_KEYS.map((_, i) => (
          <span
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors",
              i < met
                ? met <= 2
                  ? "bg-error"
                  : met === 3
                    ? "bg-warning"
                    : "bg-success"
                : "bg-border",
            )}
          />
        ))}
      </div>

      {/*
        NOTE THE <span> AROUND r.label — it is load-bearing.

        A conditionally-rendered element sitting next to a BARE TEXT NODE is
        the single most reliable way to crash React under browser
        auto-translation. The translator replaces the text node with a <font>
        wrapper; React still holds the original node, and the moment the
        condition flips it calls insertBefore against a node that is no longer
        a child — "NotFoundError: Failed to execute 'insertBefore'".

        This exact list was the reproduction: typing a digit flips the
        "un chiffre" rule, React swaps the placeholder dot for the tick, and
        the page dies. Wrapping the label gives React an element to reconcile
        against instead of a text node the translator owns.
      */}
      <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
        {results.map((r) => (
          <li
            key={r.label}
            className={cn(
              "flex items-center gap-1.5 text-xs transition-colors",
              r.ok ? "text-success" : "text-text-light",
            )}
          >
            {/* Same element type in both branches, so React updates the class
                rather than replacing the node at all. */}
            <span
              aria-hidden
              className={cn(
                "grid size-3 shrink-0 place-items-center rounded-full",
                r.ok ? "" : "border border-current opacity-40",
              )}
            >
              {r.ok && <Check className="size-3" />}
            </span>
            <span>{r.label}</span>
          </li>
        ))}
      </ul>

      {/* Built as one string, not interpolated fragments — several adjacent
          text nodes in a live region is the same hazard in miniature. */}
      <p className="sr-only" aria-live="polite">
        {t("auth.pw.sr", { met, total: RULE_KEYS.length })}
      </p>
    </div>
  );
}

export function passwordMeetsPolicy(value: string): boolean {
  return RULE_KEYS.every((r) => r.test(value));
}
