"use client";

import { useMemo, useState, useTransition } from "react";
import { Banknote, CalendarCheck, Check, Phone, Users, X } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Sheet, SheetActions } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { useDates } from "@/lib/format/use-dates";
import { useLocale } from "@/lib/i18n/use-locale";
import {
  collectReservationDeposit,
  decideReservation,
  setReservationStatus,
  setRestaurantDeposit,
} from "@/lib/data/manager-actions";
import { type DepositType } from "@/lib/reservations/deposit";
import { canManagerCollectReservationDeposit } from "@/lib/reservations/lifecycle";
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
  depositAmount,
  depositType: storedDepositType,
  canCollectDeposit,
}: {
  reservations: Reservation[];
  tables: RestaurantTable[];
  canDecide: boolean;
  /** The restaurant's current acompte (migration 0025). */
  depositAmount: number;
  /** How the acompte works (migration 0031): fixed FCFA or % of the bill. */
  depositType: DepositType;
  canCollectDeposit: boolean;
}) {
  const { t } = useLocale();
  const dates = useDates();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [confirming, setConfirming] = useState<Reservation | null>(null);
  const [tableId, setTableId] = useState("");
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
    });
  }

  function row(reservation: Reservation) {
    const seatable = tables.filter(
      (table) => table.status !== "out_of_service" && table.capacity >= reservation.partySize,
    );
    const mayCollectDeposit =
      canCollectDeposit &&
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
            {reservation.tableNumber && (
              <Badge tone="neutral">
                {t("res.table")} {reservation.tableNumber}
              </Badge>
            )}
          </div>

          <p className="tnum mt-0.5 text-sm text-text-secondary">
            {dates.dateTime(reservation.reservedFor)}
          </p>

          <p className="mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-light">
            <span className="flex items-center gap-1">
              <Users className="size-3" aria-hidden />
              {t("m.people", { count: reservation.partySize })}
            </span>
            <a
              href={`tel:${reservation.guestPhone}`}
              className="flex items-center gap-1 hover:text-primary"
            >
              <Phone className="size-3" aria-hidden />
              {reservation.guestPhone}
            </a>
            <span className="tnum">{reservation.reference}</span>
          </p>

          {reservation.notes && (
            <p className="mt-1.5 rounded-md bg-surface-2 p-2 text-sm text-text-secondary">
              {reservation.notes}
            </p>
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

        {canDecide && (
          <div className="flex shrink-0 flex-wrap gap-2">
            {reservation.status === "pending" && (
              <>
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    setConfirming(reservation);
                    setTableId(seatable[0]?.id ?? "");
                  }}
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
            {reservation.status === "awaiting_payment" && (
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

            {reservation.status === "confirmed" && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    run(() => setReservationStatus(reservation.id, "seated"), t("res.seatedDone"))
                  }
                >
                  {t("res.seat")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    run(() => setReservationStatus(reservation.id, "no_show"), t("res.noShowDone"))
                  }
                >
                  {t("res.noShow")}
                </Button>
              </>
            )}

            {reservation.status === "seated" && (
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
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1 basis-full sm:basis-auto">
              <p className="text-sm font-semibold">{t(DEPOSIT_TITLE_KEY[depositType])}</p>
              <p className="text-xs leading-relaxed text-text-light">
                {t(DEPOSIT_BODY_KEY[depositType])}
              </p>
            </div>

            <Select
              value={depositType}
              onChange={(e) => setDepositTypeDraft(e.target.value as DepositType)}
              aria-label={t("res.depositKind")}
              className="min-w-0 flex-1 sm:w-44 sm:flex-none"
            >
              <option value="fixed">{t("res.kindFixed")}</option>
              <option value="per_seat">{t("res.kindPerSeat")}</option>
              <option value="percent">{t("res.kindPercent")}</option>
            </Select>

            <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
              <Input
                type="number"
                min={0}
                step={depositType === "percent" ? 1 : 100}
                value={depositDraft}
                onChange={(e) => setDepositDraft(e.target.value)}
                className="min-w-0 flex-1 sm:w-32 sm:flex-none"
                aria-label={t(DEPOSIT_TITLE_KEY[depositType])}
              />
              <span className="shrink-0 text-sm text-text-light">
                {depositType === "percent" ? "%" : "FCFA"}
              </span>
            </div>

            <Button
              variant="outline"
              size="sm"
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
                    () => decideReservation(confirming.id, "confirmed", { tableId: tableId || null }),
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

            <Field
              label={t("res.table")}
              htmlFor="reservation-table"
              hint={t("res.tableHint")}
            >
              <Select
                id="reservation-table"
                value={tableId}
                onChange={(e) => setTableId(e.target.value)}
              >
                <option value="">{t("res.noTableYet")}</option>
                {/* Only tables that actually seat the party. Offering a
                    two-seater for six is an error waiting to be made at the
                    door, in front of the guest. */}
                {tables
                  .filter((table) => table.capacity >= confirming.partySize)
                  .map((table) => (
                    <option key={table.id} value={table.id}>
                      {t("res.table")} {table.number} — {t("m.tables.seats", { count: table.capacity })}
                    </option>
                  ))}
              </Select>
            </Field>

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
    </>
  );
}
