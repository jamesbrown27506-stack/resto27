"use client";

import { useLocale } from "@/lib/i18n/use-locale";
import { cn } from "@/lib/utils";
import { EmptyState } from "./empty-state";
import { SkeletonTable } from "./skeleton";

/**
 * The workhorse of the manager and admin areas — roughly 30 of the 68 screens
 * are a filtered table. Building it once is the difference between F7 taking
 * four hours and taking twelve.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  RESPONSIVE STRATEGY: STACK INTO CARDS, DO NOT SCROLL SIDEWAYS.
 *
 *  The first version hid low-priority columns below a breakpoint and let the
 *  rest scroll horizontally. Both halves of that were wrong on a phone:
 *  hiding a column loses data, and a horizontal scroll hides the ACTION —
 *  you cannot confirm, edit or open a row you have to swipe to reach, and
 *  nothing on screen tells you it is there.
 *
 *  Below `md` each row now becomes a stacked card: one label/value line per
 *  column, laid out in a COLUMN rather than a row. Nothing is hidden, nothing
 *  is off-screen, and the action lands at the bottom of its own card where a
 *  thumb already is. From `md` up it is a real <table> again, because a
 *  manager scanning fifty orders on a laptop wants rows to compare.
 *
 *  Pass `variant="table"` to keep the old scroll-and-hide behaviour for a
 *  grid that genuinely reads as a matrix.
 * ─────────────────────────────────────────────────────────────────────────
 */

export interface Column<T> {
  key: string;
  header: string;
  /** Cell renderer. Receives the row and its index. */
  cell: (row: T, index: number) => React.ReactNode;
  /**
   * Hide this column below the given breakpoint — only honoured from `md` up,
   * where the layout is a table. In card mode every column is shown, because
   * a card has no width pressure to relieve.
   */
  hideBelow?: "sm" | "md" | "lg";
  align?: "left" | "right" | "center";
  /** Tailwind width class, e.g. "w-32". */
  width?: string;
  /**
   * Suppress the label in card mode. For a cell that already names itself —
   * an avatar with a name beside it, or a row of action buttons.
   */
  hideLabelOnCard?: boolean;
}

/** Legacy behaviour: hide outright, at every size. */
const HIDE_BELOW = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
} as const;

/**
 * Card mode. Below `md` everything is visible, so only a `lg` request has any
 * range left to act on — the sliver between `md` and `lg`.
 */
const HIDE_BELOW_CARD = {
  sm: "",
  md: "",
  lg: "md:hidden lg:table-cell",
} as const;

/** Table mode: alignment applies at every width. */
const ALIGN = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
} as const;

/**
 * Card mode: alignment only means something once it is a table again. Below
 * `md` the cell is a flex row and `justify-between` does the positioning, so
 * a text-align there would only fight it.
 */
const ALIGN_CARD = {
  left: "md:text-left",
  right: "md:text-right",
  center: "md:text-center",
} as const;

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  loading?: boolean;
  /** Rendered instead of the table when `rows` is empty. */
  empty?: React.ReactNode;
  /** Makes rows clickable. Keep the primary action in a cell too — a whole-row
   *  click is undiscoverable for keyboard and screen-reader users. */
  onRowClick?: (row: T) => void;
  /** "cards" (default) stacks on mobile; "table" keeps the horizontal scroll. */
  variant?: "cards" | "table";
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  empty,
  onRowClick,
  variant = "cards",
  className,
}: DataTableProps<T>) {
  const { t } = useLocale();

  if (loading) return <SkeletonTable rows={6} cols={columns.length} />;

  if (rows.length === 0) {
    // Translated, not French. Callers normally pass their own `empty` with
    // copy specific to what is missing — but the fallback is what shows when
    // one forgets, and a French sentence in an English page is exactly the
    // leak this dictionary exists to prevent.
    return (
      <>
        {empty ?? (
          <EmptyState title={t("common.noResults")} description={t("common.noResultsBody")} />
        )}
      </>
    );
  }

  const cards = variant === "cards";
  const hideMap = cards ? HIDE_BELOW_CARD : HIDE_BELOW;
  const alignMap = cards ? ALIGN_CARD : ALIGN;

  return (
    // The wrapper scrolls, not the page — a wide table must never make the
    // whole document scroll sideways. In card mode there is nothing to scroll.
    <div className={cn("w-full", cards ? "overflow-x-visible" : "overflow-x-auto", className)}>
      <table className={cn("w-full border-collapse text-sm", cards && "block md:table")}>
        <thead className={cn(cards && "hidden md:table-header-group")}>
          <tr className="border-b border-border">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={cn(
                  "px-4 py-3 text-[11px] font-bold tracking-[0.08em] text-text-light uppercase whitespace-nowrap",
                  alignMap[col.align ?? "left"],
                  col.width,
                  col.hideBelow && hideMap[col.hideBelow],
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>

        <tbody className={cn(cards ? "block md:table-row-group" : "divide-y divide-border")}>
          {rows.map((row, i) => (
            <tr
              key={rowKey(row, i)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                "transition-colors",
                cards
                  ? // The card itself. `flex-col` is the whole point: label
                    // above value, stacked — never side by side and off the
                    // right edge where a thumb cannot reach it.
                    "mb-3 flex flex-col rounded-lg border border-border bg-surface p-1 last:mb-0 md:mb-0 md:table-row md:rounded-none md:border-0 md:border-b md:bg-transparent md:p-0"
                  : "border-b border-border",
                onRowClick && "cursor-pointer hover:bg-surface-2",
              )}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    "align-middle",
                    cards
                      ? "flex items-center justify-between gap-4 px-3 py-2 md:table-cell md:px-4 md:py-3.5"
                      : "px-4 py-3.5",
                    alignMap[col.align ?? "left"],
                    col.hideBelow && hideMap[col.hideBelow],
                  )}
                >
                  {cards && !col.hideLabelOnCard && (
                    // A real element, not a ::before — browser auto-translate
                    // rewrites text nodes in place, and generated content it
                    // cannot reach ends up as the only untranslated string on
                    // the page.
                    <span className="shrink-0 text-[11px] font-bold tracking-[0.08em] text-text-light uppercase md:hidden">
                      {col.header}
                    </span>
                  )}
                  {/* `md:contents` dissolves this wrapper once the layout is a
                      real table, so the cell keeps the column's own alignment
                      instead of inheriting the card's right-hand one. */}
                  <span className={cn(cards && "min-w-0 text-right md:contents", cards && alignMap[col.align ?? "left"])}>
                    {col.cell(row, i)}
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Two-line cell: a strong primary value with muted context beneath. */
export function CellStack({
  primary,
  secondary,
}: {
  primary: React.ReactNode;
  secondary?: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="truncate font-medium text-text">{primary}</div>
      {secondary && <div className="truncate text-xs text-text-light">{secondary}</div>}
    </div>
  );
}
