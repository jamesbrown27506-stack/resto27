"use client";

import { useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { useLocale } from "@/lib/i18n/use-locale";
import { cn } from "@/lib/utils";
import type { FilterSelect } from "@/components/data/filter-bar";

/**
 * The directory's filters, laid out for a phone first.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHAT WAS WRONG.
 *
 *  This screen used the shared FilterBar, which stacks into a column below
 *  `sm`. Six filters plus a search field therefore rendered as seven
 *  full-width controls, roughly four hundred pixels of chrome, and the first
 *  restaurant sat below the fold on every phone. The page opened on a form,
 *  not on food — and the count that told you anything had happened ("5
 *  restaurants") was itself off-screen.
 *
 *  WHY SORT IS CHIPS AND THE REST IS A SHEET.
 *
 *  They are different kinds of decision. Sort is single-choice, cheap, and
 *  reversible — you want it one tap away and you want to see the list move.
 *  The five filters are a combination you assemble before you commit, and
 *  assembling one in a bottom sheet means the result count can sit on the
 *  confirm button: you see what the combination costs you before you close it.
 *
 *  Above `sm` there is room for the original inline row, so that is what is
 *  rendered — this is not a phone layout forced onto a desktop.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function DirectoryFilters({
  query,
  onQueryChange,
  placeholder,
  filters,
  sort,
  resultCount,
  onClear,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  placeholder: string;
  /** Quartier, cuisine, rating, budget, delivery time. */
  filters: FilterSelect[];
  sort: FilterSelect;
  resultCount: number;
  onClear: () => void;
}) {
  const { t } = useLocale();
  const [sheetOpen, setSheetOpen] = useState(false);

  // "all" and "" both mean untouched — the shared FilterBar's convention.
  const activeCount = filters.filter(f => f.value !== "all" && f.value !== "").length;
  const dirty = activeCount > 0 || query.trim() !== "";

  return (
    <>
      <div className="flex flex-col gap-3">
        <Input
          id="filter-query"
          type="search"
          icon={<Search />}
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
        />

        {/*
          One scrolling row on a phone, wrapping into place from `sm` up. The
          row is deliberately allowed to overflow rather than wrap on mobile:
          wrapping four sort chips plus a filter button produces two ragged
          lines that push the list down again, which is the problem being
          solved.
        */}
        <div className="no-scrollbar scroll-fade-x -mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5 sm:flex-wrap sm:overflow-visible">
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            aria-haspopup="dialog"
            className={cn(
              "inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border px-4",
              "text-sm font-semibold whitespace-nowrap",
              "transition-[background-color,border-color,color,transform] duration-150 active:scale-[.97]",
              activeCount > 0
                ? "border-primary bg-primary-light text-primary"
                : "border-border bg-surface text-text hover:border-border-strong",
            )}
          >
            <SlidersHorizontal className="size-4" aria-hidden />
            <span>{t("restaurants.filters")}</span>
            {activeCount > 0 && (
              <span className="tnum grid size-5 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-fg">
                {activeCount}
              </span>
            )}
          </button>

          <span aria-hidden className="my-1 w-px shrink-0 bg-border" />

          {sort.options.map(option => {
            const active = option.value === sort.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() => sort.onChange(option.value)}
                className={cn(
                  "inline-flex min-h-10 shrink-0 items-center rounded-full border px-4",
                  "text-sm font-medium whitespace-nowrap",
                  "transition-[background-color,border-color,color,transform] duration-150 active:scale-[.97]",
                  active
                    ? "border-primary bg-primary text-primary-fg"
                    : "border-border bg-surface text-text-secondary hover:border-border-strong hover:text-text",
                )}
              >
                {option.label}
              </button>
            );
          })}

          {dirty && (
            <button
              type="button"
              onClick={onClear}
              className={cn(
                "inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-3",
                "text-sm font-medium text-text-secondary",
                "transition-colors hover:bg-surface-2 hover:text-text",
              )}
            >
              <X className="size-3.5" aria-hidden />
              <span>{t("common.clear")}</span>
            </button>
          )}
        </div>
      </div>

      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        side="bottom"
        title={t("restaurants.filtersTitle")}
        footer={
          <Button fullWidth size="lg" onClick={() => setSheetOpen(false)}>
            {/*
              The count lives on the button because that is the question the
              sheet is answering: not "did the filter apply" but "is there
              anything left". Filters apply live, so this reads as the result
              of every change made while the sheet is open.
            */}
            {resultCount === 0
              ? t("restaurants.filtersNone")
              : resultCount === 1
                ? t("restaurants.filtersDoneOne")
                : t("restaurants.filtersDone", { count: String(resultCount) })}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          {filters.map(filter => (
            <div key={filter.key}>
              <label
                htmlFor={`sheet-filter-${filter.key}`}
                className="mb-1.5 block text-xs font-bold tracking-wide text-text-light uppercase"
              >
                {filter.label}
              </label>
              <Select
                id={`sheet-filter-${filter.key}`}
                value={filter.value}
                onChange={e => filter.onChange(e.target.value)}
              >
                {filter.options.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
          ))}

          {activeCount > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="min-h-11 self-start text-sm font-semibold text-primary underline-offset-4 hover:underline"
            >
              {t("restaurants.reset")}
            </button>
          )}
        </div>
      </Sheet>
    </>
  );
}
