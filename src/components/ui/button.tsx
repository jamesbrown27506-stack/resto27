import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "outline"
  | "ghost"
  | "danger"
  | "accent"
  | "link";

export type ButtonSize = "sm" | "md" | "lg" | "icon" | "icon-sm";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-fg hover:bg-primary-hover shadow-sm",
  secondary: "bg-surface-2 text-text border border-border hover:border-border-strong",
  outline: "bg-transparent text-text border border-border hover:border-primary hover:text-primary",
  ghost: "bg-transparent text-text-secondary hover:bg-primary-light hover:text-primary",
  danger: "bg-error text-white hover:brightness-110 shadow-sm",
  accent: "bg-accent text-accent-fg hover:bg-accent-hover shadow-sm",
  link: "bg-transparent text-primary underline-offset-4 hover:underline p-0 h-auto",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3.5 text-[13px] gap-1.5",
  md: "h-10 px-5 text-sm gap-2",
  lg: "h-12 px-8 text-base gap-2.5",
  icon: "size-10 p-0",
  "icon-sm": "size-8 p-0",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  fullWidth = false,
  className,
  children,
  disabled,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      // A loading button stays disabled so a double-tap cannot fire a second
      // order or a second payment. aria-busy tells screen readers why.
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold whitespace-nowrap",
        "transition-all duration-200 active:scale-[.98]",
        "disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100",
        VARIANTS[variant],
        SIZES[size],
        /*
          `shrink` UNDOES THE BASE `shrink-0`, AND IT MUST.

          Every button is `shrink-0` so an icon-only one is never squashed to
          an ellipse. But a fullWidth button ALSO asks for `w-full` — 100% of
          its container — and the two together in a flex row ("← Back" beside
          "Continue →") demand back-button-width PLUS the full container width.
          The row overflows, and the whole page scrolls sideways on a phone.

          tailwind-merge keeps only the last rule of the flex-shrink group, so
          this wins for exactly the buttons that need it and nothing else.
        */
        fullWidth && "w-full shrink",
        className,
      )}
      {...props}
    >
      {/*
        The spinner is ALWAYS rendered and toggled with CSS, never conditionally
        mounted.

        `{loading && <Loader2/>}` sitting next to `{children}` is the pattern
        that crashes React under browser auto-translation: the translator turns
        the button's text into a <font> element, and the moment `loading` flips
        React calls insertBefore against a text node that no longer exists —
        "NotFoundError: Failed to execute 'insertBefore'".

        Every form in the app submits through this button, so getting it wrong
        here would break translation everywhere at once. `display:none` also
        removes it from flex layout and from the gap, so nothing shifts.
      */}
      <span
        aria-hidden
        className={cn("shrink-0", loading ? "inline-flex" : "hidden")}
      >
        <Loader2 className="size-4 animate-spin" />
      </span>
      {children}
    </button>
  );
}

/**
 * Anchor styled as a button. Separate component rather than an `asChild` prop
 * so a link stays a link — it must be middle-clickable and copyable, which a
 * <button> with an onClick is not.
 */
export interface ButtonLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

export function buttonClasses({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className,
}: Pick<ButtonLinkProps, "variant" | "size" | "fullWidth" | "className"> = {}) {
  return cn(
    "inline-flex shrink-0 items-center justify-center rounded-full font-semibold whitespace-nowrap",
    "transition-all duration-200 active:scale-[.98]",
    VARIANTS[variant],
    SIZES[size],
    // Same reasoning as Button above: a full-width link in a flex row must be
    // allowed to shrink, or the row overflows the viewport.
    fullWidth && "w-full shrink",
    className,
  );
}
