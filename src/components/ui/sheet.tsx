"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useLocale } from "@/lib/i18n/use-locale";
import { cn } from "@/lib/utils";

/**
 * Side/bottom drawer. Same native <dialog> foundation as Dialog, and for the
 * same reason: the top layer is immune to ancestor containing blocks, so a
 * frosted-glass header can never trap it the way it did in the PHP build.
 *
 * Used for the mobile nav drawer, the modifier picker, and every "edit" panel
 * in the manager and admin areas.
 */

export type SheetSide = "left" | "right" | "bottom";

const SIDE_CLASSES: Record<SheetSide, string> = {
  left: "mr-auto ml-0 h-dvh max-h-none w-[min(22rem,85vw)] rounded-none border-y-0 border-l-0",
  right: "ml-auto mr-0 h-dvh max-h-none w-[min(28rem,90vw)] rounded-none border-y-0 border-r-0",
  bottom:
    "mt-auto mb-0 mx-auto w-full max-w-2xl max-h-[88dvh] rounded-t-xl rounded-b-none border-b-0",
};

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  side?: SheetSide;
  footer?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export function Sheet({
  open,
  onClose,
  title,
  description,
  side = "right",
  footer,
  className,
  children,
}: SheetProps) {
  const { t } = useLocale();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

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
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby="sheet-title"
      className={cn(
        "max-w-none border border-border bg-surface p-0 text-text shadow-lg",
        "backdrop:bg-black/50",
        SIDE_CLASSES[side],
        className,
      )}
    >
      <div className="flex h-full max-h-[inherit] flex-col">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border p-5">
          <div>
            <h2 id="sheet-title" className="font-display text-lg font-bold">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-sm text-text-secondary">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="-mt-1 -mr-1 shrink-0 rounded-full p-1.5 text-text-light transition-colors hover:bg-surface-2 hover:text-text"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        {/* overscroll-contain stops a flick at the end of the panel from
            scrolling the page behind it. */}
        <div className="flex-1 overflow-y-auto overscroll-contain p-5">{children}</div>

        {footer && (
          <div
            className="shrink-0 border-t border-border bg-surface-2 p-5"
            // Clears the gesture bar on phones that have one.
            style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom, 0px))" }}
          >
            {footer}
          </div>
        )}
      </div>
    </dialog>
  );
}

/**
 * The cancel/confirm pair at the bottom of an editing panel.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  IT BELONGS IN THE SHEET'S `footer`, NOT AT THE END OF THE FORM.
 *
 *  Every editor put its two buttons after the last field, inside the
 *  scrolling area. On a phone that means scrolling past ten fields, a photo
 *  picker, three diet checkboxes and six allergens before you can press Add —
 *  and on a short viewport the pair can sit off the edge entirely, so the
 *  panel reads as having no way to confirm at all.
 *
 *  In the footer they are pinned: visible from the moment the panel opens,
 *  whatever the form's length or the screen's height.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ONE ROW ON EVERY WIDTH, matching the Dialog footer. Pass the buttons in
 * reading order — cancel first, confirm second — and that is where they stay.
 *
 * The previous `flex-col-reverse` below `sm` stacked them into two full-width
 * bars, which reads as two equal choices rather than a decision with a
 * default. Side by side works on a phone because the pair is given the room to
 * behave: `*:min-w-0` lets each half be narrower than its own label so the row
 * cannot overflow, `*:min-h-12` holds a 48px floor whatever the label does,
 * and the height being a floor means a wrapped label grows its button.
 */
export function SheetActions({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-stretch gap-3 *:min-h-12 *:min-w-0 *:flex-1">
      {children}
    </div>
  );
}
