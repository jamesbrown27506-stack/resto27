"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "./button";
import { Input } from "./input";
import { useLocale } from "@/lib/i18n/use-locale";
import { cn } from "@/lib/utils";

/**
 * Built on the native <dialog> element rather than a div-and-portal.
 *
 * `showModal()` gives us focus trapping, Escape-to-close, inertness of the
 * background and ::backdrop for free — all things a hand-rolled modal gets
 * subtly wrong. More importantly it renders in the browser's TOP LAYER, which
 * is outside the normal containing-block chain: an ancestor with a transform,
 * a filter or a backdrop-filter cannot capture it.
 *
 * That is the structural fix for the bug documented in the PHP homepage, where
 * `backdrop-filter` on the topbar made it the containing block for the fixed
 * mobile drawer and collapsed the whole menu to a sliver.
 */

export type DialogSize = "sm" | "md" | "lg" | "xl";

const SIZES: Record<DialogSize, string> = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  size?: DialogSize;
  /** Hide the × and ignore backdrop clicks — for flows that must be resolved. */
  mandatory?: boolean;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  size = "md",
  mandatory = false,
  footer,
  children,
}: DialogProps) {
  const { t } = useLocale();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  // showModal() does not reliably stop the page behind from scrolling on iOS.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      // Fires on Escape too, so React state stays in sync with the element.
      onClose={onClose}
      onCancel={(e) => {
        if (mandatory) e.preventDefault();
      }}
      // A click on the backdrop targets the <dialog> itself; a click on the
      // content targets a child. That distinction is the whole hit test.
      onClick={(e) => {
        if (!mandatory && e.target === ref.current) onClose();
      }}
      aria-labelledby="dialog-title"
      className={cn(
        /*
          `m-auto` IS THE CENTRING, and it has to be said out loud.

          The UA stylesheet centres a modal <dialog> with `margin: auto`
          against `inset: 0`. Tailwind's Preflight then sets `margin: 0` on
          every element, which silently kills it — the dialog collapses into
          the top-left corner. It reads as "slightly off" on a wide screen and
          as plainly broken on a phone, where the panel is nearly as wide as
          the viewport and the offset is the whole story.
        */
        "m-auto w-[calc(100vw-2rem)] rounded-lg border border-border bg-surface p-0 text-text shadow-lg",
        /*
          `open:flex`, NEVER a bare `flex`. This one is a trap.

          The browser hides a closed dialog with `dialog:not([open]) { display:
          none }` in its USER-AGENT stylesheet. Author styles beat user-agent
          styles on cascade ORIGIN, before specificity is even consulted — so a
          plain `flex` here silently defeats that rule and every dialog in the
          app renders open, on load, with no interaction. Confirmations,
          delivery-fee prompts, the sign-out check: all of them, all at once.

          Gating the display utility on `[open]` means the closed state has no
          author display rule at all, so the user-agent rule applies and the
          dialog stays hidden until showModal() runs.

          Capped to the viewport and laid out as a column so the title and the
          footer buttons stay on screen and the BODY is what scrolls — without
          the cap a long dialog runs off the bottom of a phone and its confirm
          button becomes unreachable.
        */
        "max-h-[calc(100dvh-2rem)] flex-col open:flex",
        "backdrop:bg-black/50 backdrop:backdrop-blur-sm",
        "open:animate-rise",
        SIZES[size],
      )}
    >
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border p-5">
        <div>
          <h2 id="dialog-title" className="font-display text-xl font-bold">
            {title}
          </h2>
          {description && <p className="mt-1 text-sm text-text-secondary">{description}</p>}
        </div>
        {!mandatory && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="-mt-1 -mr-1 shrink-0 rounded-full p-1.5 text-text-light transition-colors hover:bg-surface-2 hover:text-text"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">{children}</div>

      {footer && (
        /*
          `flex-col-reverse` below `sm` puts the CONFIRM on top, nearest the
          thumb, with cancel beneath it — the same rule SheetActions follows.
          Side by side on a phone the pair either overflows or shrinks both
          buttons to something too small to hit accurately.
        */
        <div
          className="flex shrink-0 flex-col-reverse gap-3 border-t border-border bg-surface-2 p-5 *:flex-1 sm:flex-row sm:flex-wrap sm:justify-end sm:*:flex-none"
          style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom, 0px))" }}
        >
          {footer}
        </div>
      )}
    </dialog>
  );
}

/* ── Confirmation ──────────────────────────────────────────────────────── */

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive = false,
  loading = false,
}: ConfirmDialogProps) {
  const { t } = useLocale();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            {cancelLabel ?? t("common.cancel")}
          </Button>
          <Button variant={destructive ? "danger" : "primary"} onClick={onConfirm} loading={loading}>
            {confirmLabel ?? t("common.confirm")}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-text-secondary">{message}</p>
    </Dialog>
  );
}

/* ── Typed confirmation ────────────────────────────────────────────────── */

export interface TypedConfirmDialogProps extends Omit<ConfirmDialogProps, "destructive"> {
  /** The exact string the user must type. Case-sensitive. */
  phrase: string;
  hint?: string;
}

/**
 * For the handful of actions where an accidental click is unrecoverable:
 * creating another platform administrator (§14.5), anonymising a user, and
 * deleting an account. Typing the phrase is friction on purpose.
 */
export function TypedConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  phrase,
  hint,
  confirmLabel,
  cancelLabel,
  loading = false,
}: TypedConfirmDialogProps) {
  const [value, setValue] = useState("");
  const matches = value === phrase;

  // Clear the typed phrase when the dialog closes, adjusted during render
  // rather than in an effect. Leaving it populated means reopening the dialog
  // shows an already-satisfied confirmation — the friction this control exists
  // to create would be gone on the second attempt.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open && value !== "") setValue("");
  }

  const { t } = useLocale();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            {cancelLabel ?? t("common.cancel")}
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={!matches} loading={loading}>
            {confirmLabel ?? t("common.confirm")}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-text-secondary">{message}</p>
      <p className="mt-4 text-sm text-text-secondary">
        {t("common.typedConfirm", { phrase })}{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs font-bold text-error">
          {phrase}
        </code>
      </p>
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={phrase}
        autoComplete="off"
        className="mt-2"
        aria-label={t("common.typedConfirmAria", { phrase })}
      />
      {hint && <p className="mt-2 text-xs text-text-light">{hint}</p>}
    </Dialog>
  );
}
