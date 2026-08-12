"use client";

import { useState } from "react";
import { Check, ChevronsUpDown, Store } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Sheet } from "@/components/ui/sheet";
import { SUBSCRIPTION_STATE_META } from "@/lib/format/subscription";
import { useLocale } from "@/lib/i18n/use-locale";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { cn } from "@/lib/utils";
import type { Branch } from "@/lib/branch-types";

/**
 * Switches the active branch.
 *
 * Branches are rows in `restaurants` sharing a user (§3), and the same person
 * can hold a DIFFERENT role at each — the switcher therefore shows the role
 * per branch, because "which hat am I wearing here" is not obvious from the
 * name alone.
 *
 * SECURITY NOTE for P7: the server must validate the selected branch against
 * the user's allowed list on every switch. This list is what the UI offers;
 * it is not what makes the switch legal. A crafted POST naming a branch the
 * user cannot access must be rejected server-side (§14.4).
 */
export function BranchSwitcher({
  branches,
  activeId,
  onSwitch,
}: {
  branches: Branch[];
  activeId: string | null;
  onSwitch?: (restaurantId: string) => void;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const active = branches.find((b) => b.restaurantId === activeId) ?? branches[0];

  if (!active) return null;

  // A single branch is a label, not a control — a dropdown with one option is
  // an invitation to click and find nothing.
  if (branches.length === 1) {
    return (
      <div className="flex items-center gap-2.5 rounded-md border border-border bg-surface-2 px-3 py-2">
        <Store className="size-4 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{active.restaurantName}</p>
          <p className="truncate text-xs text-text-light">
            <span>{active.branchLabel}</span>
            <span> · </span>
            <span>{t(`common.role.${active.role}` as TranslationKey)}</span>
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="flex w-full items-center gap-2.5 rounded-md border border-border bg-surface-2 px-3 py-2 text-left transition-colors hover:border-border-strong"
      >
        <Store className="size-4 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{active.restaurantName}</p>
          <p className="truncate text-xs text-text-light">
            <span>{active.branchLabel}</span>
            <span> · </span>
            <span>{t(`common.role.${active.role}` as TranslationKey)}</span>
          </p>
        </div>
        <ChevronsUpDown className="size-3.5 shrink-0 text-text-light" aria-hidden />
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={t("common.branch.switch")}
        description={t("common.branch.switchHint")}
        side="left"
      >
        <ul className="flex flex-col gap-2">
          {branches.map((branch) => {
            const isActive = branch.restaurantId === active.restaurantId;
            const state = SUBSCRIPTION_STATE_META[branch.subscriptionState];

            return (
              <li key={branch.restaurantId}>
                <button
                  type="button"
                  onClick={() => {
                    onSwitch?.(branch.restaurantId);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-md border p-3 text-left transition-colors",
                    isActive
                      ? "border-primary bg-primary-light"
                      : "border-border hover:border-border-strong hover:bg-surface-2",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    {/* The name is wrapped even though it is data: it sits
                        beside a conditional element, and a bare text node
                        next to one is what browser auto-translate turns into
                        an insertBefore crash. */}
                    <p className="flex items-center gap-2 font-semibold">
                      <span>{branch.restaurantName}</span>
                      {branch.isPrimary && (
                        <span className="text-[10px] font-bold tracking-wider text-text-light uppercase">
                          {t("common.branch.primary")}
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-sm text-text-secondary">{branch.branchLabel}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge tone="neutral">
                        {t(`common.role.${branch.role}` as TranslationKey)}
                      </Badge>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                          state.badge,
                        )}
                      >
                        {t(`common.subState.${branch.subscriptionState}` as TranslationKey)}
                      </span>
                    </div>
                  </div>
                  {isActive && <Check className="mt-1 size-4 shrink-0 text-primary" aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
      </Sheet>
    </>
  );
}
