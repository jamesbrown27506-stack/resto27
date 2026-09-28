"use client";

import { dishPriceRange } from "@/lib/menu/custom-price";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Armchair, Minus, Plus, Search, Send, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatMoney } from "@/lib/format/currency";
import { createTableOrder } from "@/lib/data/order-actions";
import { staffOrderToBill } from "@/lib/data/dining-actions";
import { useLocale } from "@/lib/i18n/use-locale";
import type { MenuCategory, MenuItem, RestaurantTable } from "@/lib/data/manager";
import { cn } from "@/lib/utils";

interface TicketLine {
  key: string;
  menuItemId: string;
  name: string;
  quantity: number;
  optionIds: string[];
  optionLabel: string;
  /** Display estimate only — the server reprices every line from the database. */
  unitPrice: number;
  /** Customizable dish (0069): the waiter sets this price, within [min, max]. */
  priceRange?: { min: number; max: number } | null;
}

/**
 * Waiter table-side ordering (§14.4), on live data.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  This writes THE SAME ROWS as an online order — same `orders`, same
 *  `order_items` snapshots, same status history. Kitchen display, printed
 *  tickets, stock decrement and reports all work unchanged because nothing
 *  downstream can tell the difference between a table order and a delivery.
 *
 *  The prices shown here are a PREVIEW. createTableOrder() re-reads name,
 *  price and option deltas from the database — a tampered request can order
 *  a lot of food, but it cannot reprice it.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Optimised for speed over ceremony: big tap targets, search-first, and the
 * running ticket always visible. A waiter is standing at a table.
 */
/** An open table bill (Enterprise, 0068) the waiter can add dishes to. */
export interface OpenBill {
  id: string;
  tableId: string;
  label: string | null;
  code: string | null;
  confirmed: boolean;
}

