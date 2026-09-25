"use client";

import { useState } from "react";
import { Search, Users } from "lucide-react";
import { FilterBar } from "@/components/data/filter-bar";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { StatTile } from "@/components/ui/stat-tile";
import { formatMoney, formatMoneyCompact } from "@/lib/format/currency";
import { useDates } from "@/lib/format/use-dates";
import { useLocale } from "@/lib/i18n/use-locale";
import type { CustomerTotals, RestaurantCustomer } from "@/lib/data/customers";

const DEFAULT_SORT = "spent";

/**
 * The customer list, on live rows folded by `manager_customers` (0011).
 *
 * REGISTERED AND GUEST ARE SHOWN APART because they are different facts. A
 * registered customer's history follows them across phones; a guest's is only
 * as reliable as the number they typed on the ticket, and the badge is what
 * stops a manager reading the second as if it were the first.
 *
 * `now` arrives from the server so "last order" is measured against one clock —
 * reading it during render is impure and drifts from the server-rendered HTML.
 */
export function CustomersView({
  customers,
  totals,
  now,
}: {
  customers: RestaurantCustomer[];
  totals: CustomerTotals;
  /** ISO instant, stamped on the server. */
  now: string;
}) {
  const { t } = useLocale();
  const dates = useDates();

  const [query, setQuery] = useState("");
  // Widened on purpose: FilterBar hands its select back a plain string, and a
  // state inferred as the literal "spent" would refuse every other option.
  const [sort, setSort] = useState<string>(DEFAULT_SORT);

  /** A profile can carry an empty name, and a guest ticket often has none. */
  const nameOf = (c: RestaurantCustomer) => c.name || t("mcu.unnamed");

  const q = query.trim().toLowerCase();
  // Numbers are typed as "690 12 34 56", stored as "+237690123456". Comparing
  // digits only is the difference between a search that works and one that is
  // right about the number and still finds nothing.
  const digits = q.replace(/\D/g, "");

  const filtered = customers.filter((c) => {
    if (!q) return true;
    if (c.name.toLowerCase().includes(q)) return true;
    if (c.email.toLowerCase().includes(q)) return true;
    return digits !== "" && c.phone.replace(/\D/g, "").includes(digits);
  });

  const visible = [...filtered].sort((a, b) => {
    if (sort === "orders") return b.orderCount - a.orderCount || b.totalSpent - a.totalSpent;
    // Both timestamps are canonical UTC ISO from the read layer, so comparing
    // the strings is comparing the instants.
    if (sort === "recent") return b.lastOrderAt.localeCompare(a.lastOrderAt);
    if (sort === "name") {
      return nameOf(a).localeCompare(nameOf(b), dates.locale, { sensitivity: "base" });
    }
    return b.totalSpent - a.totalSpent || b.orderCount - a.orderCount;
  });

  const columns: Column<RestaurantCustomer>[] = [
    {
      key: "customer",
      header: t("mcu.col.customer"),
      // An avatar beside a name already says "customer"; a label above it in
      // card mode is noise.
      hideLabelOnCard: true,
      cell: (c) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={nameOf(c)} size="sm" />
          <div className="min-w-0 text-left">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate font-medium text-text">{nameOf(c)}</span>
              <Badge
                tone={c.isRegistered ? "primary" : "neutral"}
                title={c.isRegistered ? t("mcu.registeredHint") : t("mcu.guestHint")}
              >
                <span>{c.isRegistered ? t("mcu.registered") : t("mcu.guest")}</span>
              </Badge>
            </div>

            <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-text-light">
              {c.email !== "" && <span className="truncate">{c.email}</span>}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "orders",
      header: t("mcu.col.orders"),
      align: "right",
      cell: (c) => (
        <span
          className="tnum font-semibold"
          title={t("mcu.firstOrder", { date: dates.date(c.firstOrderAt) })}
        >
          {c.orderCount}
        </span>
      ),
    },
    {
      key: "spent",
      header: t("mcu.col.spent"),
      align: "right",
      cell: (c) => <span className="tnum font-semibold">{formatMoney(c.totalSpent)}</span>,
    },
    {
      key: "average",
      header: t("mcu.col.average"),
      align: "right",
      hideBelow: "lg",
      cell: (c) => (
        // The RPC cannot emit a customer with zero orders — it counts rows —
        // but a cell that divides is not the place to depend on that.
        <span className="tnum text-text-secondary">
          {formatMoney(c.orderCount > 0 ? Math.round(c.totalSpent / c.orderCount) : 0)}
        </span>
      ),
    },
    {
      key: "last",
      header: t("mcu.col.last"),
      align: "right",
      cell: (c) => (
        <time
          dateTime={c.lastOrderAt || undefined}
          title={dates.dateTime(c.lastOrderAt)}
          className="text-text-light"
        >
          {dates.relative(c.lastOrderAt, now)}
        </time>
      ),
    },
  ];

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label={t("mcu.stat.customers")} value={totals.count} icon={<Users />} />
        <StatTile label={t("mcu.stat.orders")} value={totals.orders} />
        <StatTile
          label={t("mcu.stat.revenue")}
          value={formatMoneyCompact(totals.revenue)}
          hint={t("mcu.stat.revenueHint")}
          tone="primary"
        />
      </div>

      {/* No filters over an empty list: a search box above nothing suggests the
          list is filtered down rather than genuinely empty. */}
      {customers.length > 0 && (
        <div className="mt-6">
          <FilterBar
            query={query}
            onQueryChange={setQuery}
            placeholder={t("mcu.search")}
            onClear={
              q !== "" || sort !== DEFAULT_SORT
                ? () => {
                    setQuery("");
                    setSort(DEFAULT_SORT);
                  }
                : undefined
            }
            selects={[
              {
                key: "sort",
                label: t("mcu.sort"),
                value: sort,
                onChange: setSort,
                options: [
                  { value: "spent", label: t("mcu.sort.spent") },
                  { value: "orders", label: t("mcu.sort.orders") },
                  { value: "recent", label: t("mcu.sort.recent") },
                  { value: "name", label: t("mcu.sort.name") },
                ],
              },
            ]}
          />
        </div>
      )}

      {q !== "" && (
        <p className="mt-3 text-sm text-text-secondary">
          <span>{t("mcu.showing", { shown: visible.length, total: customers.length })}</span>
        </p>
      )}

      {visible.length === 0 ? (
        <div className="mt-4 rounded-lg border border-border bg-surface">
          {customers.length === 0 ? (
            <EmptyState
              icon={<Users />}
              title={t("mcu.empty.title")}
              description={t("mcu.empty.body")}
            />
          ) : (
            <EmptyState
              icon={<Search />}
              title={t("mcu.noResults.title")}
              description={t("mcu.noResults.body")}
            />
          )}
        </div>
      ) : (
        // The panel chrome only appears from `md`, where DataTable is a real
        // table again. Below it each row is already its own bordered card, and
        // a border around a stack of borders reads as a mistake.
        <div className="mt-4 md:overflow-hidden md:rounded-lg md:border md:border-border md:bg-surface">
          <DataTable columns={columns} rows={visible} rowKey={(c) => c.id} />
        </div>
      )}
    </>
  );
}
