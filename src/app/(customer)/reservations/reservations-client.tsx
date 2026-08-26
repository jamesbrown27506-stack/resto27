"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, Check, Smartphone, Users } from "lucide-react";
import { AccountShell } from "@/components/layout/account-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { QtyStepper } from "@/components/ui/qty-stepper";
import { useToast } from "@/components/ui/toast";
import {
  cancelOwnReservation,
  checkReservationPayment,
  createOwnReservation,
  fetchDayAvailability,
  payReservationDeposit,
} from "@/lib/data/customer-actions";
import { reservationStatusLabel, RESERVATION_STATUS_TONE } from "@/lib/format/reservation-status";
import { intlLocale, useLocale } from "@/lib/i18n/use-locale";
import type { CustomerReservation } from "@/lib/data/customer";
import type { PublicRestaurant } from "@/lib/data/public";
import { formatDate, formatDayLabel, formatTime, weekdayName } from "@/lib/format/datetime";
import { formatMoney } from "@/lib/format/currency";
import { depositChargedNow } from "@/lib/reservations/deposit";
import { PaymentPendingView } from "@/components/payment/payment-pending";
import {
  canCustomerCancelReservation,
  canCustomerPayReservation,
  partitionCustomerReservations,
} from "@/lib/reservations/lifecycle";
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
  // The Upcoming list is server data: after a payment the row's status and
  // deposit both change, and a refresh is what shows the new truth rather than
  // patching two fields locally and hoping they match.
  const router = useRouter();
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
  /** Whether the 8+ chip is showing the stepper for a large party. */
  const [bigParty, setBigParty] = useState(false);

  /*
    ─────────────────────────────────────────────────────────────────────────
     WHICH SLOTS ARE ACTUALLY TAKEN, ASKED BEFORE ANYTHING IS TYPED.

     `slots` is opening-hours arithmetic; this is the real capacity answer,
     and until now it existed only inside the submit handler. A full Saturday
     was therefore a dead end reached after the party size, the notes and the
     phone number had all been entered, and the refusal named no alternative.

     `full` greys those slots rather than removing them — a slot that
     disappears reads as a bug, a greyed one reads as an answer.

     `checking` drives a quiet line rather than a spinner over the grid: the
     answer usually lands in well under a second, and a grid that flickers
     empty on every party-size tap is worse than one that is briefly stale.
    ─────────────────────────────────────────────────────────────────────────
  */
  const [fullSlotList, setFullSlotList] = useState<string[]>([]);
  const [checkingSlots, setCheckingSlots] = useState(false);
  const [availabilityFailed, setAvailabilityFailed] = useState(false);

  const [busy, setBusy] = useState(false);
  /** The booking whose deposit is being charged right now, or null. */
  const [payingId, setPayingId] = useState<string | null>(null);
  const firstPendingReservation = initial.find((reservation) => reservation.paymentAttemptId);
  const [paymentScreenId, setPaymentScreenId] = useState<string | null>(
    () => firstPendingReservation?.id ?? null,
  );
  const [paymentScreenOpen, setPaymentScreenOpen] = useState(
    () => firstPendingReservation !== undefined,
  );
  const [cancelId, setCancelId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const automaticallyPolledAttempts = useRef(new Set<string>());

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

  const stopPaymentPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => stopPaymentPolling, [stopPaymentPolling]);

  /*
    ADOPT A NEW SERVER SNAPSHOT DURING RENDER, NOT IN AN EFFECT.

    `router.refresh()` supplies fresh rows after a decision, a payment, a
    cancellation or a new booking, and `useState` reads its initializer only
    once — so the list has to be told. Doing that in an effect renders the
    STALE list first and the fresh one a frame later, which is the cascading
    render React now warns about; comparing the prop to the last one seen and
    adjusting mid-render publishes the new rows in the same pass.

    The pattern is React's own "adjusting state when a prop changes", and it
    is already used for the modifier sheet's dish reset.
  */
  const [lastInitial, setLastInitial] = useState(initial);
  if (lastInitial !== initial) {
    setLastInitial(initial);
    setMine(initial);
  }

  /**
   * Watch one trackable CamerPay attempt without ever turning a browser
   * timeout into a payment failure. The webhook and server reconciler keep
   * working after a phone sleeps, so the pending row and screen remain until
   * a real terminal provider status arrives.
   */
  const startPaymentPolling = useCallback(
    (attemptId: string, reservationId: string, paymentPhone?: string | null) => {
      stopPaymentPolling();
      setPayingId(reservationId);
      setPaymentScreenId(reservationId);
      setPaymentScreenOpen(true);
      setMine((current) =>
        current.map((row) =>
          row.id === reservationId
            ? {
                ...row,
                paymentAttemptId: attemptId,
                paymentPhone: paymentPhone ?? row.paymentPhone,
              }
            : row,
        ),
      );

      let tries = 0;
      let checking = false;
      pollRef.current = setInterval(async () => {
        if (checking) return;
        checking = true;
        tries += 1;

        try {
          const check = await checkReservationPayment(attemptId);
          if (check.status === "succeeded") {
            stopPaymentPolling();
            setPayingId(null);
            setPaymentScreenOpen(false);
            setMine((current) =>
              current.map((row) =>
                row.id === reservationId
                  ? {
                      ...row,
                      status: "confirmed",
                      depositPaid: true,
                      paymentAttemptId: null,
                      paymentPhone: null,
                    }
                  : row,
              ),
            );
            toast(t("crs.depositPaidDone"), "success");
            router.refresh();
          } else if (!check.ok || check.status === "failed") {
            stopPaymentPolling();
            setPayingId(null);
            setPaymentScreenOpen(false);
            setMine((current) =>
              current.map((row) =>
                row.id === reservationId
                  ? { ...row, paymentAttemptId: null, paymentPhone: null }
                  : row,
              ),
            );
            toast(check.ok ? t("crs.payFailed") : check.error, "error");
            router.refresh();
          } else if (tries >= POLL_TRIES) {
            stopPaymentPolling();
            setPayingId(null);
            // Keep the screen and the pending marker. This is still a live
            // payment, merely one that needs the background worker longer.
            setPaymentScreenOpen(true);
            toast(t("crs.payStillPending"), "info");
            router.refresh();
          }
        } catch {
          // A temporary app/network failure is not a provider refusal. Leave
          // the attempt visible and let the next interval (or reload) retry.
          if (tries >= POLL_TRIES) {
            stopPaymentPolling();
            setPayingId(null);
            setPaymentScreenOpen(true);
            toast(t("crs.payStillPending"), "info");
          }
        } finally {
          checking = false;
        }
      }, POLL_INTERVAL_MS);
    },
    /*
      THE SETTERS ARE LISTED, AND LISTING THEM CHANGES NOTHING AT RUNTIME.

      React guarantees a `useState` setter is referentially stable for the life
      of the component, which is why convention omits them — and why omitting
      them here was not a bug. But the React Compiler's
      preserve-manual-memoization check does not special-case that guarantee:
      it inferred `setPaymentScreenOpen` as a dependency, found it absent from
      this list, could not prove the manual memoization equivalent to its own,
      and SKIPPED OPTIMISING THE WHOLE COMPONENT rather than risk changing when
      the callback is rebuilt.

      Naming them satisfies the check without altering behaviour by one render:
      a stable reference in a dependency array is a no-op. The alternative —
      restructuring live Mobile Money polling to suit a compiler — would risk
      real money to silence a lint error, which is the wrong trade.
    */
    [router, stopPaymentPolling, t, toast, setPayingId, setPaymentScreenId, setPaymentScreenOpen, setMine],
  );

  // Reloading or navigating back to the page adopts the latest server-side
  // attempt and resumes it automatically. Each id is auto-started once; the
  // explicit “check again” action below may restart it whenever the user asks.
  useEffect(() => {
    const pending = initial.find((reservation) => reservation.paymentAttemptId);
    if (!pending?.paymentAttemptId) return;
    if (automaticallyPolledAttempts.current.has(pending.paymentAttemptId)) return;
    automaticallyPolledAttempts.current.add(pending.paymentAttemptId);
    startPaymentPolling(pending.paymentAttemptId, pending.id, pending.paymentPhone);
  }, [initial, startPaymentPolling]);

  const { upcoming, history: past } = partitionCustomerReservations(mine, now);

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

  /*
    Ask the server which slots are taken, whenever the question changes.

    Sequence-guarded rather than debounced-only: tapping 2 -> 4 -> 6 quickly
    fires three requests, and without the guard the answer for "2" can land
    last and grey the wrong slots. The counter makes every stale reply a
    no-op. Debounced too, so a run along the party chips costs one query
    rather than six.
  */
  const availabilitySeq = useRef(0);
  const restaurantId = selectedRestaurant?.id ?? null;

  useEffect(() => {
    /*
      The early exit does NOT clear state synchronously — writing state in an
      effect body is a cascading render, and the values are derived below
      instead: with no restaurant or no date there is no grid to grey, so
      `fullSlots` reads as empty whatever this holds.
    */
    if (!restaurantId || !date) return;

    const seq = ++availabilitySeq.current;

    const timer = setTimeout(() => {
      // Raised INSIDE the debounce, not beside it: a synchronous write in an
      // effect body is a cascading render, and "checking…" during the 250ms
      // pause would flash on every keystroke along the party chips without
      // anything actually being checked yet.
      setCheckingSlots(true);
      void fetchDayAvailability({ restaurantId, date, partySize: guestCount })
        .then((result) => {
          if (seq !== availabilitySeq.current) return;
          setFullSlotList(result.ok ? result.full : []);
          // A failed check leaves every slot enabled. Greying the whole grid
          // because a query failed would refuse bookings the restaurant could
          // have taken; the server re-checks at submit either way.
          setAvailabilityFailed(!result.ok);
        })
        .catch(() => {
          if (seq !== availabilitySeq.current) return;
          setFullSlotList([]);
          setAvailabilityFailed(true);
        })
        .finally(() => {
          if (seq === availabilitySeq.current) setCheckingSlots(false);
        });
    }, 250);

    return () => clearTimeout(timer);
  }, [restaurantId, date, guestCount]);

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
    Only meaningful once there IS a grid. Derived rather than cleared in the
    effect above, so a restaurant or date change cannot leave the previous
    day's greyed slots on screen for a frame.
  */
  const asking = Boolean(restaurantId && date);
  const fullSlots = asking ? fullSlotList : [];
  const checking = asking && checkingSlots;
  const availabilityUnknown = asking && availabilityFailed;

  /** Every slot the restaurant offers today is already taken. */
  const wholeDayFull = slots.length > 0 && fullSlots.length === slots.length;

  /*
    Drop a slot that the chosen day no longer offers — a different restaurant,
    a different date, or simply the minute it stopped being bookable — and one
    that has since filled up. Adjusted during render rather than in an effect
    so the form is never submittable with a time the grid is no longer showing,
    or one the server would refuse.
  */
  if (time && (!slots.includes(time) || fullSlots.includes(time))) setTime("");

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

    /*
      No payment branch here any more. Requesting a table takes no money — the
      deposit is asked for after the restaurant accepts, by `payDeposit` below.
      The old code polled a payment attempt from this point, which is what made
      a decline into a refund.
    */
    toast(t("crs.sent"), "success");
    setDate("");
    setTime("");
    setNotes("");
    router.refresh();
  }

  /**
   * Pay the deposit on a booking the restaurant has already accepted.
   *
   * The live-mode flow is unchanged from the old pay-at-booking path — the
   * charge goes to the handset, the row stays unpaid until the customer
   * approves, and this polls until the provider or its webhook settles it. All
   * that moved is WHEN it runs: after a yes, rather than before anyone looked.
   */
  async function payDeposit(reservation: CustomerReservation) {
    if (!phone.trim()) {
      toast(t("crs.phoneRequired"), "error");
      return;
    }

    stopPaymentPolling();
    setPayingId(reservation.id);
    setPaymentScreenId(reservation.id);
    setPaymentScreenOpen(true);
    const result = await payReservationDeposit(reservation.id, phone);

    if (!result.ok) {
      setPayingId(null);
      setPaymentScreenOpen(false);
      toast(result.error, "error");
      return;
    }

    if (result.status === "pending" && result.attemptId) {
      automaticallyPolledAttempts.current.add(result.attemptId);
      startPaymentPolling(result.attemptId, reservation.id, phone.trim());
      return;
    }

    setPayingId(null);
    setPaymentScreenOpen(false);
    setMine((current) =>
      current.map((row) =>
        row.id === reservation.id
          ? {
              ...row,
              status: "confirmed",
              depositPaid: true,
              paymentAttemptId: null,
              paymentPhone: null,
            }
          : row,
      ),
    );
    toast(t("crs.depositPaidDone"), "success");
    router.refresh();
  }

  async function confirmCancel() {
    if (!cancelId) return;
    setBusy(true);
    const result = await cancelOwnReservation(cancelId);
    setBusy(false);
    if (result.ok) {
      setMine((current) =>
        current.map((row) => (row.id === cancelId ? { ...row, status: "cancelled" } : row)),
      );
      toast(t("crs.cancelled"), "info");
      router.refresh();
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
      {/*
        THE FORM COMES FIRST ON A PHONE.

        The source order is history-then-form because on a wide screen the form
        is a sticky right-hand rail, which is right. Stacked on a phone that
        puts "Upcoming" and the whole of "History" above the thing the page
        exists for — someone arriving to book a table scrolls past every
        booking they have ever made to reach the first field.

        `order-*` moves it visually without touching the DOM order, so the
        heading structure a screen reader walks is unchanged and the desktop
        rail keeps its position.
      */}
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="order-2 flex flex-col gap-6 lg:order-1">
          <Panel title={t("crs.upcoming")}>
            {upcoming.length === 0 ? (
              <EmptyState
                icon={<CalendarCheck />}
                title={t("crs.upcomingEmpty")}
                description={t("crs.upcomingEmptyBody")}
              />
            ) : (
              <ul className="divide-y divide-border">
                {upcoming.map((r) => {
                  const hasPendingPayment = Boolean(r.paymentAttemptId);
                  const owes = canCustomerPayReservation(r) && !hasPendingPayment;
                  const busyHere = payingId === r.id;
                  return (
                    <li key={r.id} className="px-5 py-4">
                      <div className="flex flex-wrap items-center gap-4">
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

                        {canCustomerCancelReservation(r.status) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busyHere || hasPendingPayment}
                            onClick={() => setCancelId(r.id)}
                          >
                            {t("crs.cancel")}
                          </Button>
                        )}
                      </div>

                      {/*
                        THE BILL, WHERE THE BOOKING IS — not on the form.

                        This is the second half of request → decide → pay. The
                        restaurant has accepted and is holding the table; this
                        is the only moment money is asked for, and it names the
                        amount, why it is owed, and that it comes off the final
                        bill. The number is the row's own snapshot, so a
                        restaurant that raised its fee since cannot change what
                        this customer was quoted.
                      */}
                      {owes && (
                        <div className="mt-3 flex min-w-0 flex-col gap-3 rounded-md border border-warning/30 bg-warning-light p-3">
                          <p className="text-xs leading-relaxed break-words text-warning">
                            <strong>
                              {t("crs.depositDue", { amount: formatMoney(r.depositAmount) })}
                            </strong>{" "}
                            {t("crs.depositDueBody")}
                          </p>

                          <Field
                            label={t("crs.phone")}
                            htmlFor={`res-phone-${r.id}`}
                            hint={t("crs.phoneHint")}
                          >
                            <Input
                              id={`res-phone-${r.id}`}
                              icon={<Smartphone className="size-4" aria-hidden />}
                              inputMode="tel"
                              autoComplete="tel"
                              placeholder={t("crs.phonePh")}
                              value={phone}
                              disabled={busyHere}
                              onChange={(e) => setPhone(e.target.value)}
                            />
                          </Field>

                          <Button
                            size="lg"
                            fullWidth
                            loading={busyHere}
                            disabled={payingId !== null}
                            onClick={() => void payDeposit(r)}
                            className="px-4 text-center leading-snug whitespace-normal"
                          >
                            {!busyHere && <Smartphone className="size-4 shrink-0" aria-hidden />}
                            <span>
                              {busyHere
                                ? t("crs.payPendingTitle")
                                : t("crs.payDeposit", { amount: formatMoney(r.depositAmount) })}
                            </span>
                          </Button>

                          {busyHere && (
                            <p className="text-center text-xs leading-relaxed text-warning/90">
                              {t("crs.payPendingBody")}
                            </p>
                          )}
                        </div>
                      )}

                      {hasPendingPayment && (
                        <div className="mt-3 flex min-w-0 flex-col gap-3 rounded-md border border-info/30 bg-info-light p-3">
                          <p className="text-xs leading-relaxed break-words text-info">
                            {t("crs.pendingBanner")}
                          </p>
                          <Button
                            variant="outline"
                            fullWidth
                            loading={busyHere}
                            onClick={() => {
                              setPaymentScreenId(r.id);
                              setPaymentScreenOpen(true);
                              if (r.paymentAttemptId && payingId === null) {
                                startPaymentPolling(r.paymentAttemptId, r.id, r.paymentPhone);
                              }
                            }}
                          >
                            <Smartphone className="size-4" aria-hidden />
                            {busyHere ? t("crs.payPendingTitle") : t("crs.viewPayment")}
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
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

        <aside className="order-1 rounded-lg border border-border bg-surface p-5 lg:order-2 lg:sticky lg:top-24">
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

            {/*
              ─────────────────────────────────────────────────────────────
               PARTY SIZE FIRST, BECAUSE EVERY OTHER ANSWER DEPENDS ON IT.

               The server's own capacity rule is `table.capacity >= partySize`
               — which means "is 20:00 free?" has no answer until the platform
               knows how many people are coming. Asking it second-to-last, as
               this form did, is why availability could only be tested at
               submit.

               Chips rather than `<input type="number">`. Four columns because
               272px across six would give 41px targets, under the floor the
               slot grid below already learned the hard way. Above seven, the
               stepper handles the long tail without spending a row of chips
               on party sizes almost nobody books.
              ─────────────────────────────────────────────────────────────
            */}
            <fieldset>
              <legend className="mb-2 text-[11px] font-bold tracking-[0.08em] text-text-light uppercase">
                {t("crs.guests")}
              </legend>
              <div className="grid grid-cols-4 gap-2">
                {[1, 2, 3, 4, 5, 6, 7].map((n) => {
                  const chosen = guestCount === n && !bigParty;
                  return (
                    <button
                      key={n}
                      type="button"
                      aria-pressed={chosen}
                      onClick={() => {
                        setBigParty(false);
                        setGuests(String(n));
                      }}
                      className={`tnum inline-flex min-h-11 items-center justify-center rounded-md border text-sm font-medium transition-colors ${
                        chosen
                          ? "border-primary bg-primary text-primary-fg"
                          : "border-border hover:border-primary hover:text-primary"
                      }`}
                    >
                      {n}
                    </button>
                  );
                })}
                <button
                  type="button"
                  aria-pressed={bigParty}
                  onClick={() => {
                    setBigParty(true);
                    if (guestCount < 8) setGuests("8");
                  }}
                  className={`inline-flex min-h-11 items-center justify-center rounded-md border text-sm font-medium transition-colors ${
                    bigParty
                      ? "border-primary bg-primary text-primary-fg"
                      : "border-border hover:border-primary hover:text-primary"
                  }`}
                >
                  8+
                </button>
              </div>

              {bigParty && (
                <div className="mt-2.5 flex items-center gap-3">
                  <Users className="size-4 shrink-0 text-text-light" aria-hidden />
                  <QtyStepper
                    value={guestCount}
                    min={8}
                    max={20}
                    onChange={(n) => setGuests(String(n))}
                  />
                  <span className="text-xs text-text-light">
                    {t("crs.people", { count: guestCount })}
                  </span>
                </div>
              )}
            </fieldset>

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
                      const taken = fullSlots.includes(slot);
                      return (
                        <button
                          key={slot}
                          type="button"
                          aria-pressed={chosen}
                          disabled={taken}
                          /*
                            Greyed, not removed. A slot that vanishes between
                            one party-size tap and the next reads as a bug; a
                            greyed one reads as an answer, and the customer can
                            see that 20:00 exists and is simply gone.
                          */
                          title={taken ? t("crs.slotFull") : undefined}
                          onClick={() => setTime(slot)}
                          className={`tnum inline-flex min-h-11 items-center justify-center rounded-md border px-2 text-sm font-medium transition-colors ${
                            taken
                              ? "cursor-not-allowed border-border bg-surface-2 text-text-light line-through opacity-60"
                              : chosen
                                ? "border-primary bg-primary text-primary-fg"
                                : "border-border hover:border-primary hover:text-primary"
                          }`}
                        >
                          {slot}
                        </button>
                      );
                    })}
                  </div>

                  {wholeDayFull ? (
                    <p className="mt-2 rounded-md border border-warning/30 bg-warning-light px-3 py-2.5 text-xs leading-relaxed text-warning">
                      {t("crs.dayFull", { count: guestCount })}
                    </p>
                  ) : fullSlots.length > 0 ? (
                    <p className="mt-2 text-xs text-text-light">{t("crs.someSlotsFull")}</p>
                  ) : null}

                  {checking && (
                    <p className="mt-2 text-xs text-text-light">{t("crs.checkingAvailability")}</p>
                  )}
                  {availabilityUnknown && !checking && (
                    <p className="mt-2 text-xs text-text-light">{t("crs.availabilityFailed")}</p>
                  )}
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
              THE FEE IS QUOTED HERE, NOT COLLECTED HERE.

              This used to be a Mobile Money field, and pressing the button
              took the money there and then — while the request was still
              `pending` and nobody at the restaurant had seen it. A restaurant
              that was full then declined a booking it had never agreed to,
              leaving a refund to chase for a table that never existed. The
              customer is now told what it will cost and asked for nothing;
              the bill arrives, on the Upcoming list, only once the restaurant
              has said yes.

              `min-w-0` and `break-words`: this is the other half of the "form
              is not responsive once a deposit is required" report. Without a
              zero minimum a flex child is floored at its content's intrinsic
              width, and one long formatted amount widened the whole aside past
              the viewport — the page scrolled sideways, which reads as a
              broken layout rather than one box being too wide.
            */}
            {depositCharged > 0 ? (
              <div className="flex min-w-0 flex-col gap-1.5 rounded-md border border-warning/30 bg-warning-light p-3">
                <p className="text-xs leading-relaxed break-words text-warning">
                  <strong>{t("crs.deposit", { amount: formatMoney(depositCharged) })}</strong>{" "}
                  {t("crs.depositAfterConfirm")}
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
              loading={busy}
              disabled={!date || !time || busy}
              onClick={submit}
              className="px-4 text-center leading-snug whitespace-normal"
            >
              <Check className="size-4 shrink-0" aria-hidden />
              {/* Always "request a table" now: pressing this takes no money,
                  so a label promising a payment would be a lie. */}
              <span>{t("crs.submit")}</span>
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

      {(() => {
        const reservation = mine.find((row) => row.id === paymentScreenId);
        if (!reservation) return null;
        return (
          <Dialog
            open={paymentScreenOpen}
            onClose={() => setPaymentScreenOpen(false)}
            title={t("crs.payPendingTitle")}
            size="sm"
            footer={
              <Button variant="outline" onClick={() => setPaymentScreenOpen(false)}>
                {t("crs.continueBackground")}
              </Button>
            }
          >
            <PaymentPendingView
              body={t("crs.payPendingBody")}
              hint={t("crs.payPendingHint")}
              amountLabel={t("crs.paymentAmount")}
              amount={formatMoney(reservation.depositAmount)}
              referenceLabel={t("crs.paymentReference")}
              reference={reservation.reference}
              phoneLabel={t("crs.paymentPhone")}
              phone={reservation.paymentPhone ?? phone}
              gatewayLabel={t("crs.paymentGateway")}
              requesting={payingId === reservation.id && !reservation.paymentAttemptId}
            />
          </Dialog>
        );
      })()}
    </AccountShell>
  );
}
