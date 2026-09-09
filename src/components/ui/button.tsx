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

/*
  HEIGHTS ARE TOUCH TARGETS, NOT DECORATION.

  These were 32 / 40 / 48px. The middle one is the default, so the great
  majority of the app's buttons — "Sign out", "Cancel", "Keep browsing",
  "Finalize order" — were 40px tall on a phone, under both platform minimums
  (44px on iOS, 48dp on Android) and visibly slimmer than the fields above
  them. A button that is hard to hit accurately is read as a button that does
  not work, and the two places it hurt most were exactly the ones you cannot
  retry cheaply: a confirmation and a basket.

  `min-h` rather than `h` so a label that has to wrap — a long French action
  name in a two-up dialog footer on a 360px screen — GROWS the button instead
  of spilling out of it. The height is a floor, not a ceiling.
*/
const SIZES: Record<ButtonSize, string> = {
  sm: "min-h-9 px-4 py-1.5 text-[13px] gap-1.5",
  md: "min-h-11 px-5 py-2 text-sm gap-2",
  lg: "min-h-13 px-8 py-2.5 text-base gap-2.5",
  icon: "size-11 p-0",
  "icon-sm": "size-9 p-0",
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
        /*
          The tactile press treatment, which is a no-op above `sm` — see
          `.soft-press` in globals.css for why it is phone-only. `link` opts
          out: it is text, and extruding a sentence is nonsense.
        */
        variant !== "link" && "soft-press",
        "disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100",
        VARIANTS[variant],
        SIZES[size],
        // `link` is text, not a control surface: it opts out of the touch
        // target the sizes impose, which its own `h-auto p-0` always meant to.
        variant === "link" && "min-h-0 p-0",
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
    variant === "link" && "min-h-0 p-0",
    // Same reasoning as Button above: a full-width link in a flex row must be
    // allowed to shrink, or the row overflows the viewport.
    fullWidth && "w-full shrink",
    className,
  );
}
