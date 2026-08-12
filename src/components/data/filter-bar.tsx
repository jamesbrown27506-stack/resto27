"use client";

import { Search, X } from "lucide-react";
import { Input, Select } from "@/components/ui/input";
import { useLocale } from "@/lib/i18n/use-locale";
import { cn } from "@/lib/utils";

export interface FilterSelect {
  key: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}

/**
 * Search + dropdown filters, used above most tables and grids.
 *
 * The "clear" control only appears when something is actually filtered. A
 * permanently visible reset button trains people to ignore it, and its absence
 * is a useful signal that the empty list they are looking at is genuinely
 * empty rather than filtered down to nothing.
 *
 * Stacks into a COLUMN below `sm`. Three controls side by side on a 360px
 * screen leaves each of them too narrow to read the selected value in, which
 * is the one thing a filter has to tell you.
 */
export function FilterBar({
  query,
  onQueryChange,
  placeholder,
  selects = [],
  onClear,
  trailing,
  className,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  placeholder?: string;
  selects?: FilterSelect[];
  onClear?: () => void;
  /** Actions pinned to the right — "New", export, view switches. */
  trailing?: React.ReactNode;
  className?: string;
}) {
  const { t } = useLocale();
  const dirty = query.trim() !== "" || selects.some((s) => s.value !== "all" && s.value !== "");

  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center", className)}>
      <div className="w-full sm:min-w-[12rem] sm:flex-1">
        <label className="sr-only" htmlFor="filter-query">
          {placeholder ?? t("common.search")}
        </label>
        <Input
          id="filter-query"
          type="search"
          icon={<Search />}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={placeholder ?? t("common.search")}
        />
      </div>

      {selects.map((s) => (
        <div key={s.key} className="w-full sm:w-auto sm:min-w-[9rem]">
          <label className="sr-only" htmlFor={`filter-${s.key}`}>
            {s.label}
          </label>
          <Select
            id={`filter-${s.key}`}
            value={s.value}
            onChange={(e) => s.onChange(e.target.value)}
          >
            {s.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      ))}

      {dirty && onClear && (
        <button
          type="button"
          onClick={onClear}
          className="inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-2 hover:text-text"
        >
          <X className="size-3.5" aria-hidden />
          <span>{t("common.clear")}</span>
        </button>
      )}

      {trailing && (
        <div className="flex items-center gap-2 sm:ml-auto [&>*]:w-full sm:[&>*]:w-auto">{trailing}</div>
      )}
    </div>
  );
}

/** Horizontal scrolling chip row — status filters on order lists. */
export function FilterChips({
  items,
  value,
  onChange,
  className,
}: {
  items: { value: string; label: string; count?: number }[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("no-scrollbar flex gap-2 overflow-x-auto pb-0.5", className)}>
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(item.value)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5",
              "text-sm font-medium whitespace-nowrap transition-colors",
              active
                ? "border-primary bg-primary text-primary-fg"
                : "border-border bg-surface text-text-secondary hover:border-border-strong hover:text-text",
            )}
          >
            <span>{item.label}</span>
            {item.count !== undefined && (
              <span className={cn("tnum text-xs", active ? "opacity-75" : "text-text-light")}>
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
