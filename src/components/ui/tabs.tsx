"use client";

import { cn } from "@/lib/utils";

export interface TabItem {
  value: string;
  label: string;
  /** Count badge — order queues, moderation queues, invoice states. */
  count?: number;
  icon?: React.ReactNode;
}

/**
 * Tab strip. Roving-tabindex + arrow keys, per the WAI-ARIA tabs pattern:
 * Tab moves into and out of the strip, arrows move between tabs. A strip of
 * plain buttons forces a keyboard user through every tab to reach the panel.
 */
export function Tabs({
  items,
  value,
  onChange,
  variant = "underline",
  className,
}: {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  variant?: "underline" | "pills";
  className?: string;
}) {
  function onKeyDown(e: React.KeyboardEvent) {
    const i = items.findIndex((t) => t.value === value);
    if (e.key === "ArrowRight") onChange(items[(i + 1) % items.length].value);
    else if (e.key === "ArrowLeft") onChange(items[(i - 1 + items.length) % items.length].value);
    else if (e.key === "Home") onChange(items[0].value);
    else if (e.key === "End") onChange(items[items.length - 1].value);
    else return;
    e.preventDefault();
  }

  return (
    <div
      role="tablist"
      onKeyDown={onKeyDown}
      className={cn(
        "no-scrollbar flex items-center gap-1 overflow-x-auto",
        variant === "underline" && "border-b border-border",
        className,
      )}
    >
      {items.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.value)}
            className={cn(
              "inline-flex shrink-0 items-center gap-2 text-sm font-semibold whitespace-nowrap transition-colors",
              variant === "underline"
                ? cn(
                    "-mb-px border-b-2 px-4 py-2.5",
                    active
                      ? "border-primary text-primary"
                      : "border-transparent text-text-secondary hover:text-text",
                  )
                : cn(
                    "rounded-full px-4 py-1.5",
                    active
                      ? "bg-primary text-primary-fg"
                      : "text-text-secondary hover:bg-surface-2",
                  ),
            )}
          >
            {tab.icon && <span className="[&>svg]:size-4">{tab.icon}</span>}
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={cn(
                  "tnum rounded-full px-1.5 py-0.5 text-[11px] font-bold",
                  active && variant === "pills"
                    ? "bg-primary-fg/20 text-primary-fg"
                    : "bg-surface-2 text-text-light",
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
