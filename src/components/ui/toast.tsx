"use client";

import { createContext, useCallback, useContext, useState } from "react";
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
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-[9000] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6"
      >
        {toasts.map(({ id, tone, message }) => {
          const Icon = ICONS[tone];
          return (
            <div
              key={id}
              className={cn(
                "pointer-events-auto flex w-full items-start gap-2.5 rounded-md border px-4 py-3 shadow-md sm:w-auto sm:min-w-[280px] sm:max-w-md",
                "animate-rise",
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