export function TableOrderer({
  tables,
  categories,
  items,
  bills,
  focusBillId,
}: {
  tables: RestaurantTable[];
  categories: MenuCategory[];
  items: MenuItem[];
  /**
   * Enterprise table service: dishes go onto a BILL on the table (an open one,
   * or a new one) — never a separate ticket beside the guests' bills.
   * Undefined on the Professional plan, which keeps plain table orders.
   */
  bills?: OpenBill[];
  focusBillId?: string;
}) {
  const { t } = useLocale();
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const focusBill = bills?.find((bill) => bill.id === focusBillId);
  const [tableId, setTableId] = useState<string | null>(focusBill?.tableId ?? null);
  /** "new" opens a fresh bill on the table; otherwise the id of the bill to add to. */
  const [billTarget, setBillTarget] = useState<string>(focusBill?.id ?? "new");
  const [billLabel, setBillLabel] = useState("");
  const tableBills = (bills ?? []).filter((bill) => bill.tableId === tableId && bill.confirmed);
  const [query, setQuery] = useState("");
  const [lines, setLines] = useState<TicketLine[]>([]);
  const [notes, setNotes] = useState("");
  const [guests, setGuests] = useState<number | null>(null);

  const table = tables.find((x) => x.id === tableId);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byCategory = categories
      .filter((c) => c.isActive)
      .map((category) => ({
        category,
        items: items.filter(
          (i) => i.categoryId === category.id && (!q || i.name.toLowerCase().includes(q)),
        ),
      }));
    // Dishes whose category was deleted still belong on the ticket screen.
    const uncategorised = items.filter(
      (i) => !categories.some((c) => c.id === i.categoryId) && (!q || i.name.toLowerCase().includes(q)),
    );
    if (uncategorised.length > 0) {
      byCategory.push({
        category: { id: "none", restaurantId: "", name: "…", icon: "", sortOrder: 999, isActive: true, itemCount: 0 },
        items: uncategorised,
      });
    }
    return byCategory.filter((g) => g.items.length > 0);
  }, [categories, items, query]);

  /*
    NO SERVICE FEE HERE. The payment service fee is charged only on Mobile
    Money payments (the gateway's cut) — createTableOrder() stores 0 for a
    table order, and this preview used to add it anyway, so the waiter
    quoted a total the customer was never asked for.
  */
  const total = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);

  function addItem(item: MenuItem) {
    // Required single-select groups default to their first available option so
    // a waiter can add a dish in one tap; anything unusual stays a spoken note.
    const defaults = item.optionGroups
      .filter((g) => g.isRequired && g.maxSelect === 1)
      .map((g) => g.options.find((o) => o.isAvailable))
      .filter((o): o is NonNullable<typeof o> => Boolean(o));

    const optionIds = defaults.map((o) => o.id);
    const key = `${item.id}::${[...optionIds].sort().join("|")}`;
    const unitPrice = item.price + defaults.reduce((sum, o) => sum + o.priceDelta, 0);

    setLines((current) => {
      const existing = current.find((l) => l.key === key);
      if (existing) {
        return current.map((l) => (l.key === key ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [
        ...current,
        {
          key,
          menuItemId: item.id,
          name: item.name,
          quantity: 1,
          optionIds,
          optionLabel: defaults.map((o) => o.name).join(" · "),
          unitPrice,
          priceRange: dishPriceRange(item, defaults.reduce((sum, o) => sum + o.priceDelta, 0)),
        },
      ];
    });
  }

  function bump(key: string, delta: number) {
    setLines((current) =>
      current
        .map((l) => (l.key === key ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0),
    );
  }

  function send() {
    const target = table;
    if (!target || lines.length === 0) return;

    if (bills) {
      startTransition(async () => {
        const result = await staffOrderToBill({
          tableId: target.id,
          sessionId: billTarget === "new" ? null : billTarget,
          label: billLabel,
          lines: lines.map((l) => ({
            menuItemId: l.menuItemId, quantity: l.quantity, optionIds: l.optionIds,
            ...(l.priceRange ? { unitPrice: l.unitPrice } : {}),
          })),
          notes: notes || undefined,
        });
        if (!result.ok) return toast(result.error ?? t("common.error"), "error");
        toast(t("mt.sent", { ref: result.reference ?? "", table: target.number }), "success");
        setLines([]);
        setNotes("");
        setBillLabel("");
        setBillTarget(result.sessionId ?? "new");
        router.refresh();
      });
      return;
    }

    startTransition(async () => {
      const result = await createTableOrder({
        tableId: target.id,
        lines: lines.map((l) => ({
          menuItemId: l.menuItemId,
          quantity: l.quantity,
          optionIds: l.optionIds,
          ...(l.priceRange ? { unitPrice: l.unitPrice } : {}),
        })),
        notes: notes || undefined,
        guests: guests ?? undefined,
      });

      if (!result.ok) return toast(result.error, "error");

      toast(t("mt.sent", { ref: result.reference ?? "", table: target.number }), "success");
      setLines([]);
      setNotes("");
      setGuests(null);
      setTableId(null);
      router.refresh();
    });
  }

  return (
    <div id="waiter-order" className="grid scroll-mt-20 items-start gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="flex flex-col gap-5">
        {/* ── Table picker ───────────────────────────────────────────── */}
        <section>
          <h2 className="mb-3 text-[11px] font-bold tracking-[0.08em] text-text-light uppercase">
            {t("mt.table")}
          </h2>
          {tables.length === 0 ? (
            <div className="rounded-lg border border-border bg-surface">
              <EmptyState
                icon={<Armchair />}
                title={t("m.tableOrder.noTables")}
                description={t("m.tableOrder.noTablesBody")}
              />
            </div>
          ) : (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {tables.map((x) => {
                const unavailable = x.planLocked || x.status === "out_of_service";
                const selected = tableId === x.id;

                return (
                  <li key={x.id}>
                    <button
                      type="button"
                      disabled={unavailable}
                      aria-pressed={selected}
                      title={x.planLocked ? t("tbl.frozen") : undefined}
                      onClick={() => {
                        setTableId(x.id);
                        setBillTarget("new");
                        // A new party takes over the table — the old
                        // party's guest count must not follow.
                        setGuests(null);
                      }}
                      className={cn(
                        "flex w-full flex-col items-center gap-1 rounded-md border px-2 py-3 transition-colors",
                        selected
                          ? "border-primary bg-primary text-primary-fg"
                          : unavailable
                            ? "cursor-not-allowed border-border bg-surface-2 opacity-45"
                            : x.status === "occupied"
                              ? "border-warning/40 bg-warning-light hover:border-warning"
                              : "border-border bg-surface hover:border-primary",
                      )}
                    >
                      <Armchair className="size-4" aria-hidden />
                      <span className="tnum text-sm font-bold">{x.number}</span>
                      <span className="text-[10px] opacity-70">
                        {x.planLocked ? t("tbl.frozen") : t("mt.seatsShort", { count: x.capacity })}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ── Menu ───────────────────────────────────────────────────── */}
        <section>
          <Input
            icon={<Search />}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("mt.search")}
            aria-label={t("mt.search")}
          />

          <div className="mt-4 flex flex-col gap-6">
            {groups.map(({ category, items: groupItems }) => (
              <div key={category.id}>
                <h3 className="mb-2 font-display font-bold text-primary">{category.name}</h3>
                <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {groupItems.map((item) => {
                    const soldOut =
                      !item.isAvailable || (item.trackStock && item.stockQuantity === 0);
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          disabled={soldOut || !tableId}
                          onClick={() => addItem(item)}
                          title={!tableId ? t("mt.pickFirst") : undefined}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-md border border-border bg-surface p-3 text-left transition-colors",
                            soldOut || !tableId
                              ? "cursor-not-allowed opacity-50"
                              : "hover:border-primary hover:bg-primary-light",
                          )}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold">
                              {item.name}
                            </span>
                            <span className="tnum block text-sm text-primary">
                              {soldOut ? t("mt.soldOut") : formatMoney(item.price)}
                            </span>
                          </span>
                          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-primary-fg">
                            <Plus className="size-3.5" aria-hidden />
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ── Running ticket ─────────────────────────────────────────────── */}
      <aside className="rounded-lg border border-border bg-surface lg:sticky lg:top-24">
        <div className="flex items-center justify-between gap-3 border-b border-border p-5">
          <h2 className="font-display text-lg font-bold">
            {table ? `${t("mt.table")} ${table.number}` : t("mt.ticket")}
          </h2>
          {lines.length > 0 && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("mt.clear")}
              onClick={() => setLines([])}
              className="text-error hover:bg-error-light"
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          )}
        </div>

        {/* How many people are sitting. The table stays a single unit — a
            party of 3 at a 5-seat table IS the table — but the count is
            genuinely useful to the kitchen and the floor overview. */}
        {table && bills && (
          <div className="flex flex-col gap-2 border-b border-border px-5 py-3">
            <label className="text-xs font-semibold text-text-secondary" htmlFor="bill-target">{t("ons.m.billFor")}</label>
            <select id="bill-target" value={billTarget} onChange={(e) => setBillTarget(e.target.value)}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm">
              {tableBills.map((bill) => (
                <option key={bill.id} value={bill.id}>{bill.label || t("ons.m.bill")}{bill.code ? ` · ${bill.code}` : ""}</option>
              ))}
              <option value="new">{t("ons.m.newBill")}</option>
            </select>
            {billTarget === "new" && (
              <Input value={billLabel} maxLength={60} onChange={(e) => setBillLabel(e.target.value)} placeholder={t("ons.m.billLabelPh")} aria-label={t("ons.m.billLabelPh")} />
            )}
          </div>
        )}

        {table && !bills && (
          <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
            <span className="flex items-center gap-2 text-sm text-text-secondary">
              <Users className="size-4" aria-hidden />
              {t("mt.guests")}
              <span className="text-xs text-text-light">
                {t("mt.seatsShort", { count: table.capacity })}
              </span>
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="-1"
                onClick={() => setGuests((g) => (g === null ? null : Math.max(1, g - 1)))}
                className="grid size-7 place-items-center rounded-full border border-border hover:border-primary"
              >
                <Minus className="size-3" aria-hidden />
              </button>
              <span className="tnum w-6 text-center text-sm font-bold">
                {guests ?? "—"}
              </span>
              <button
                type="button"
                aria-label="+1"
                onClick={() => setGuests((g) => Math.min(table.capacity, (g ?? 0) + 1))}
                className="grid size-7 place-items-center rounded-full border border-border hover:border-primary"
              >
                <Plus className="size-3" aria-hidden />
              </button>
            </div>
          </div>
        )}

        {lines.length === 0 ? (
          <EmptyState
            icon={<Armchair />}
            title={tableId ? t("mt.emptyTicket") : t("m.tableOrder.pickTable")}
            description={tableId ? t("mt.emptyTicketBody") : t("mt.pickTableBody")}
          />
        ) : (
          <>
            <ul className="divide-y divide-border">
              {lines.map((line) => (
                <li key={line.key} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{line.name}</p>
                    {line.optionLabel && (
                      <p className="truncate text-xs text-text-light">{line.optionLabel}</p>
                    )}
                    {line.priceRange ? (
                      /* The waiter prices a customizable dish here (0069). */
                      <label className="mt-1 flex items-center gap-2 text-xs text-text-secondary">
                        <Input
                          className="h-8 w-28"
                          type="number"
                          inputMode="numeric"
                          step={1}
                          min={line.priceRange.min}
                          max={line.priceRange.max}
                          value={String(line.unitPrice)}
                          aria-label={t("ons.d.unitPriceOf", { name: line.name })}
                          onChange={(e) => {
                            const price = Math.round(Number(e.target.value) || 0);
                            setLines((current) => current.map((l) => (l.key === line.key ? { ...l, unitPrice: price } : l)));
                          }}
                        />
                        <span className="tnum">{t("ons.d.rangeHint", { min: formatMoney(line.priceRange.min), max: formatMoney(line.priceRange.max) })}</span>
                      </label>
                    ) : (
                      <p className="tnum text-xs text-text-secondary">
                        {formatMoney(line.unitPrice)}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      aria-label="-1"
                      onClick={() => bump(line.key, -1)}
                      className="grid size-7 place-items-center rounded-full border border-border hover:border-primary"
                    >
                      <Minus className="size-3" aria-hidden />
                    </button>
                    <span className="tnum w-6 text-center text-sm font-bold">{line.quantity}</span>
                    <button
                      type="button"
                      aria-label="+1"
                      onClick={() => bump(line.key, 1)}
                      className="grid size-7 place-items-center rounded-full border border-border hover:border-primary"
                    >
                      <Plus className="size-3" aria-hidden />
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            <div className="flex flex-col gap-3 border-t border-border p-5">
              <Textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("mt.notesPh")}
                aria-label={t("mo.notes")}
              />

              <dl className="flex flex-col gap-1 text-sm">
                <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-border pt-2">
                  <dt className="font-semibold">{t("m.orders.total")}</dt>
                  <dd className="tnum font-display text-lg font-bold text-primary">
                    {formatMoney(total)}
                  </dd>
                </div>
              </dl>

              <Button fullWidth size="lg" disabled={pending || !table} loading={pending} onClick={send}>
                <Send className="size-4" aria-hidden />
                <span>{t("m.tableOrder.send")}</span>
              </Button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
