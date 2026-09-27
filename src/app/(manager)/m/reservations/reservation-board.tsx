"use client";

import { useMemo, useState, useTransition } from "react";
import { Ban, Banknote, CalendarCheck, Check, Clock, History, NotebookPen, Phone, Plus, Ticket, Users, X } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  createPhoneReservation,
  decideReservationChange,
  saveGuestNote,
  suggestTablesFor,
} from "@/lib/data/booking-manager-actions";
import { redeemVoucher } from "@/lib/data/voucher-actions";
import { OCCASIONS, type Occasion } from "@/lib/reservations/rules";
import { todayInDisplayTz } from "@/lib/reservations/slots";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MessageCustomerButton } from "@/components/chat/message-customer-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Sheet, SheetActions } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { useDates } from "@/lib/format/use-dates";
import { useLocale } from "@/lib/i18n/use-locale";
import {
  cancelConfirmedReservation,
  collectReservationDeposit,
  decideReservation,
  setReservationStatus,
  setRestaurantDeposit,
} from "@/lib/data/manager-actions";
import { type DepositType } from "@/lib/reservations/deposit";
import {
  canManagerCollectReservationDeposit,
  canMarkReservationNoShow,
  canRestaurantCancelReservation,
} from "@/lib/reservations/lifecycle";
import {
  deadlinePassed,
  noShowAllowedFrom,
  requestAnswerDeadline,
  sittingEnd,
} from "@/lib/reservations/timing";
import type { Reservation, RestaurantTable } from "@/lib/data/manager";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

/**
 * Which sentence describes each kind of fee. A lookup rather than a chain of
 * ternaries: three kinds is where a `x === "percent" ? … : …` starts quietly
 * lumping the two it does not name into one branch.
 */
const DEPOSIT_TITLE_KEY: Record<DepositType, TranslationKey> = {
  fixed: "res.depositTitle",
  per_seat: "res.perSeatTitle",
  percent: "res.percentTitle",
};

const DEPOSIT_BODY_KEY: Record<DepositType, TranslationKey> = {
  fixed: "res.depositBody",
  per_seat: "res.perSeatBody",
  percent: "res.percentBody",
};

const STATUS_TONE: Record<Reservation["status"], BadgeTone> = {
  pending: "warning",
  // Accepted, table held, money outstanding — not a settled booking, and the
  // board should not let it read like one.
  awaiting_payment: "warning",
  confirmed: "success",
  seated: "info",
  completed: "neutral",
  cancelled: "error",
  no_show: "error",
};

