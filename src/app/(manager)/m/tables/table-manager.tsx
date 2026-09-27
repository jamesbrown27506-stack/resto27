"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Armchair, Lock, Pencil, Plus, QrCode, Users } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select } from "@/components/ui/input";
import { Sheet, SheetActions } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { setTableStatus, upsertTable } from "@/lib/data/manager-actions";
import { useLocale } from "@/lib/i18n/use-locale";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import type { RestaurantTable } from "@/lib/data/manager";
import { cn } from "@/lib/utils";
import { useDates } from "@/lib/format/use-dates";

/** A live booking holding a table right now (computed by the page). */
export interface TableHold {
  guestName: string;
  reservedFor: string;
  endsAt: string;
  /** The party is already at the table — the floor status says occupied. */
  seated: boolean;
}

const STATUSES = ["available", "occupied", "reserved", "out_of_service"] as const;

const STATUS_TONE: Record<RestaurantTable["status"], BadgeTone> = {
  available: "success",
  occupied: "warning",
  reserved: "info",
  out_of_service: "error",
};

export function TableManager({
  tables,
  holds = {},
  limit,
  canManage,
  canSetStatus = canManage,
  qrEnabled,
}: {
  tables: RestaurantTable[];
  /** Table id → the booking holding it now (0060, read-time only). */
  holds?: Record<string, TableHold>;
  /** null = unlimited */
  limit: number | null;
  canManage: boolean;
  /** Change a table's status (free / occupied…) — floor staff too (reservations.seat). */
  canSetStatus?: boolean;
  qrEnabled: boolean;
}) {
  const { t, locale } = useLocale();
  const dates = useDates();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<{ id?: string; number: string; capacity: number; zone?: string } | null>(null);

  const atLimit = limit !== null && tables.length >= limit;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) return toast(result.error ?? t("common.error"), "error");
      toast(success, "success");
    });
  }

  return (
    <>
      {canManage && (
        <div className="mb-5 flex flex-wrap justify-end gap-2">
          {qrEnabled && <Link href="/m/tables/print" className={buttonClasses({ variant: "outline" })}><QrCode className="size-4" /> {locale === "fr" ? "Imprimer les QR codes" : "Print table QR cards"}</Link>}
          <Button
            disabled={atLimit}
            title={atLimit ? t("tbl.planLimit") : undefined}
            onClick={() => setEditing({ number: "", capacity: 2, zone: "" })}
          >
            <Plus className="size-4" aria-hidden />
            {t("tbl.new")}
          </Button>
        </div>
      )}

      {/* Excess tables are preserved, but unavailable for new activity until
          the restaurant upgrades to a package that includes them. */}
      {atLimit && (
        <div
          role="status"
          className="mb-5 flex flex-wrap items-center gap-3 rounded-md border border-warning/30 bg-warning-light p-4 text-warning"
        >
          <Lock className="size-4 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-semibold">
              {t("tbl.limitReached", { used: tables.length, limit: limit ?? 0 })}
            </span>{" "}
            <span className="opacity-85">{t("tbl.limitBody", { limit: limit ?? 0 })}</span>
          </p>
          <Link href="/m/billing" className={buttonClasses({ size: "sm" })}>
            {t("tbl.changePlan")}
          </Link>
        </div>
      )}

      {tables.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState
            icon={<Armchair />}
            title={t("m.tableOrder.noTables")}
            description={t("tbl.emptyBody")}
          />
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {tables.map((table) => (
            <li
              key={table.id}
              className={cn(
                "rounded-lg border border-border bg-surface p-5",
                table.status === "out_of_service" && "opacity-70",
                table.planLocked && "border-dashed bg-surface-2 opacity-55 grayscale",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-display text-xl font-bold">
                    {t("res.table")} {table.number}
                  </p>
                  <p className="tnum mt-0.5 text-sm text-text-secondary">
                    {t("m.tables.seats", { count: table.capacity })}
                    {table.zone ? ` · ${table.zone}` : ""}
                  </p>
                  {/* Live occupancy, straight from the open dine-in orders —
                      "3 of 5 seats" beats a status badge when the floor is
                      being scanned. */}
                  {table.activePartySize !== null && (
                    <p className="tnum mt-1 text-xs font-semibold text-primary">
                      <Users className="mr-1 inline size-3.5" aria-hidden />
                      {t("m.tables.occupied", {
                        seated: table.activePartySize,
                        capacity: table.capacity,
                      })}
                    </p>
                  )}
                </div>
                {table.planLocked ? (
                  <Lock className="size-5 shrink-0 text-text-light" aria-hidden />
                ) : (
                  <Armchair className="size-5 shrink-0 text-primary" aria-hidden />
                )}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {/* A booking's hold shows as "Réservée" over a free table; a
                    table the waiter marked occupied or out of service keeps
                    that word — it is the truer one right now. */}
                {(() => {
                  const hold = holds[table.id];
                  const showHold =
                    hold && !table.planLocked && (table.status === "available" || table.status === "reserved");
                  return (
                    <>
                      <Badge tone={table.planLocked ? "neutral" : showHold ? "info" : STATUS_TONE[table.status]}>
                        {table.planLocked
                          ? t("tbl.frozen")
                          : showHold
                            ? t("mres.floor.reserved")
                            : t(`tbl.status.${table.status}` as TranslationKey)}
                      </Badge>
                      {hold && !table.planLocked && (
                        <span className="tnum text-xs text-text-secondary">
                          {t("mres.floor.heldBy", {
                            name: hold.guestName,
                            start: dates.time(hold.reservedFor),
                            end: dates.time(hold.endsAt),
                          })}
                        </span>
                      )}
                    </>
                  );
                })()}
              </div>

              {qrEnabled && !table.planLocked && table.publicToken && (
                <a href={`/api/table-qr/${table.publicToken}`} download={`table-${table.number}.svg`} className={buttonClasses({ variant: "outline", size: "sm", className: "mt-4 w-full" })}><QrCode className="size-3.5" /> {locale === "fr" ? "Télécharger le QR" : "Download QR"}</a>
              )}
              {canSetStatus && (
                <div className="mt-4 flex items-center gap-2 border-t border-border pt-3">
                  <label className="sr-only" htmlFor={`status-${table.id}`}>
                    {t("tbl.statusOf")} {table.number}
                  </label>
                  <Select
                    id={`status-${table.id}`}
                    value={table.status}
                    disabled={pending || table.planLocked}
                    onChange={(e) =>
                      run(
                        () => setTableStatus(table.id, e.target.value as RestaurantTable["status"]),
                        `${t("res.table")} ${table.number} — ${t("tbl.updated")}`,
                      )
                    }
                    className="h-9 text-sm"
                  >
                    {STATUSES.map((value) => (
                      <option key={value} value={value}>
                        {t(`tbl.status.${value}` as TranslationKey)}
                      </option>
                    ))}
                  </Select>
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${t("common.edit")} ${table.number}`}
                      disabled={table.planLocked}
                      onClick={() => setEditing({ id: table.id, number: table.number, capacity: table.capacity, zone: table.zone ?? "" })}
                    >
                      <Pencil className="size-3.5" aria-hidden />
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.id ? `${t("res.table")} ${editing.number}` : t("tbl.new")}
        footer={
          editing && (
            <SheetActions>
              <Button variant="outline" onClick={() => setEditing(null)}>
                <span>{t("common.cancel")}</span>
              </Button>
              <Button
                loading={pending}
                disabled={!editing.number.trim() || editing.capacity < 1}
                onClick={() => {
                  run(
                    () => upsertTable({ id: editing.id, number: editing.number, capacity: editing.capacity, zone: editing.zone ?? "" }),
                    editing.id ? t("tbl.saved") : t("tbl.added"),
                  );
                  setEditing(null);
                }}
              >
                <span>{editing.id ? t("common.save") : t("common.add")}</span>
              </Button>
            </SheetActions>
          )
        }
      >
        {editing && (
          <div className="flex flex-col gap-4">
            <Field
              label={t("tbl.number")}
              htmlFor="table-number"
              required
              hint={t("tbl.numberHint")}
            >
              <Input
                id="table-number"
                value={editing.number}
                onChange={(e) => setEditing({ ...editing, number: e.target.value })}
                placeholder="12"
              />
            </Field>

            <Field label={t("tbl.capacity")} htmlFor="table-capacity" required>
              <Input
                id="table-capacity"
                type="number"
                min={1}
                step={1}
                value={String(editing.capacity)}
                onChange={(e) => setEditing({ ...editing, capacity: Math.trunc(Number(e.target.value) || 0) })}
              />
            </Field>

            {/* Zone (0068): what a guest's seating preference matches. */}
            <Field label={t("ons.m.zone")} htmlFor="table-zone" hint={t("ons.m.zoneHint")}>
              <Input
                id="table-zone"
                value={editing.zone ?? ""}
                maxLength={40}
                list="table-zones"
                onChange={(e) => setEditing({ ...editing, zone: e.target.value })}
                placeholder={t("ons.m.zonePh")}
              />
              <datalist id="table-zones">
                {[...new Set(tables.map((table) => table.zone).filter(Boolean))].map((zone) => <option key={zone!} value={zone!} />)}
              </datalist>
            </Field>

          </div>
        )}
      </Sheet>
    </>
  );
}
