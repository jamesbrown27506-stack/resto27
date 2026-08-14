"use client";

import { useState } from "react";
import { CalendarCheck, Check, Users } from "lucide-react";
import { AccountShell } from "@/components/layout/account-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { cancelOwnReservation, createOwnReservation } from "@/lib/data/customer-actions";
import { reservationStatusLabel, RESERVATION_STATUS_TONE } from "@/lib/format/reservation-status";
import { intlLocale, useLocale } from "@/lib/i18n/use-locale";
import type { CustomerReservation } from "@/lib/data/customer";
import type { PublicRestaurant } from "@/lib/data/public";
import { formatDayLabel, formatTime } from "@/lib/format/datetime";
import { formatMoney } from "@/lib/format/currency";
import type { SessionUser } from "@/lib/session";

const SLOTS = ["12:00", "12:30", "13:00", "13:30", "19:00", "19:30", "20:00", "20:30", "21:00"];

/**
 * Low season, fixed windows: the restaurants practically share one kitchen
 * calendar, and the server re-checks availability with its own clock before
 * accepting anything.
 */
export function ReservationsClient({
  user,
  initial,
  restaurants,
}: {
  user: SessionUser;
  initial: CustomerReservation[];
  restaurants: PublicRestaurant[];
}) {
  const { toast } = useToast();
  const { locale, t } = useLocale();
  const dateLocale = intlLocale(locale);

  const [mine, setMine] = useState(initial);
  const [restaurantSlug, setRestaurantSlug] = useState(restaurants[0]?.slug ?? "");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [guests, setGuests] = useState("2");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [cancelId, setCancelId] = useState<string | null>(null);

  const upcoming = mine.filter((r) => r.status === "pending" || r.status === "confirmed");
  const past = mine.filter((r) => !["pending", "confirmed"].includes(r.status));

  async function submit() {
    if (!date || !time) return;
    const restaurant = restaurants.find((r) => r.slug === restaurantSlug);
    if (!restaurant) return;

    // The date input is local ("Africa/Douala", UTC+1, no DST); the server
    // stores UTC and renders back in the same zone, so the instant is exact.
    const reservedFor = new Date(`${date}T${time}:00+01:00`).toISOString();

    setBusy(true);
    const result = await createOwnReservation({
      restaurantId: restaurant.id,
      reservedFor,
      partySize: Number(guests),
      notes,
    });
    setBusy(false);

    if (result.ok) {
      toast(t("crs.sent"), "success");
      setDate("");
      setTime("");
      setNotes("");
    } else {
      toast(result.error, "error");
    }
  }

  async function confirmCancel() {
    if (!cancelId) return;
    setBusy(true);
    const result = await cancelOwnReservation(cancelId);
    setBusy(false);
    if (result.ok) {
      setMine((c) => c.filter((r) => r.id !== cancelId));
      toast(t("crs.cancelled"), "info");
    } else {
      toast(result.error, "error");
    }
    setCancelId(null);
  }

  return (
    <AccountShell
      user={user}
      title={t("crs.title")}
      description={t("crs.subtitle")}
    >
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-6">
          <Panel title={t("crs.upcoming")}>
            {upcoming.length === 0 ? (
              <EmptyState
                icon={<CalendarCheck />}
                title={t("crs.upcomingEmpty")}
                description={t("crs.upcomingEmptyBody")}
              />
            ) : (
              <ul className="divide-y divide-border">
                {upcoming.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{r.restaurantName}</p>
                      <p className="tnum mt-0.5 text-sm text-text-secondary">
                        {formatDayLabel(r.reservedFor, dateLocale)} ·{" "}
                        {formatTime(r.reservedFor, dateLocale)} ·{" "}
                        {t("crs.people", { count: r.partySize })}
                        {r.tableNumber && ` · ${t("crs.table", { number: r.tableNumber })}`}
                      </p>
                      {r.notes && (
                        <p className="mt-1 text-xs text-text-light italic">« {r.notes} »</p>
                      )}
                    </div>

                    <Badge tone={RESERVATION_STATUS_TONE[r.status]}>
                      {reservationStatusLabel(r.status, t)}
                    </Badge>

                    <Button variant="ghost" size="sm" onClick={() => setCancelId(r.id)}>
                      {t("crs.cancel")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title={t("crs.history")}>
            {past.length === 0 ? (
              <EmptyState title={t("crs.historyEmpty")} />
            ) : (
              <ul className="divide-y divide-border">
                {past.map((r) => (
                  <li key={r.id} className="flex items-center gap-4 px-5 py-4">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{r.restaurantName}</p>
                      <p className="tnum mt-0.5 text-sm text-text-light">
                        {formatDayLabel(r.reservedFor, dateLocale)} ·{" "}
                        {formatTime(r.reservedFor, dateLocale)} ·{" "}
                        {t("crs.people", { count: r.partySize })}
                      </p>
                    </div>
                    <Badge tone={RESERVATION_STATUS_TONE[r.status]}>
                      {reservationStatusLabel(r.status, t)}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <aside className="rounded-lg border border-border bg-surface p-5 lg:sticky lg:top-24">
          <h2 className="font-display text-lg font-bold">{t("crs.book")}</h2>

          <div className="mt-4 flex flex-col gap-4">
            <Field label={t("crs.restaurant")} htmlFor="res-restaurant" required>
              <Select
                id="res-restaurant"
                value={restaurantSlug}
                onChange={(e) => setRestaurantSlug(e.target.value)}
              >
                {restaurants.map((r) => (
                  <option key={r.id} value={r.slug}>
                    {r.name}
                    {!r.isPrimary ? ` — ${r.branchLabel}` : ""}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              <Field label={t("crs.date")} htmlFor="res-date" required>
                <Input
                  id="res-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </Field>

              <Field label={t("crs.guests")} htmlFor="res-guests" required>
                <Input
                  id="res-guests"
                  type="number"
                  min={1}
                  max={20}
                  icon={<Users />}
                  value={guests}
                  onChange={(e) => setGuests(e.target.value)}
                />
              </Field>
            </div>

            <fieldset>
              <legend className="mb-2 text-[11px] font-bold tracking-[0.08em] text-text-light uppercase">
                {t("crs.slot")}
              </legend>
              <div className="grid grid-cols-3 gap-2">
                {SLOTS.map((slot) => {
                  const chosen = time === slot;
                  return (
                    <button
                      key={slot}
                      type="button"
                      disabled={!date}
                      aria-pressed={chosen}
                      onClick={() => setTime(slot)}
                      className={`tnum rounded-md border px-2 py-2 text-sm font-medium transition-colors ${
                        chosen
                          ? "border-primary bg-primary text-primary-fg"
                          : !date
                            ? "cursor-not-allowed border-border bg-surface-2 text-text-light opacity-50"
                            : "border-border hover:border-primary hover:text-primary"
                      }`}
                    >
                      {slot}
                    </button>
                  );
                })}
              </div>
              {!date && (
                <p className="mt-2 text-xs text-text-light">{t("crs.pickDateFirst")}</p>
              )}
            </fieldset>

            <Field label={t("crs.notes")} htmlFor="res-notes">
              <Textarea
                id="res-notes"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("crs.notesPh")}
              />
            </Field>

            {(() => {
              const selected = restaurants.find((r) => r.slug === restaurantSlug);
              return selected && selected.depositAmount > 0 ? (
                <p className="rounded-md border border-warning/30 bg-warning-light p-3 text-xs leading-relaxed text-warning">
                  <strong>{t("crs.deposit", { amount: formatMoney(selected.depositAmount) })}</strong>{" "}
                  {t("crs.depositBody")}
                </p>
              ) : null;
            })()}

            <Button
              fullWidth
              size="lg"
              disabled={!date || !time || busy}
              onClick={submit}
            >
              <Check className="size-4" aria-hidden />
              {t("crs.submit")}
            </Button>

            <p className="text-xs leading-relaxed text-text-light">{t("crs.formHint")}</p>
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={cancelId !== null}
        onClose={() => setCancelId(null)}
        onConfirm={confirmCancel}
        title={t("crs.cancelTitle")}
        message={t("crs.cancelBody")}
        confirmLabel={t("crs.cancelConfirm")}
        cancelLabel={t("crs.cancelKeep")}
        destructive
      />
    </AccountShell>
  );
}