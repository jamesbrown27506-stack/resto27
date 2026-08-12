"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Windowed page list with ellipses: 1 … 4 5 6 … 20 */
function pageWindow(current: number, total: number): (number | "gap")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages: (number | "gap")[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);

  if (start > 2) pages.push("gap");
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < total - 1) pages.push("gap");

  pages.push(total);
  return pages;
}

export function Pagination({
  page,
  totalPages,
  onPageChange,
  totalItems,
  className,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  /** Shown as "128 résultats" — tells the user whether a filter did anything. */
  totalItems?: number;
  className?: string;
}) {
  if (totalPages <= 1) {
    return totalItems !== undefined ? (
      <p className={cn("px-4 py-3 text-xs text-text-light", className)}>
        {totalItems} résultat{totalItems > 1 ? "s" : ""}
      </p>
    ) : null;
  }

  return (
    <nav
      aria-label="Pagination"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3",
        className,
      )}
    >
      {totalItems !== undefined && (
        <p className="text-xs text-text-light">
          {totalItems} résultat{totalItems > 1 ? "s" : ""} · page {page} sur {totalPages}
        </p>
      )}

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Page précédente"
          className="grid size-8 place-items-center rounded-full text-text-secondary transition-colors hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-40"
        >
          <ChevronLeft className="size-4" aria-hidden />
        </button>

        {pageWindow(page, totalPages).map((p, i) =>
          p === "gap" ? (
            <span key={`gap-${i}`} className="px-1 text-text-light" aria-hidden>
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onPageChange(p)}
              aria-current={p === page ? "page" : undefined}
              className={cn(
                "tnum grid size-8 place-items-center rounded-full text-sm font-medium transition-colors",
                p === page
                  ? "bg-primary text-primary-fg"
                  : "text-text-secondary hover:bg-surface-2",
              )}
            >
              {p}
            </button>
          ),
        )}

        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="Page suivante"
          className="grid size-8 place-items-center rounded-full text-text-secondary transition-colors hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-40"
        >
          <ChevronRight className="size-4" aria-hidden />
        </button>
      </div>
    </nav>
  );
}
