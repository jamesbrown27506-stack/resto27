"use client";

import { createContext, useContext, useEffect, useId, useRef } from "react";
import { ArrowRight, LoaderCircle, MapPin, Store } from "lucide-react";
import { useLocale } from "@/lib/i18n/use-locale";

export const BranchNavigationContext = createContext<{
  switchTo: (id: string, destination?: string) => void;
  switching: boolean;
} | null>(null);

export function useBranchNavigation() {
  const navigation = useContext(BranchNavigationContext);
  if (!navigation) throw new Error("Branch navigation requires the manager shell.");
  return navigation;
}

/** Top-layer feedback also prevents edits against the previous branch mid-switch. */
export function BranchSwitchTransition({ open, from, to }: { open: boolean; from: string; to: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const { t } = useLocale();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog ref={ref} onCancel={event => event.preventDefault()}
      aria-labelledby={titleId} aria-describedby={descriptionId}
      className="no-print m-auto w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface p-6 text-text shadow-lg backdrop:bg-black/45 backdrop:backdrop-blur-sm motion-safe:animate-[rl-fade_150ms_ease-out]">
      <div className="mb-5 flex items-center justify-center gap-5" aria-hidden>
        <span className="grid size-12 place-items-center rounded-xl border border-border bg-surface-2 text-text-light"><Store className="size-5" /></span>
        <ArrowRight className="size-5 text-primary motion-safe:animate-[rl-branch-travel_900ms_ease-in-out_infinite]" />
        <span className="grid size-12 place-items-center rounded-xl border border-primary/30 bg-primary-light text-primary"><MapPin className="size-5" /></span>
      </div>
      <div role="status" aria-live="polite" className="text-center">
        <p className="mb-1 truncate text-xs text-text-light">{from}</p>
        <h2 id={titleId} className="font-display text-lg font-bold">{t("mbr.switch.title", { label: to })}</h2>
        <p id={descriptionId} className="mt-2 text-sm text-text-secondary">{t("mbr.switch.body")}</p>
      </div>
      <div className="mt-5 flex items-center justify-center gap-2 text-xs font-semibold text-primary">
        <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden />
        <span>{t("common.loading")}</span>
      </div>
    </dialog>
  );
}
