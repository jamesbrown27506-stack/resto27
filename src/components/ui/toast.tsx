"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastTone = "success" | "error" | "info" | "warning";

interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastContextValue {
  toast: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
  warning: AlertTriangle,
} as const;

const TONES: Record<ToastTone, string> = {
  success: "border-success/30 bg-success-light text-success",
  error: "border-error/30 bg-error-light text-error",
  info: "border-info/30 bg-info-light text-info",
  warning: "border-warning/30 bg-warning-light text-warning",
};

let nextId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const regionRef = useRef<HTMLDivElement>(null);

  /*
    ABOVE ANY OPEN DIALOG.

    Dialogs and sheets are native modal <dialog>s: they live in the browser's
    TOP LAYER, above every z-index, behind a blurred backdrop. A toast raised
    while one was open — "wrong password" while setting a withdrawal PIN —
    rendered UNDER that blur, unreadable. No z-index can fix that; only the
    top layer can. So the toast region is a manual popover, and every new
    toast re-opens it, which moves it to the top of the top layer — above
    whatever dialog opened since. (Forms also show their own refusal inline;
    this is for everything else.) Browsers without popovers keep the fixed,
    high-z-index region they always had.
  */
  useEffect(() => {
    const region = regionRef.current as (HTMLDivElement & { showPopover?: () => void; hidePopover?: () => void }) | null;
    if (!region || typeof region.showPopover !== "function") return;
    try {
      if (region.matches(":popover-open")) region.hidePopover?.();
      region.showPopover();
    } catch {
      // Not connected yet, or already in the state asked for — harmless.
    }
  }, [toasts]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, tone: ToastTone = "info") => {
      const id = nextId++;
      setToasts((current) => [...current, { id, tone, message }]);
      // Errors stay longer — they usually require the user to do something.
      window.setTimeout(() => dismiss(id), tone === "error" ? 7000 : 4500);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/*
        aria-live="polite" so a confirmation is announced without interrupting
        whatever the user is typing. The region exists even when empty —
        injecting the container at the same moment as its content means screen
        readers frequently miss the announcement entirely.
      */}
      <div
        ref={regionRef}
        popover="manual"
        aria-live="polite"
        aria-atomic="false"
        // At the TOP, not the bottom: toasts announce themselves where the
        // eye already is — above the content — and never collide with the
        // mobile bottom tab bar or a sticky save bar. The m-0/p-0/border-0/
        // bg-transparent/overflow-visible undo the browser's popover styles.
        className="pointer-events-none fixed inset-x-4 top-4 bottom-auto z-[9000] m-0 flex h-auto w-auto flex-col items-end gap-2 overflow-visible border-0 bg-transparent p-0 sm:inset-x-auto sm:right-6 sm:left-auto sm:top-6"
      >
        {toasts.map(({ id, tone, message }) => {
          const Icon = ICONS[tone];
          return (
            <div
              key={id}
              className={cn(
                "pointer-events-auto flex w-full items-start gap-2.5 rounded-md border px-4 py-3 shadow-md sm:w-auto sm:min-w-[280px] sm:max-w-md",
                "animate-drop",
                TONES[tone],
              )}
            >
              <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p className="flex-1 text-sm font-medium">{message}</p>
              <button
                type="button"
                onClick={() => dismiss(id)}
                aria-label="Fermer"
                className="-mr-1 shrink-0 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
