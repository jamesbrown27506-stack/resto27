"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

/* ── Field wrapper ─────────────────────────────────────────────────────── */

export interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function Field({ label, htmlFor, hint, error, required, className, children }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {/* Label text wrapped, so the required marker is never a conditional
          element sitting beside a bare text node — see button.tsx for why
          that combination breaks under browser auto-translation. */}
      <label
        htmlFor={htmlFor}
        className="text-[11px] font-bold tracking-[0.08em] text-text-light uppercase"
      >
        <span>{label}</span>
        {required && (
          <span className="ml-0.5 text-error" aria-hidden>
            *
          </span>
        )}
      </label>
      {children}
      {/* role="alert" so a validation failure is announced, not just coloured. */}
      {error ? (
        <p role="alert" className="text-xs font-medium text-error">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-text-light">{hint}</p>
      ) : null}
    </div>
  );
}

/* ── Shared control chrome ─────────────────────────────────────────────── */

/*
  `.soft-field` is the mobile-only concave well (globals.css): below `sm`
  every input, textarea and select is a place things are typed INTO, the
  physical opposite of the raised buttons beside them. Focus and error
  states sit above it — see the note in globals.css for why there is no
  `.soft-field:focus` rule.
*/
const CONTROL = [
  "soft-field w-full rounded-md border bg-surface-2 text-sm text-text",
  "placeholder:text-text-light",
  "transition-colors duration-200",
  "focus:outline-none focus-visible:outline-none",
  "focus:border-primary focus:ring-[3px] focus:ring-primary/15",
  "disabled:cursor-not-allowed disabled:opacity-60",
].join(" ");

/* ── Input ─────────────────────────────────────────────────────────────── */

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode;
  invalid?: boolean;
  /** Trailing unit or affix, e.g. "FCFA". */
  suffix?: string;
}

export function Input({ icon, invalid, suffix, className, ...props }: InputProps) {
  if (!icon && !suffix) {
    return (
      <input
        aria-invalid={invalid || undefined}
        className={cn(
          CONTROL,
          "h-11 px-3.5",
          invalid ? "border-error" : "border-border",
          className,
        )}
        {...props}
      />
    );
  }

  return (
    <div
      className={cn(
        CONTROL,
        "flex h-11 items-center gap-2.5 px-3.5",
        "focus-within:border-primary focus-within:ring-[3px] focus-within:ring-primary/15",
        invalid ? "border-error" : "border-border",
        className,
      )}
    >
      {icon && (
        <span className="shrink-0 text-primary [&>svg]:size-4" aria-hidden>
          {icon}
        </span>
      )}
      <input
        aria-invalid={invalid || undefined}
        className="w-full border-none bg-transparent text-sm text-text outline-none placeholder:text-text-light"
        {...props}
      />
      {suffix && <span className="shrink-0 text-xs font-semibold text-text-light">{suffix}</span>}
    </div>
  );
}

/* ── Textarea ──────────────────────────────────────────────────────────── */

export function Textarea({
  invalid,
  className,
  rows = 4,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(
        CONTROL,
        "resize-y px-3.5 py-2.5 leading-relaxed",
        invalid ? "border-error" : "border-border",
        className,
      )}
      {...props}
    />
  );
}

/* ── Select ────────────────────────────────────────────────────────────── */

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export function Select({ invalid, className, children, ...props }: SelectProps) {
  return (
    <div className="relative">
      <select
        aria-invalid={invalid || undefined}
        className={cn(
          CONTROL,
          "h-11 cursor-pointer appearance-none py-0 pr-9 pl-3.5",
          invalid ? "border-error" : "border-border",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <svg
        className="pointer-events-none absolute top-1/2 right-3.5 size-3.5 -translate-y-1/2 text-text-light"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        aria-hidden
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  );
}

/* ── Checkbox / Radio ──────────────────────────────────────────────────── */

/** `type` is omitted: the wrapper owns it, and a caller passing type="number"
 *  would silently produce a text box styled as a checkbox row. */
export interface ToggleControlProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: React.ReactNode;
  description?: string;
  /** Trailing content — a price delta on a modifier option, for instance. */
  trailing?: React.ReactNode;
}

/**
 * Real <input type="checkbox"|"radio"> under the styling, not a div with an
 * aria-role. The PHP version used styled divs for the cuisine pills, which
 * meant no keyboard operation, no state announcement and nothing submitted
 * without JS.
 */
function ToggleControl({
  type,
  label,
  description,
  trailing,
  className,
  ...props
}: ToggleControlProps & { type: "checkbox" | "radio" }) {
  const id = useId();
  const inputId = props.id ?? id;

  return (
    <label
      htmlFor={inputId}
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-md border border-border bg-surface-2 p-3",
        "transition-colors hover:border-border-strong",
        "has-checked:border-primary has-checked:bg-primary-light",
        "has-disabled:cursor-not-allowed has-disabled:opacity-55",
        /*
          The soft material, phone-only like `.soft-press`: raised at rest,
          concave while checked — a checked box is a held-down one. The
          shadows are written as utilities rather than plain CSS so they sit
          in the same cascade as the checked and disabled states, and
          `has-disabled` wins over both without an arms race.
        */
        "max-sm:shadow-[-2px_-2px_5px_var(--soft-hi),3px_3px_7px_var(--soft-lo)]",
        "has-checked:max-sm:shadow-[inset_2px_2px_5px_var(--soft-lo),inset_-1px_-1px_4px_var(--soft-hi)]",
        "has-disabled:max-sm:shadow-none",
        className,
      )}
    >
      <input
        id={inputId}
        type={type}
        className={cn(
          "mt-0.5 size-4 shrink-0 accent-[var(--primary)]",
          type === "radio" ? "rounded-full" : "rounded-sm",
        )}
        {...props}
      />
      <span className="flex-1 text-sm leading-snug">
        <span className="font-medium text-text">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-text-light">{description}</span>}
      </span>
      {trailing && <span className="shrink-0 text-sm font-semibold text-primary">{trailing}</span>}
    </label>
  );
}

export function Checkbox(props: ToggleControlProps) {
  return <ToggleControl type="checkbox" {...props} />;
}

export function Radio(props: ToggleControlProps) {
  return <ToggleControl type="radio" {...props} />;
}

/* ── Switch ────────────────────────────────────────────────────────────── */

export function Switch({
  label,
  description,
  className,
  children,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  description?: string;
  /**
   * A small icon shown before the label. For a row of switches that repeat the
   * same few names — in-app, email, push, once per topic — the glyph is what
   * makes the column scannable; the word stays, because an icon alone is a
   * guess.
   */
  children?: React.ReactNode;
}) {
  const id = useId();
  const inputId = props.id ?? id;

  return (
    <label htmlFor={inputId} className={cn("flex cursor-pointer items-center gap-3", className)}>
      <span className="relative inline-flex shrink-0">
        <input id={inputId} type="checkbox" className="peer sr-only" {...props} />
        {/* The track is a shallow well on phones — the knob is the one raised thing. */}
        <span className="block h-6 w-11 rounded-full bg-border transition-colors peer-checked:bg-primary peer-disabled:opacity-50 max-sm:shadow-[inset_1px_2px_3px_var(--soft-lo)]" />
        <span className="pointer-events-none absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5" />
      </span>
      <span className={cn("flex-1", props.disabled && "opacity-60")}>
        <span className="flex items-center gap-1.5 text-sm font-medium text-text">
          {children}
          {label}
        </span>
        {description && <span className="block text-xs text-text-light">{description}</span>}
      </span>
    </label>
  );
}