export function ReservationBoard({
  reservations,
  tables,
  canDecide,
  canSeat = canDecide,
  depositAmount,
  depositType: storedDepositType,
  canCollectDeposit,
  canTakeDeposit = canCollectDeposit,
  responseMinutes,
  now,
  tableService = false,
}: {
  reservations: Reservation[];
  tables: RestaurantTable[];
  canDecide: boolean;
  /** Seat / no-show / complete — waiters and cashiers too (reservations.seat). */
  canSeat?: boolean;
  /** The restaurant's current acompte (migration 0025). */
  depositAmount: number;
  /** How the acompte works (migration 0031): fixed FCFA or % of the bill. */
  depositType: DepositType;
  canCollectDeposit: boolean;
  /** Record a deposit paid at the counter (payments.collect). */
  canTakeDeposit?: boolean;
  /** The admin's booking-request time limit (0059), for "Répondre avant". */
  responseMinutes: number;
  /** Server-stamped render instant — never Date.now() in render. */
  now: number;
  /** Enterprise table service: seating a booking can open its bill (0068). */
  tableService?: boolean;
}) {
  const { t } = useLocale();
  const dates = useDates();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const router = useRouter();
  const [confirming, setConfirming] = useState<Reservation | null>(null);
  /** Several tables for one booking (0068) — a big group at tables pushed together. */
  const [tableIds, setTableIds] = useState<string[]>([]);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState({ guestName: "", guestPhone: "", partySize: 2, date: "", time: "", notes: "", occasion: "" as Occasion | "" });
  const [noteFor, setNoteFor] = useState<Reservation | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [declineChange, setDeclineChange] = useState<Reservation | null>(null);
  const [changeReason, setChangeReason] = useState("");
  const [declining, setDeclining] = useState<Reservation | null>(null);
  const [reason, setReason] = useState("");
  const [depositDraft, setDepositDraft] = useState(String(depositAmount));
  /*
    The kind of fee, as a draft. Seeded from the stored value and owned by the
    select until Save, so switching from "fixed" to "per guest" re-labels the
    row immediately and the amount beside it is read as a per-guest rate before
    it is written — which is the point of showing the two together.
  */
  const [depositType, setDepositTypeDraft] = useState<DepositType>(storedDepositType);
  const [collecting, setCollecting] = useState<Reservation | null>(null);
  const [billDraft, setBillDraft] = useState("");
  const [cancelling, setCancelling] = useState<Reservation | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  // Pending first, whatever the time. A decision waiting is more urgent than a
  // booking already settled, even one that is sooner.
  const { awaiting, rest } = useMemo(
    () => ({
      awaiting: reservations.filter((r) => r.status === "pending"),
      rest: reservations.filter((r) => r.status !== "pending"),
    }),
    [reservations],
  );

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) return toast(result.error ?? t("common.error"), "error");
      toast(success, "success");
      router.refresh();
    });
  }

  /** Open the confirm sheet with the seating rule's suggestion preselected. */
  function openConfirm(reservation: Reservation) {
    setConfirming(reservation);
    setTableIds(reservation.tableIds);
    startTransition(async () => {
      const suggestion = await suggestTablesFor(reservation.id);
      if (suggestion.ok && suggestion.tableIds.length) setTableIds(suggestion.tableIds);
    });
  }

  /**
   * Seating a booking uses its voucher (0068): one transaction marks it
   * seated, and — with table service — opens the party's bill on its first
   * table with the deposit already deducted.
   */
  function seat(reservation: Reservation) {
    if (!reservation.voucherCode) {
      run(() => setReservationStatus(reservation.id, "seated"), t("res.seatedDone"));
      return;
    }
    const code = reservation.voucherCode;
    run(async () => {
      const result = await redeemVoucher(code, { openTableId: tableService ? reservation.tableIds[0] ?? null : null });
      if (!result.ok) return result;
      if (result.credit > 0 && !(tableService && reservation.tableIds[0])) {
        toast(t("ons.c.deductByHand", { amount: result.credit.toLocaleString("fr-CM") + " FCFA" }), "info");
      }
      return { ok: true };
    }, t("res.seatedDone"));
  }

  function row(reservation: Reservation) {
    const end = sittingEnd(reservation.reservedFor, reservation.durationMin);
    const answerBy =
      reservation.status === "pending"
        ? requestAnswerDeadline(
            { createdAt: reservation.createdAt, reservedFor: reservation.reservedFor },
            responseMinutes,
          )
        : null;
    const answerLate = deadlinePassed(answerBy, now);
    const noShowReady = canMarkReservationNoShow(reservation, now);
    const noShowFrom = noShowAllowedFrom(reservation.reservedFor);
    const mayCollectDeposit =
      canTakeDeposit &&
      canManagerCollectReservationDeposit({
        status: reservation.status,
        depositPercent: reservation.depositPercent,
        depositPaid: reservation.depositPaid,
      });

    return (
      <li key={reservation.id} className="flex flex-wrap items-center gap-4 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{reservation.guestName}</p>
            <Badge tone={STATUS_TONE[reservation.status]}>
              {t(`res.status.${reservation.status}` as TranslationKey)}
            </Badge>
            {reservation.tableNumbers.length > 0 && (
              <Badge tone="neutral">
                {reservation.tableNumbers.length > 1 ? t("ons.m.tables") : t("res.table")} {reservation.tableNumbers.join(" + ")}
              </Badge>
            )}
            {reservation.isGroupRequest && <Badge tone="info">{t("ons.c.groupRequest")}</Badge>}
            {reservation.occasion && <Badge tone="accent">{t(`ons.c.occasion.${reservation.occasion}` as TranslationKey)}</Badge>}
            {reservation.seatingPreference && <Badge tone="neutral">{reservation.seatingPreference}</Badge>}
            {reservation.source === "phone" && <Badge tone="neutral"><Phone className="size-3" aria-hidden />{t("ons.m.phoneBooking")}</Badge>}
            {reservation.voucherRedeemedAt && <Badge tone="success"><Ticket className="size-3" aria-hidden />{t("ons.m.voucherUsed")}</Badge>}
          </div>

          {/* The END of the sitting too (0060): it is what decides whether the
              table can be given to the next booking. */}
          <p className="tnum mt-0.5 text-sm text-text-secondary">
            {end
              ? t("mres.window", { start: dates.dateTime(reservation.reservedFor), end: dates.time(end) })
              : dates.dateTime(reservation.reservedFor)}
          </p>

          {/* The request deadline the reservation clock enforces — shown so
              the restaurant knows how long it has, not told afterwards. */}
          {answerBy && (
            <p
              className={`mt-1 flex items-center gap-1 text-xs font-semibold ${
                answerLate ? "text-error" : "text-warning"
              }`}
            >
              <Clock className="size-3" aria-hidden />
              <span>
                {answerLate ? t("mres.answerLate") : t("mres.answerBefore", { time: dates.time(answerBy) })}
              </span>
            </p>
          )}

          <p className="mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-light">
            <span className="flex items-center gap-1">
              <Users className="size-3" aria-hidden />
              {t("m.people", { count: reservation.partySize })}
            </span>
            {/* No guest phone: the only number a restaurant sees is a customer's
                during a paid delivery (lib/data/orders). Bookings talk in the chat. */}
            <span className="tnum">{reservation.reference}</span>
            {reservation.voucherCode && <span className="tnum font-mono">{reservation.voucherCode}</span>}
            {/* In-app chat about this booking (server checks the link). */}
            <MessageCustomerButton reservationId={reservation.id} variant="link" size="sm" />
          </p>

          {reservation.notes && (
            <p className="mt-1.5 rounded-md bg-surface-2 p-2 text-sm text-text-secondary">
              {reservation.notes}
            </p>
          )}

          {/* Guest history at THIS restaurant, and the team's private note. */}
          {reservation.guestHistory && (
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
              <span className="inline-flex items-center gap-1"><History className="size-3" aria-hidden />
                {reservation.guestHistory.visits > 0 ? t("ons.m.visits", { count: reservation.guestHistory.visits }) : t("ons.m.firstVisit")}
              </span>
              {reservation.guestHistory.noShows > 0 && <span className="font-semibold text-error">{t("ons.m.noShows", { count: reservation.guestHistory.noShows })}</span>}
              {reservation.guestHistory.note && <span className="italic">« {reservation.guestHistory.note} »</span>}
              {canDecide && (
                <button type="button" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                  onClick={() => { setNoteFor(reservation); setNoteDraft(reservation.guestHistory?.note ?? ""); }}>
                  <NotebookPen className="size-3" aria-hidden />{t("ons.m.note")}
                </button>
              )}
            </p>
          )}

          {/* A customer asked to move this booking (0068). */}
          {reservation.pendingChange && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-info/30 bg-info-light p-2 text-sm">
              <span className="min-w-0 flex-1">{t("ons.m.changeAsked", {
                when: dates.dateTime(reservation.pendingChange.reservedFor),
                count: reservation.pendingChange.partySize,
              })}</span>
              {canDecide && (
                <>
                  <Button size="sm" disabled={pending} onClick={() => run(() => decideReservationChange(reservation.id, true), t("ons.m.changeAccepted"))}>{t("ons.m.acceptChange")}</Button>
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => { setDeclineChange(reservation); setChangeReason(""); }}>{t("ons.m.declineChange")}</Button>
                </>
              )}
            </div>
          )}

          {/* The refusal reason is shown back to the restaurant too — it is
              what the guest was told, and staff get asked about it. */}
          {reservation.declineReason && (
            <p className="mt-1.5 text-sm text-error">
              {t("res.declined")} {reservation.declineReason}
            </p>
          )}

          {reservation.depositAmount > 0 || reservation.depositPercent > 0 ? (
            <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
              {reservation.depositPercent > 0 ? (
                <Badge
                  tone={reservation.depositPaid ? "success" : "warning"}
                  className={reservation.depositPaid ? undefined : "border-transparent"}
                >
                  <Banknote className="size-3" aria-hidden />
                  {t("res.depositPercent", { pct: reservation.depositPercent })}
                </Badge>
              ) : (
                <Badge
                  tone={reservation.depositPaid ? "success" : "warning"}
                  className={reservation.depositPaid ? undefined : "border-transparent"}
                >
                  <Banknote className="size-3" aria-hidden />
                  {t("res.deposit", { amount: reservation.depositAmount.toLocaleString("fr-CM") })}
                </Badge>
              )}
              {reservation.depositPaid && (
                <span className="text-success">{t("res.depositPaid")}</span>
              )}
              {mayCollectDeposit && (
                <>
                  {reservation.depositPercent > 0 ? (
                    /* A percentage deposit needs the real bill — ask for it. */
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() => {
                        setCollecting(reservation);
                        setBillDraft("");
                      }}
                    >
                      <Banknote className="size-3.5" aria-hidden />
                      {t("res.collectDeposit")}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() => {
                        setCollecting(reservation);
                        setBillDraft("");
                      }}
                    >
                      <Banknote className="size-3.5" aria-hidden />
                      {t("res.markCashReceived")}
                    </Button>
                  )}
                </>
              )}
            </p>
          ) : null}
        </div>

        {(canDecide || canSeat) && (
          <div className="flex shrink-0 flex-wrap gap-2">
            {canDecide && reservation.status === "pending" && (
              <>
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() => openConfirm(reservation)}
                >
                  <Check className="size-3.5" aria-hidden />
                  {t("common.confirm")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-error hover:bg-error-light"
                  disabled={pending}
                  onClick={() => {
                    setDeclining(reservation);
                    setReason("");
                  }}
                >
                  <X className="size-3.5" aria-hidden />
                  {t("res.decline")}
                </Button>
              </>
            )}

            {/*
              A HELD TABLE HAS TO BE RELEASABLE.

              `awaiting_payment` means the restaurant said yes and is waiting
              to be paid, and the seat counts against availability the whole
              time. Without this the only way out was for the customer to pay
              or to cancel — so a guest who booked and vanished held a table
              until the sitting was over. The deposit buttons above stay
              available too: a guest who turns up and pays in cash is collected
              there, and that confirms the booking the same way.
            */}
            {canDecide && reservation.status === "awaiting_payment" && (
              <Button
                variant="ghost"
                size="sm"
                className="text-error hover:bg-error-light"
                disabled={pending}
                onClick={() => {
                  setDeclining(reservation);
                  setReason("");
                }}
              >
                <X className="size-3.5" aria-hidden />
                {t("res.release")}
              </Button>
            )}

            {canSeat && reservation.status === "confirmed" && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => seat(reservation)}
                >
                  {t("res.seat")}
                </Button>
                {/* FAIR NO-SHOW: greyed, with the time it unlocks, until 15
                    minutes after the booked time. The action refuses too. */}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending || !noShowReady}
                  title={
                    !noShowReady && noShowFrom
                      ? t("mres.noShowFrom", { time: dates.time(noShowFrom) })
                      : undefined
                  }
                  onClick={() =>
                    run(() => setReservationStatus(reservation.id, "no_show"), t("res.noShowDone"))
                  }
                >
                  {t("res.noShow")}
                </Button>
                {canDecide && canRestaurantCancelReservation(reservation.status) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-error hover:bg-error-light"
                    disabled={pending}
                    onClick={() => {
                      setCancelling(reservation);
                      setCancelReason("");
                    }}
                  >
                    <Ban className="size-3.5" aria-hidden />
                    {t("mres.cancelBooking")}
                  </Button>
                )}
                {!noShowReady && noShowFrom && (
                  <p className="basis-full text-xs text-text-light">
                    {t("mres.noShowFrom", { time: dates.time(noShowFrom) })}
                  </p>
                )}
              </>
            )}

            {canSeat && reservation.status === "seated" && (
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() =>
                  run(() => setReservationStatus(reservation.id, "completed"), t("res.completedDone"))
                }
              >
                {t("res.complete")}
              </Button>
            )}
          </div>
        )}
      </li>
    );
  }

  return (
    <>
      {canCollectDeposit && (
        <section className="mb-6 rounded-lg border border-border bg-surface p-4">
          {/*
            THE KIND OF FEE IS EDITABLE HERE, NOT ONLY IN THE WIZARD.

            The type arrived as a read-only prop and only the amount could be
            changed, so a restaurant that chose a flat fee during onboarding
            had no way ever to move to a per-seat one — the control showed the
            consequence of a decision it would not let you revisit.

            `min-w-0` on every child and `flex-wrap` on the row: the labels are
            two lines of prose on a phone, and without a zero minimum the
            number input and the select push the row past the viewport.
          */}
          <div className="grid gap-3 sm:grid-cols-2 sm:items-end lg:grid-cols-[minmax(0,1fr)_11rem_10rem_auto]">
            <div className="min-w-0 sm:col-span-2 lg:col-span-1">
              <p className="break-words text-sm font-semibold">{t(DEPOSIT_TITLE_KEY[depositType])}</p>
              <p className="break-words text-xs leading-relaxed text-text-light">
                {t(DEPOSIT_BODY_KEY[depositType])}
              </p>
            </div>

            <Select
              value={depositType}
              onChange={(e) => setDepositTypeDraft(e.target.value as DepositType)}
              aria-label={t("res.depositKind")}
              className="w-full min-w-0"
            >
              <option value="fixed">{t("res.kindFixed")}</option>
              <option value="per_seat">{t("res.kindPerSeat")}</option>
              <option value="percent">{t("res.kindPercent")}</option>
            </Select>

            <div className="flex min-w-0 items-center gap-2">
              <Input
                type="number"
                min={0}
                step={depositType === "percent" ? 1 : 100}
                value={depositDraft}
                onChange={(e) => setDepositDraft(e.target.value)}
                className="min-w-0 flex-1"
                aria-label={t(DEPOSIT_TITLE_KEY[depositType])}
              />
              <span className="shrink-0 text-sm text-text-light">
                {depositType === "percent" ? "%" : "FCFA"}
              </span>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="w-full sm:col-span-2 sm:w-auto sm:justify-self-end lg:col-span-1"
              disabled={pending}
              onClick={() =>
                run(
                  () => setRestaurantDeposit(Number(depositDraft) || 0, { type: depositType }),
                  t("res.depositSaved"),
                )
              }
            >
              <Banknote className="size-3.5" aria-hidden />
              {t("common.save")}
            </Button>
          </div>
        </section>
      )}

      {canDecide && (
        <div className="mb-4 flex justify-end">
          <Button variant="outline" size="sm" onClick={() => { setPhoneDraft({ guestName: "", guestPhone: "", partySize: 2, date: todayInDisplayTz(), time: "", notes: "", occasion: "" }); setPhoneOpen(true); }}>
            <Plus className="size-3.5" aria-hidden />{t("ons.m.phoneBookingNew")}
          </Button>
        </div>
      )}

      {awaiting.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 font-display text-lg font-bold">
            {t("res.awaiting", { count: awaiting.length })}
          </h2>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-warning/30 bg-surface">
            {awaiting.map(row)}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-3 font-display text-lg font-bold">{t("res.upcoming")}</h2>
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          {rest.length === 0 ? (
            <EmptyState
              icon={<CalendarCheck />}
              title={t("res.nothingPlanned")}
              description={t("res.nothingPlannedBody")}
            />
          ) : (
            <ul className="divide-y divide-border">{rest.map(row)}</ul>
          )}
        </div>
      </section>

      {/* ── Confirm ────────────────────────────────────────────────────── */}
      <Sheet
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title={t("res.confirmTitle")}
        footer={
          confirming && (
            <SheetActions>
              <Button variant="outline" onClick={() => setConfirming(null)}>
                <span>{t("common.cancel")}</span>
              </Button>
              <Button
                loading={pending}
                onClick={() => {
                  run(
                    () => decideReservation(confirming.id, "confirmed", { tableIds }),
                    t("res.confirmedDone"),
                  );
                  setConfirming(null);
                }}
              >
                <span>{t("common.confirm")}</span>
              </Button>
            </SheetActions>
          )
        }
      >
        {confirming && (
          <div className="flex flex-col gap-4">
            {/* Each fragment in its own span: a bare text node beside an
                interpolation is what browser auto-translate turns into an
                insertBefore crash. */}
            <p className="text-sm text-text-secondary">
              <span>{confirming.guestName}</span>
              <span> · </span>
              <span>{t("m.people", { count: confirming.partySize })}</span>
              <span> · </span>
              <span>{dates.dateTime(confirming.reservedFor)}</span>
            </p>

            {/*
              SEVERAL TABLES FOR ONE PARTY (0068). The seating rule's
              suggestion is preselected (fewest tables, least waste, the
              guest's zone if possible); the restaurant can change it. The
              seats of the chosen tables must cover the party.
            */}
            <fieldset>
              <legend className="mb-1 text-sm font-semibold">{t("ons.m.tablesFor", { count: confirming.partySize })}</legend>
              <p className="mb-2 text-xs text-text-light">{t("res.tableHint")}</p>
              <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto">
                {tables
                  .filter((table) => !table.planLocked && table.status !== "out_of_service")
                  .map((table) => {
                    const checked = tableIds.includes(table.id);
                    return (
                      <label key={table.id} className={`flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm ${checked ? "border-primary bg-primary-light" : "border-border"}`}>
                        <input type="checkbox" checked={checked} onChange={(e) => setTableIds((current) => e.target.checked ? [...current, table.id] : current.filter((id) => id !== table.id))} />
                        <span className="min-w-0 flex-1 truncate">{t("res.table")} {table.number}{table.zone ? ` · ${table.zone}` : ""}</span>
                        <span className="tnum text-xs text-text-light">{table.capacity}</span>
                      </label>
                    );
                  })}
              </div>
              {(() => {
                const seats = tables.filter((table) => tableIds.includes(table.id)).reduce((sum, table) => sum + table.capacity, 0);
                return tableIds.length > 0 && (
                  <p className={`mt-2 text-xs font-semibold ${seats >= confirming.partySize ? "text-success" : "text-error"}`}>
                    {t("ons.m.seatsChosen", { seats, count: confirming.partySize })}
                  </p>
                );
              })()}
            </fieldset>

          </div>
        )}
      </Sheet>

      {/* ── Decline ────────────────────────────────────────────────────── */}
      <Sheet
        open={declining !== null}
        onClose={() => setDeclining(null)}
        title={t("res.declineTitle")}
        footer={
          declining && (
            <SheetActions>
              <Button variant="outline" onClick={() => setDeclining(null)}>
                <span>{t("common.cancel")}</span>
              </Button>
              <Button
                variant="danger"
                loading={pending}
                disabled={!reason.trim()}
                onClick={() => {
                  run(
                    () => decideReservation(declining.id, "cancelled", { reason }),
                    t("res.declinedDone"),
                  );
                  setDeclining(null);
                }}
              >
                <span>{t("res.decline")}</span>
              </Button>
            </SheetActions>
          )
        }
      >
        {declining && (
          <div className="flex flex-col gap-4">
            <Field
              label={t("res.reason")}
              htmlFor="decline-reason"
              required
              hint={t("res.reasonHint")}
            >
              <Textarea
                id="decline-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("res.reasonPh")}
              />
            </Field>
          </div>
        )}
      </Sheet>

      {/* ── Restaurant cancels a confirmed booking (0060) ──────────────── */}
      <Sheet
        open={cancelling !== null}
        onClose={() => setCancelling(null)}
        title={t("mres.cancelTitle")}
        footer={
          cancelling && (
            <SheetActions>
              <Button variant="outline" onClick={() => setCancelling(null)}>
                <span>{t("common.cancel")}</span>
              </Button>
              <Button
                variant="danger"
                loading={pending}
                disabled={!cancelReason.trim()}
                onClick={() => {
                  const target = cancelling;
                  const why = cancelReason;
                  setCancelling(null);
                  startTransition(async () => {
                    const result = await cancelConfirmedReservation(target.id, why);
                    if (!result.ok) return toast(result.error ?? t("common.error"), "error");
                    toast(t("mres.cancelDone"), "success");
                  });
                }}
              >
                <span>{t("mres.cancelConfirm")}</span>
              </Button>
            </SheetActions>
          )
        }
      >
        {cancelling && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-text-secondary">
              <span>{cancelling.guestName}</span>
              <span> · </span>
              <span>{t("m.people", { count: cancelling.partySize })}</span>
              <span> · </span>
              <span>{dates.dateTime(cancelling.reservedFor)}</span>
            </p>
            <p className="text-sm text-text-secondary">
              <span>{t("mres.cancelBody")}</span>
            </p>
            {/* What happens to the money, before the button is pressed. */}
            <p className="rounded-md bg-warning-light p-3 text-sm text-warning">
              <span>
                {cancelling.depositPaid && cancelling.depositPercent <= 0 && cancelling.depositAmount > 0
                  ? t("mres.cancelRefund", { amount: cancelling.depositAmount.toLocaleString("fr-CM") })
                  : t("mres.cancelNoRefund")}
              </span>
            </p>
            <Field label={t("res.reason")} htmlFor="cancel-reason" required hint={t("res.reasonHint")}>
              <Textarea
                id="cancel-reason"
                rows={3}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder={t("mres.cancelReasonPh")}
              />
            </Field>
          </div>
        )}
      </Sheet>

      {/* ── Record a deposit actually received at the restaurant ───────── */}
      <Sheet
        open={collecting !== null}
        onClose={() => setCollecting(null)}
        title={
          collecting?.depositPercent
            ? t("res.percentTitle")
            : t("res.markCashReceived")
        }
        footer={
          collecting && (
            <SheetActions>
              <Button variant="outline" onClick={() => setCollecting(null)}>
                <span>{t("common.cancel")}</span>
              </Button>
              <Button
                loading={pending}
                disabled={collecting.depositPercent > 0 && !billDraft.trim()}
                onClick={() => {
                  const percentage = collecting.depositPercent > 0;
                  const success = percentage
                    ? t("res.collectPercent", {
                        amount: Math.round(
                          ((Number(billDraft) || 0) * collecting.depositPercent) / 100,
                        ).toLocaleString("fr-CM"),
                      })
                    : t("res.depositCollected");
                  run(
                    () =>
                      collectReservationDeposit(
                        collecting.id,
                        percentage ? Number(billDraft) || 0 : undefined,
                      ),
                    success,
                  );
                  setCollecting(null);
                }}
              >
                <Banknote className="size-4" aria-hidden />
                <span>
                  {collecting.depositPercent > 0
                    ? t("res.collectPercent", {
                        amount: Math.round(
                          ((Number(billDraft) || 0) * collecting.depositPercent) / 100,
                        ).toLocaleString("fr-CM"),
                      })
                    : t("res.markCashReceived")}
                </span>
              </Button>
            </SheetActions>
          )
        }
      >
        {collecting && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-text-secondary">
              <span>{collecting.guestName}</span>
              <span> · </span>
              <span>
                {collecting.depositPercent > 0
                  ? t("res.depositPercent", { pct: collecting.depositPercent })
                  : t("res.deposit", {
                      amount: collecting.depositAmount.toLocaleString("fr-CM"),
                    })}
              </span>
            </p>

            {collecting.depositPercent > 0 ? (
              <Field
                label={t("res.billTotal")}
                htmlFor="collect-bill"
                hint={t("res.billTotalHint")}
              >
                <Input
                  id="collect-bill"
                  value={billDraft}
                  onChange={(e) => setBillDraft(e.target.value)}
                  placeholder={t("res.billTotalPh")}
                  inputMode="numeric"
                />
              </Field>
            ) : (
              <p className="rounded-md bg-warning-light p-3 text-sm text-warning">
                {t("res.cashConfirmBody")}
              </p>
            )}
          </div>
        )}
      </Sheet>
      {/* ── Booking taken by phone / at the counter (0068) ────────────── */}
      <Sheet
        open={phoneOpen}
        onClose={() => setPhoneOpen(false)}
        title={t("ons.m.phoneBookingNew")}
        footer={
          <SheetActions>
            <Button variant="outline" onClick={() => setPhoneOpen(false)}><span>{t("common.cancel")}</span></Button>
            <Button
              loading={pending}
              disabled={phoneDraft.guestName.trim().length < 2 || !phoneDraft.date || !/^\d{2}:\d{2}$/.test(phoneDraft.time)}
              onClick={() => {
                const draft = phoneDraft;
                startTransition(async () => {
                  const result = await createPhoneReservation({ ...draft, occasion: draft.occasion || null });
                  if (!result.ok) return toast(result.error ?? t("common.error"), "error");
                  toast(t("ons.m.phoneBookingDone", { code: result.voucherCode ?? "" }), "success");
                  setPhoneOpen(false);
                  router.refresh();
                });
              }}
            >
              <span>{t("common.save")}</span>
            </Button>
          </SheetActions>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-secondary">{t("ons.m.phoneBookingBody")}</p>
          <Field label={t("ons.m.guestName")} htmlFor="phone-name" required>
            <Input id="phone-name" value={phoneDraft.guestName} maxLength={80} onChange={(e) => setPhoneDraft((d) => ({ ...d, guestName: e.target.value }))} />
          </Field>
          <Field label={t("ons.m.guestPhone")} htmlFor="phone-phone" hint={t("ons.m.guestPhoneHint")}>
            <Input id="phone-phone" inputMode="tel" value={phoneDraft.guestPhone} maxLength={20} onChange={(e) => setPhoneDraft((d) => ({ ...d, guestPhone: e.target.value }))} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label={t("ons.m.party")} htmlFor="phone-party">
              <Input id="phone-party" type="number" min={1} max={200} value={phoneDraft.partySize} onChange={(e) => setPhoneDraft((d) => ({ ...d, partySize: Math.max(1, Number(e.target.value) || 1) }))} />
            </Field>
            <Field label={t("ons.m.date")} htmlFor="phone-date">
              <Input id="phone-date" type="date" value={phoneDraft.date} onChange={(e) => setPhoneDraft((d) => ({ ...d, date: e.target.value }))} />
            </Field>
            <Field label={t("ons.m.time")} htmlFor="phone-time">
              <Input id="phone-time" type="time" step={1800} value={phoneDraft.time} onChange={(e) => setPhoneDraft((d) => ({ ...d, time: e.target.value }))} />
            </Field>
          </div>
          <Field label={t("ons.c.occasionLabel")} htmlFor="phone-occasion">
            <Select id="phone-occasion" value={phoneDraft.occasion} onChange={(e) => setPhoneDraft((d) => ({ ...d, occasion: e.target.value as Occasion | "" }))}>
              <option value="">{t("ons.c.occasionNone")}</option>
              {OCCASIONS.map((o) => <option key={o} value={o}>{t(`ons.c.occasion.${o}` as TranslationKey)}</option>)}
            </Select>
          </Field>
          <Field label={t("res.reason")} htmlFor="phone-notes">
            <Textarea id="phone-notes" rows={2} value={phoneDraft.notes} maxLength={500} onChange={(e) => setPhoneDraft((d) => ({ ...d, notes: e.target.value }))} placeholder={t("ons.m.notesPh")} />
          </Field>
        </div>
      </Sheet>

      {/* ── Private note about a regular guest ───────────────────────── */}
      <Sheet
        open={noteFor !== null}
        onClose={() => setNoteFor(null)}
        title={t("ons.m.noteTitle", { name: noteFor?.guestName ?? "" })}
        footer={
          noteFor && (
            <SheetActions>
              <Button variant="outline" onClick={() => setNoteFor(null)}><span>{t("common.cancel")}</span></Button>
              <Button loading={pending} onClick={() => {
                const target = noteFor;
                setNoteFor(null);
                if (target.customerId) run(() => saveGuestNote(target.customerId!, noteDraft), t("ons.m.noteSaved"));
              }}><span>{t("common.save")}</span></Button>
            </SheetActions>
          )
        }
      >
        <p className="mb-3 text-sm text-text-secondary">{t("ons.m.noteBody")}</p>
        <Textarea rows={4} maxLength={1000} value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder={t("ons.m.notePh")} aria-label={t("ons.m.note")} />
      </Sheet>

      {/* ── Decline a change request ─────────────────────────────────── */}
      <Sheet
        open={declineChange !== null}
        onClose={() => setDeclineChange(null)}
        title={t("ons.m.declineChange")}
        footer={
          declineChange && (
            <SheetActions>
              <Button variant="outline" onClick={() => setDeclineChange(null)}><span>{t("common.cancel")}</span></Button>
              <Button variant="danger" loading={pending} onClick={() => {
                const target = declineChange;
                setDeclineChange(null);
                run(() => decideReservationChange(target.id, false, changeReason), t("ons.m.changeDeclined"));
              }}><span>{t("ons.m.declineChange")}</span></Button>
            </SheetActions>
          )
        }
      >
        <Field label={t("res.reason")} htmlFor="change-reason" hint={t("ons.m.changeDeclineHint")}>
          <Textarea id="change-reason" rows={3} value={changeReason} maxLength={300} onChange={(e) => setChangeReason(e.target.value)} />
        </Field>
      </Sheet>
    </>
  );
}
