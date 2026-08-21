"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarCheck, Check, LoaderCircle, Smartphone, Users } from "lucide-react";
import { AccountShell } from "@/components/layout/account-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  cancelOwnReservation,
  checkReservationPayment,
  createOwnReservation,
} from "@/lib/data/customer-actions";
import { reservationStatusLabel, RESERVATION_STATUS_TONE } from "@/lib/format/reservation-status";
import { intlLocale, useLocale } from "@/lib/i18n/use-locale";
import type { CustomerReservation } from "@/lib/data/customer";
import type { PublicRestaurant } from "@/lib/data/public";
import { formatDate, formatDayLabel, formatTime, weekdayName } from "@/lib/format/datetime";
import { formatMoney } from "@/lib/format/currency";
import { depositChargedNow } from "@/lib/reservations/deposit";
import {
  isTodayOrLater,
  slotsForDate,
  todayInDisplayTz,
  weekdayOfDate,
} from "@/lib/reservations/slots";
import type { SessionUser } from "@/lib/session";

const POLL_INTERVAL_MS = 4_000;
const POLL_TRIES = 30;

/**
 * Low season, fixed windows: the restaurants practically share one kitchen
 * calendar, and the server re-checks availability with its own clock before
 * accepting anything.
 */
export function ReservationsClient({
  user,
  initial,
  restaurants,
  initialRestaurantSlug = "",
  initialGuests = "",
  initialDate = "",
  now: nowIso,
}: {
  user: SessionUser;
  initial: CustomerReservation[];
  restaurants: PublicRestaurant[];
  /** Slug or name — resolved below to the closest restaurant. */
  initialRestaurantSlug?: string;
  initialGuests?: string;
  initialDate?: string;
  /** The server's instant, ISO — see the comment on the page that passes it. */
  now: string;
}) {
  const { toast } = useToast();
  const { locale, t } = useLocale();
  const dateLocale = intlLocale(locale);

  // Resolve the hand-off (slug, or a name typed in the homepage search) to a
  // selectable restaurant. Unmatched names fall back to the first one, the
  // same default the form always had — the search result still lands on the
  // booking screen instead of being dropped.
  function resolveRestaurant(slugOrName: string): string {
    if (!slugOrName) return restaurants[0]?.slug ?? "";
    const bySlug = restaurants.find((r) => r.slug === slugOrName);
    if (bySlug) return bySlug.slug;
    const byName = restaurants.find((r) =>
      r.name.toLowerCase().includes(slugOrName.trim().toLowerCase()),
    );
    return byName?.slug ?? restaurants[0]?.slug ?? "";
  }

  function resolveGuests(raw: string): string {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 1 && n <= 20 ? String(n) : "2";
  }

  // Only a well-formed YYYY-MM-DD is allowed through — anything else would
  // make the submit build an Invalid Date and throw in toISOString. A date
  // that has already gone is dropped too: the hand-off from the homepage
  // search carries whatever was typed there, and a stale `?date=` would open
  // the form pre-filled with a day nothing can be booked on.
  function resolveDate(raw: string): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
    return isTodayOrLater(raw) ? raw : "";
  }

  const [mine, setMine] = useState(initial);
  const [restaurantSlug, setRestaurantSlug] = useState(() =>
    resolveRestaurant(initialRestaurantSlug),
  );
  const [date, setDate] = useState(() => resolveDate(initialDate));
  const [time, setTime] = useState("");
  const [guests, setGuests] = useState(() => resolveGuests(initialGuests));
  const [notes, setNotes] = useState("");
  /*
    PRE-FILLED FROM THE PROFILE.

    The Mobile Money field started empty, so a customer whose number we already
    hold — they typed it at sign-up, and it is on every order they have ever
    placed — had to find their handset and type it again at the one moment the
    form is asking them to pay. It is still editable: paying from a different
    line is a real thing, and this is a default, not a lock.
  */
  const [phone, setPhone] = useState(() => user.phone ?? "");
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState(false);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /*
    The clock the slot grid is built against.

    It starts as the server's instant so the first client render is identical
    to the server's, then takes over on mount and re-reads every minute. The
    tick is what stops a form left open through lunch from still offering
    13:00 at half past one — the list narrows as the afternoon goes on, and
    the "no seatings left today" state arrives on its own.
  */
  const [now, setNow] = useState(() => new Date(nowIso));

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 60_000);
    // A phone that was asleep does not run intervals. Coming back to the tab
    // is the moment the server's instant is most likely to be hours old, so
    // the clock is re-read there too rather than waiting out a whole minute
    // on a list of slots that may all have passed.
    const onVisible = () => {
      if (document.visibilityState === "visible") setNow(new Date());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const upcoming = mine.filter((r) => r.status === "pending" || r.status === "confirmed");
  const past = mine.filter((r) => !["pending", "confirmed"].includes(r.status));

  /* ── What can actually be booked, for the restaurant and day chosen ──── */

  const selectedRestaurant = restaurants.find((r) => r.slug === restaurantSlug);

  /** `min` on the date input — the browser greys out everything before it. */
  const minDate = todayInDisplayTz(now);

  /*
    The party size the fee is multiplied by.

    Read from the same `guests` field the booking is submitted with, and
    floored at 1: the input is a text field the browser lets you empty, and an
    empty one must not make a per-seat deposit read as free for the moment
    between deleting the 2 and typing the 5.
  */
  const guestCount = Math.max(1, Math.round(Number(guests)) || 1);

  /*
    What the customer will actually be charged now, through the SAME function
    the server charges with. A second expression here would be a second
    opinion, and the two would disagree the first time either was edited —
    with the difference being money taken from a real person.
  */
  const depositCharged = selectedRestaurant
    ? depositChargedNow(
        { amount: selectedRestaurant.depositAmount, type: selectedRestaurant.depositType },
        guestCount,
      )
    : 0;

  const day = date ? slotsForDate(selectedRestaurant?.hours ?? [], date, now) : null;
  const slots = day?.slots ?? [];

  /**
   * "lundi 24 août 2026" — the weekday of the chosen date, spelled out.
   *
   * A date field shows 24/08/2026 and nothing else, and nobody books a table
   * by date number: they book "Saturday". The weekday comes from the string
   * through `weekdayOfDate` rather than from a parsed Date, so it cannot drift
   * a day across a timezone; midday is used for the rest of the label because
   * it is the hour furthest from either boundary.
   */
  const chosenWeekday = date ? weekdayOfDate(date) : null;
  const dayLabel =
    chosenWeekday === null
      ? null
      : `${weekdayName(chosenWeekday, dateLocale)} ${formatDate(
          `${date}T12:00:00+01:00`,
          dateLocale,
        )}`;

  /*
    Drop a slot that the chosen day no longer offers — a different restaurant,
    a different date, or simply the minute it stopped being bookable. Adjusted
    during render rather than in an effect so the form is never submittable
    with a time the grid is no longer showing.
  */
  if (time && !slots.includes(time)) setTime("");

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
      phone,
    });
    setBusy(false);

    if (!result.ok) {
      toast(result.error, "error");
      return;
    }

    // A fixed deposit in live mode stays 'pending' until the customer
    // approves on their handset — poll until the provider (or its webhook)
    // settles it.
    if (result.status === "pending" && result.attemptId) {
      setPaying(true);
      let tries = 0;
      pollRef.current = setInterval(async () => {
        tries += 1;
        const check = await checkReservationPayment(result.attemptId!);
        if (check.status === "succeeded") {
          if (pollRef.current) clearInterval(pollRef.current);
          setPaying(false);
          toast(t("crs.sent"), "success");
          setDate("");
          setTime("");
          setNotes("");
          setPhone("");
        } else if (check.status === "failed" || tries >= POLL_TRIES) {
          if (pollRef.current) clearInterval(pollRef.current);
          setPaying(false);
          toast(t("crs.payFailed"), "error");
        }
      }, POLL_INTERVAL_MS);
      return;
    }

    toast(t("crs.sent"), "success");
    setDate("");
    setTime("");
    setNotes("");
    setPhone("");
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
                  /*
                    `min` is the whole of the past, blocked. The native picker
                    greys out every earlier day and the browser refuses a typed
                    one, so a yesterday booking cannot be built at all — rather
                    than being built, paid for, and then refused by the server.
                  */
                  min={minDate}
                  onChange={(e) => {
                    const value = e.target.value;
                    // Belt and braces: a keyboard-typed date bypasses the
                    // picker's greying, and Firefox accepts it below `min`.
                    setDate(value === "" || isTodayOrLater(value, now) ? value : "");
                  }}
                />
                {dayLabel && (
                  <p className="mt-1.5 text-xs font-medium text-text-secondary capitalize">
                    {dayLabel}
                  </p>
                )}
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

            {/*
              THE SLOTS ARE THE RESTAURANT'S, NOT THE PLATFORM'S.

              Nine fixed times used to be hard-coded here for every restaurant
              on every day of the week. They now come from `restaurant_hours`
              for the weekday actually selected, every half hour from opening
              to the last seating — so a place open 10:00–22:00 can be booked
              at 15:30, a Sunday it is closed offers nothing and says why, and
              an hour that has already passed today is simply not there.

              The grid is `min-h-11` per slot: these are the densest tap
              targets on the screen and were 36px, which on a phone is a
              mis-tap and a table booked an hour from the one you wanted.
            */}
            <fieldset>
              <legend className="mb-2 text-[11px] font-bold tracking-[0.08em] text-text-light uppercase">
                {t("crs.slot")}
              </legend>

              {!date ? (
                <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-text-light">
                  {t("crs.pickDateFirst")}
                </p>
              ) : slots.length > 0 ? (
                <>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-3">
                    {slots.map((slot) => {
                      const chosen = time === slot;
                      return (
                        <button
                          key={slot}
                          type="button"
                          aria-pressed={chosen}
                          onClick={() => setTime(slot)}
                          className={`tnum inline-flex min-h-11 items-center justify-center rounded-md border px-2 text-sm font-medium transition-colors ${
                            chosen
                              ? "border-primary bg-primary text-primary-fg"
                              : "border-border hover:border-primary hover:text-primary"
                          }`}
                        >
                          {slot}
                        </button>
                      );
                    })}
                  </div>
                  {day?.opensAt && day.closesAt && (
                    <p className="tnum mt-2 text-xs text-text-light">
                      {t("crs.openWindow", { opens: day.opensAt, closes: day.closesAt })}
                    </p>
                  )}
                </>
              ) : (
                <p className="rounded-md border border-warning/30 bg-warning-light px-3 py-4 text-center text-xs leading-relaxed text-warning">
                  {t(day?.reason === "tooLate" ? "crs.noSlotsToday" : "crs.closedThatDay")}
                </p>
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

            {/*
              THE FEE BLOCK, AND WHY IT USED TO BREAK THE PAGE.

              `min-w-0` on the wrapper is the fix for the reported "the form is
              not responsive once a deposit is required". Everything inside is
              text that can be long — a formatted amount, a per-seat sum, a
              phone hint — and without a zero minimum a flex/grid child is
              floored at its content's intrinsic width. One unbreakable string
              then widened the whole aside past the viewport and the PAGE
              scrolled sideways, which reads as the layout being broken rather
              than as one box being too wide.
            */}
            {depositCharged > 0 ? (
              <div className="flex min-w-0 flex-col gap-3 rounded-md border border-warning/30 bg-warning-light p-3">
                <p className="text-xs leading-relaxed break-words text-warning">
                  <strong>{t("crs.deposit", { amount: formatMoney(depositCharged) })}</strong>{" "}
                  {t("crs.depositBody")}
                </p>

                {/* A per-seat fee shows its arithmetic. "7 500 FCFA" for a
                    table of three is a surprise; "2 500 × 3 guests" is a
                    price. */}
                {selectedRestaurant?.depositType === "per_seat" && (
                  <p className="tnum text-xs leading-relaxed break-words text-warning/90">
                    {t("crs.depositPerSeatMath", {
                      rate: formatMoney(selectedRestaurant.depositAmount),
                      guests: guestCount,
                    })}
                  </p>
                )}

                <Field label={t("crs.phone")} htmlFor="res-phone" hint={t("crs.phoneHint")}>
                  <Input
                    id="res-phone"
                    icon={<Smartphone className="size-4" aria-hidden />}
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder={t("crs.phonePh")}
                    value={phone}
                    disabled={paying}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </Field>
              </div>
            ) : selectedRestaurant?.depositType === "percent" &&
              selectedRestaurant.depositAmount > 0 ? (
              /* A percentage fee is never charged online — the bill is unknown
                 at booking — and is collected at the restaurant. */
              <p className="min-w-0 rounded-md border border-info/30 bg-info-light p-3 text-xs leading-relaxed break-words text-info">
                <strong>{t("crs.depositPercent", { pct: selectedRestaurant.depositAmount })}</strong>{" "}
                {t("crs.depositPercentBody")}
              </p>
            ) : null}

            {/*
              `whitespace-normal` and the narrower padding are the other half
              of the responsiveness fix.

              With a deposit the label becomes "Payer l'acompte 7 500 FCFA et
              réserver" — around forty characters at `text-base`, which with
              Button's own `whitespace-nowrap` and `px-8` demands roughly 390px
              on one unbreakable line. A full-width button inside a 360px
              viewport cannot give it that, so the row overflowed and took the
              page's horizontal scroll with it. Without a deposit the label is
              short, which is exactly why the form looked fine until a
              restaurant asked for one.

              The height is a floor (see button.tsx), so wrapping to two lines
              grows the button rather than clipping it.
            */}
            <Button
              fullWidth
              size="lg"
              disabled={!date || !time || busy || paying}
              onClick={submit}
              className="px-4 text-center leading-snug whitespace-normal"
            >
              {paying ? (
                <>
                  <LoaderCircle className="size-4 shrink-0 animate-spin" aria-hidden />
                  <span>{t("crs.payPendingTitle")}</span>
                </>
              ) : (
                <>
                  <Check className="size-4 shrink-0" aria-hidden />
                  <span>
                    {depositCharged > 0
                      ? t("crs.payDeposit", { amount: formatMoney(depositCharged) })
                      : t("crs.submit")}
                  </span>
                </>
              )}
            </Button>

            {paying && (
              <p className="text-center text-xs leading-relaxed text-text-light">
                {t("crs.payPendingBody")}
              </p>
            )}

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