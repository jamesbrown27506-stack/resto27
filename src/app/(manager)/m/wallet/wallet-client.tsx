"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpFromLine, KeyRound, Phone, Plus, ShieldCheck, UserCheck, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, Panel } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { FormError } from "@/components/ui/form-error";
import { PinField } from "@/components/ui/pin-field";
import { PaymentPendingView } from "@/components/payment/payment-pending";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/format/datetime";
import { computeWithdrawalFee } from "@/lib/payments/withdrawal-fee";
import {
  checkOwnWithdrawalPayout,
  processOwnWithdrawal,
  requestWithdrawal,
  verifyWithdrawalRecipient,
} from "@/lib/data/wallet-actions";
import {
  addPayoutAccount,
  grantWithdrawalRight,
  removePayoutAccount,
  revokeWithdrawalRight,
  saveScheduledPayout,
  setWithdrawalPin,
  stopScheduledPayout,
} from "@/lib/data/withdraw-control-actions";
import type { WalletState } from "@/lib/data/wallet";
import type { WithdrawDelegate } from "@/lib/wallet/withdraw-rules";
import { DEFAULT_PAYOUT_HOUR, nextScheduledRun } from "@/lib/wallet/schedule-rules";
import { cn } from "@/lib/utils";
import { useLocale } from "@/lib/i18n/use-locale";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { localizeActionError } from "@/lib/i18n/staff-errors";

// Keys, not words: the money tiles used to be English on a French owner's
// screen while the rest of the page was French. Every label now goes through
// the dictionary like the rest of the back office.
const KIND_LABEL: Record<string, TranslationKey> = {
  payment: "mops.wal.kind.payment",
  deposit: "mops.wal.kind.deposit",
  withdrawal: "mops.wal.kind.withdrawal",
  adjustment: "mops.wal.kind.adjustment",
};

const REQUEST_STATUS: Record<string, { label: TranslationKey; tone: "success" | "warning" | "neutral" }> = {
  pending: { label: "mops.wal.status.pending", tone: "warning" },
  paid: { label: "mops.wal.status.paid", tone: "success" },
  rejected: { label: "mops.wal.status.rejected", tone: "neutral" },
};

/** Whole XAF, grouped the Cameroonian way, in every language. */
const money = (amount: number) => `${amount.toLocaleString("fr-CM")} FCFA`;

/** The viewer's standing and the owner's controls (0073), from the page. */
export interface WalletControls {
  /** False until 0073 is run: withdrawals are paused, never unchecked. */
  ready: boolean;
  sandbox: boolean;
  right:
    | { kind: "owner" }
    | { kind: "delegate"; dailyLimit: number | null; left: number | null }
    | { kind: "none"; reason: "impersonating" | "notGranted" | "role" };
  pin: { hasPin: boolean; lockedUntil: string | null };
  /** Owner of the main restaurant: manages the saved numbers. */
  ownsAccount: boolean;
  /** Owner at this branch: decides which managers may withdraw here. */
  isOwnerHere: boolean;
  accounts: { id: string; display: string; holderName: string | null; label: string | null }[];
  delegates: WithdrawDelegate[];
  /** Scheduled payouts (0074) — for the owner; null when unavailable. */
  schedule: {
    entitled: boolean;
    current: {
      enabled: boolean;
      frequency: "daily" | "weekly" | "monthly";
      weekday: number | null;
      /** 0–23 Douala; null before 0075. */
      hour: number | null;
      payoutAccountId: string;
      keepAmount: number;
      minAmount: number;
      lastRunAt: string | null;
      lastResult: string | null;
    } | null;
  } | null;
}

/** A PIN field: six boxes over a number-pad input — digits never shown (ui/pin-field). */
function PinInput({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  return <PinField id={id} value={value} onChange={onChange} />;
}

/** Which form a refusal belongs to — shown in THAT form, never behind its backdrop. */
type FormScope = "confirm" | "pin" | "number" | "grant" | "remove" | "revoke" | "schedule";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

export function WalletClient({
  state,
  fee,
  controls,
  now: nowIso,
}: {
  state: WalletState;
  fee: { enabled: boolean; percent: number };
  controls: WalletControls;
  /** Server-stamped instant — never read the clock during a render. */
  now: string;
}) {
  const now = new Date(nowIso);
  const { t, locale } = useLocale();
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const initialPayout = state.requests.find(
    (request) => request.status === "paid" && Boolean(request.replyTo) && !request.decidedAt,
  );

  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState(controls.accounts[0]?.id ?? "");
  /**
   * The withdrawal waiting to be confirmed — a new one (`requestId` null) or a
   * queued one being sent. It carries what the person is about to approve, so
   * what is confirmed is what was shown even if the form is edited underneath.
   */
  const [confirmTarget, setConfirmTarget] = useState<{
    requestId: string | null;
    amount: number;
    accountId: string | null;
    display: string;
    /** The name on the Mobile Money account; null in test mode, where it is not looked up. */
    recipientName: string | null;
  } | null>(null);
  const [confirmPin, setConfirmPin] = useState("");
  const [payoutRequestId, setPayoutRequestId] = useState<string | null>(initialPayout?.id ?? null);
  const [payoutOpen, setPayoutOpen] = useState(Boolean(initialPayout));
  const [payoutAmount, setPayoutAmount] = useState(initialPayout?.amount ?? 0);
  const [payoutPhone, setPayoutPhone] = useState(initialPayout?.phone ?? "");

  // The PIN form.
  const [pinOpen, setPinOpen] = useState(false);
  const [pinForm, setPinForm] = useState({ password: "", pin: "", again: "" });

  // Adding a number: phone → holder looked up → owner's PIN → saved.
  const [numberOpen, setNumberOpen] = useState(false);
  const [numberForm, setNumberForm] = useState({ phone: "", label: "", pin: "" });
  const [checkedHolder, setCheckedHolder] = useState<{ phone: string; name: string | null } | null>(null);
  const [removingNumber, setRemovingNumber] = useState<string | null>(null);

  // Granting the right.
  const [granting, setGranting] = useState<WithdrawDelegate | null>(null);
  const [grantForm, setGrantForm] = useState({ limit: "", pin: "" });
  const [revoking, setRevoking] = useState<WithdrawDelegate | null>(null);

  // Scheduled payouts.
  const currentSchedule = controls.schedule?.current ?? null;
  const [scheduleForm, setScheduleForm] = useState({
    frequency: currentSchedule?.frequency ?? ("weekly" as "daily" | "weekly" | "monthly"),
    weekday: currentSchedule?.weekday ?? 1,
    hour: currentSchedule?.hour ?? 20,
    accountId: currentSchedule?.payoutAccountId ?? "",
    keep: String(currentSchedule?.keepAmount ?? 0),
    min: String(currentSchedule?.minAmount ?? 5000),
    pin: "",
  });

  // The refusal of the form in front of the person — shown inside it.
  const [formError, setFormError] = useState<{ scope: FormScope; message: string } | null>(null);
  const errorIn = (scope: FormScope) => (formError?.scope === scope ? formError.message : null);
  const refuse = (scope: FormScope, error: string) =>
    setFormError({ scope, message: localizeActionError(error, locale, t("common.error")) });

  // Paid orders not yet delivered and online deposits on upcoming bookings
  // stay in the wallet until they can no longer be refunded (wallet.ts).
  const withdrawable = Math.max(0, state.balance - (state.heldForOrders ?? 0));
  const gross = Number(amount);
  const feeEnabled = fee.enabled && fee.percent > 0;
  const { fee: feeAmount, net } = computeWithdrawalFee(gross, feeEnabled ? fee.percent : 0);
  const ceiling = controls.right.kind === "delegate" ? controls.right.left : null;
  const valid =
    Number.isInteger(gross) &&
    gross >= 500 &&
    gross <= withdrawable &&
    net >= 500 &&
    (ceiling === null || gross <= ceiling);

  const mayWithdraw = controls.ready && controls.right.kind !== "none";
  const pinReady = controls.pin.hasPin && !controls.pin.lockedUntil;

  /*
    A REAL SAVED NUMBER, ALWAYS. The choice was captured once, when the page
    loaded — so a number added after that (the usual first visit: add a
    number, then schedule) left the form holding "no number" while the list
    showed one, and the button stayed dead with no reason given. Whatever is
    stored, the form now falls back to the first saved number.
  */
  const firstAccountId = controls.accounts[0]?.id ?? "";
  const withdrawAccountId = controls.accounts.some((entry) => entry.id === accountId) ? accountId : firstAccountId;
  const account = controls.accounts.find((entry) => entry.id === withdrawAccountId) ?? null;
  const scheduleAccountId = controls.accounts.some((entry) => entry.id === scheduleForm.accountId)
    ? scheduleForm.accountId
    : firstAccountId;

  // When the schedule as typed would send next — before the owner saves it.
  const scheduleNext = nextScheduledRun(
    {
      frequency: scheduleForm.frequency,
      weekday: scheduleForm.frequency === "weekly" ? scheduleForm.weekday : null,
      hour: scheduleForm.hour,
      // A changed schedule is judged as if new; an unchanged one keeps its history.
      lastRunAt: currentSchedule?.lastRunAt ?? null,
    },
    now,
  );

  const fail = (error: string) => toast(localizeActionError(error, locale, t("common.error")), "error");

  function finishStart(result: Awaited<ReturnType<typeof requestWithdrawal>>, requestAmount: number, display: string, clearForm: boolean) {
    if (!result.ok) return fail(result.error);
    if (clearForm) setAmount("");
    if (result.status === "pending" && result.requestId) {
      setPayoutRequestId(result.requestId);
      setPayoutAmount(requestAmount);
      setPayoutPhone(display);
      setPayoutOpen(true);
      toast(t("mops.wal.sent"), "success");
    } else {
      toast(result.note ?? t("mops.wal.done"), "success");
    }
    router.refresh();
  }

  /** A new withdrawal: to one of the owner's numbers, holder already confirmed when it was saved. */
  function reviewNew() {
    if (!account) return;
    setFormError(null);
    setConfirmPin("");
    setConfirmTarget({
      requestId: null,
      amount: gross,
      accountId: account.id,
      display: account.display,
      recipientName: account.holderName,
    });
  }

  /**
   * Sending a queued request again. Requests made since 0073 carry the holder
   * the owner confirmed; an older one never stored it, so in live mode the
   * operator is asked again and the sender confirms the name they are shown.
   */
  function reviewQueued(request: WalletState["requests"][number]) {
    setFormError(null);
    setConfirmPin("");
    if (request.recipientName || controls.sandbox) {
      setConfirmTarget({
        requestId: request.id,
        amount: request.amount,
        accountId: null,
        display: request.phone,
        recipientName: request.recipientName,
      });
      return;
    }
    startTransition(async () => {
      const check = await verifyWithdrawalRecipient(request.phone);
      if (!check.ok) return fail(check.error);
      setConfirmTarget({
        requestId: request.id,
        amount: request.amount,
        accountId: null,
        display: request.phone,
        recipientName: check.name ?? null,
      });
    });
  }

  function confirmWithdrawal() {
    const target = confirmTarget;
    if (!target) return;
    const pin = confirmPin;
    if (pin.length < 4) return refuse("confirm", t("mwd.pin.required"));
    setFormError(null);
    startTransition(async () => {
      const result = target.requestId
        ? await processOwnWithdrawal(target.requestId, pin, target.recipientName)
        : await requestWithdrawal({ amount: target.amount, payoutAccountId: target.accountId ?? "", pin });
      // Refused: the dialog stays open with the reason in it, for another try.
      if (!result.ok) {
        setConfirmPin("");
        return refuse("confirm", result.error);
      }
      setConfirmTarget(null);
      finishStart(result, target.amount, target.display, target.requestId === null);
    });
  }

  function openPinForm() {
    setFormError(null);
    setPinForm({ password: "", pin: "", again: "" });
    setPinOpen(true);
  }

  function savePin() {
    if (!pinForm.password) return refuse("pin", t("mwd.err.password"));
    if (pinForm.pin.length < 4) return refuse("pin", t("mwd.pin.required"));
    if (pinForm.pin !== pinForm.again) return refuse("pin", t("mwd.pin.mismatch"));
    setFormError(null);
    startTransition(async () => {
      const result = await setWithdrawalPin({ password: pinForm.password, pin: pinForm.pin });
      if (!result.ok) return refuse("pin", result.error);
      setPinOpen(false);
      setPinForm({ password: "", pin: "", again: "" });
      toast(result.note ?? t("mwd.note.pinSaved"), "success");
      router.refresh();
    });
  }

  function openNumberForm() {
    setFormError(null);
    setCheckedHolder(null);
    setNumberForm({ phone: "", label: "", pin: "" });
    setNumberOpen(true);
  }

  function checkNumber() {
    const phone = numberForm.phone.trim();
    if (phone.replace(/\D/g, "").length < 9) return refuse("number", t("mwd.num.phoneRequired"));
    setFormError(null);
    startTransition(async () => {
      const check = await verifyWithdrawalRecipient(phone);
      if (!check.ok) return refuse("number", check.error);
      setCheckedHolder({ phone, name: check.name ?? null });
    });
  }

  function saveNumber() {
    if (!checkedHolder) return;
    if (numberForm.pin.length < 4) return refuse("number", t("mwd.pin.required"));
    setFormError(null);
    startTransition(async () => {
      const result = await addPayoutAccount({
        phone: checkedHolder.phone,
        confirmedName: checkedHolder.name,
        label: numberForm.label,
        pin: numberForm.pin,
      });
      if (!result.ok) {
        setNumberForm((prev) => ({ ...prev, pin: "" }));
        return refuse("number", result.error);
      }
      setNumberOpen(false);
      setNumberForm({ phone: "", label: "", pin: "" });
      setCheckedHolder(null);
      toast(result.note ?? t("mwd.note.numberAdded"), "success");
      router.refresh();
    });
  }

  function askRemoveNumber(id: string) {
    setFormError(null);
    setRemovingNumber(id);
  }

  function confirmRemoveNumber() {
    const id = removingNumber;
    if (!id) return;
    startTransition(async () => {
      const result = await removePayoutAccount(id);
      if (!result.ok) return refuse("remove", result.error);
      setRemovingNumber(null);
      toast(result.note ?? t("mwd.note.numberRemoved"), "success");
      router.refresh();
    });
  }

  function openGrant(delegate: WithdrawDelegate) {
    setFormError(null);
    setGrantForm({ limit: delegate.dailyLimit ? String(delegate.dailyLimit) : "", pin: "" });
    setGranting(delegate);
  }

  function saveGrant() {
    const target = granting;
    if (!target) return;
    if (grantForm.pin.length < 4) return refuse("grant", t("mwd.pin.required"));
    setFormError(null);
    const limit = grantForm.limit.trim() === "" ? null : Number(grantForm.limit);
    startTransition(async () => {
      const result = await grantWithdrawalRight({ profileId: target.profileId, dailyLimit: limit, pin: grantForm.pin });
      if (!result.ok) {
        setGrantForm((prev) => ({ ...prev, pin: "" }));
        return refuse("grant", result.error);
      }
      setGranting(null);
      setGrantForm({ limit: "", pin: "" });
      toast(result.note ?? t("mwd.note.granted", { name: target.name }), "success");
      router.refresh();
    });
  }

  function saveSchedule() {
    // Said in the form, not by a dead button: what is missing, and where.
    if (!scheduleAccountId) return refuse("schedule", t("mwd.sch.err.noAccount"));
    if (scheduleForm.pin.length < 4) return refuse("schedule", t("mwd.pin.required"));
    setFormError(null);
    startTransition(async () => {
      const result = await saveScheduledPayout({
        frequency: scheduleForm.frequency,
        weekday: scheduleForm.frequency === "weekly" ? scheduleForm.weekday : null,
        hour: scheduleForm.hour,
        payoutAccountId: scheduleAccountId,
        keepAmount: Number(scheduleForm.keep) || 0,
        minAmount: Number(scheduleForm.min) || 0,
        pin: scheduleForm.pin,
      });
      setScheduleForm((prev) => ({ ...prev, pin: "" }));
      if (!result.ok) return refuse("schedule", result.error);
      toast(result.note ?? t("mwd.sch.note.saved"), "success");
      router.refresh();
    });
  }

  function stopSchedule() {
    startTransition(async () => {
      const result = await stopScheduledPayout();
      if (!result.ok) return refuse("schedule", result.error);
      toast(result.note ?? t("mwd.sch.note.stopped"), "success");
      router.refresh();
    });
  }

  function askRevoke(delegate: WithdrawDelegate) {
    setFormError(null);
    setRevoking(delegate);
  }

  function confirmRevoke() {
    const target = revoking;
    if (!target) return;
    startTransition(async () => {
      const result = await revokeWithdrawalRight(target.profileId);
      if (!result.ok) return refuse("revoke", result.error);
      setRevoking(null);
      toast(result.note ?? t("mwd.note.revoked"), "success");
      router.refresh();
    });
  }

  useEffect(() => {
    if (!payoutRequestId) return;
    let checking = false;
    const timer = setInterval(async () => {
      if (checking) return;
      checking = true;
      try {
        const result = await checkOwnWithdrawalPayout(payoutRequestId);
        if (result.status === "succeeded") {
          clearInterval(timer);
          setPayoutRequestId(null);
          setPayoutOpen(false);
          toast(t("mops.wal.confirmed"), "success");
          router.refresh();
        } else if (!result.ok || result.status === "failed") {
          clearInterval(timer);
          setPayoutRequestId(null);
          setPayoutOpen(false);
          toast(
            result.ok ? t("mops.wal.failed") : localizeActionError(result.error, locale, t("mops.wal.failed")),
            "error",
          );
          router.refresh();
        }
      } finally {
        checking = false;
      }
    }, 4_000);
    return () => clearInterval(timer);
  }, [payoutRequestId, router, toast, t, locale]);

  const standing = (() => {
    const right = controls.right;
    if (right.kind === "owner") return t("mwd.right.owner");
    if (right.kind === "delegate") {
      return right.dailyLimit === null
        ? t("mwd.right.delegate")
        : t("mwd.right.delegateLimit", { limit: money(right.dailyLimit), left: money(right.left ?? 0) });
    }
    return right.reason === "impersonating" ? t("mwd.right.impersonating") : t("mwd.right.none");
  })();

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="border-primary/30 sm:col-span-2">
          <CardBody className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-bold tracking-[0.08em] text-text-light uppercase">{t("mops.wal.available")}</p>
              <p className="tnum mt-1 font-display text-3xl font-bold">{money(withdrawable)}</p>
              <p className="mt-1 text-xs text-text-light">{t("mops.wal.availableHint")}</p>
              {(state.heldForOrders ?? 0) > 0 && (
                <p className="tnum mt-1 text-xs font-medium text-warning">
                  {t("mops.wal.held", { amount: money(state.heldForOrders) })}
                </p>
              )}
            </div>
            <Wallet className="size-10 text-primary" aria-hidden />
          </CardBody>
        </Card>
        {/*
          WHERE THE BALANCE CAME FROM — every franc in the ledger, sorted, so
          the tiles add up to the balance above (lib/wallet/breakdown.ts). The
          platform's payment fee is not here: it never reaches this wallet.
        */}
        <Card className="sm:col-span-2">
          <CardBody className="flex flex-col gap-3">
            <p className="text-[11px] font-bold tracking-[0.08em] text-text-light uppercase">{t("mops.wal.sources")}</p>
            <dl className="divide-y divide-border">
              {(
                [
                  ["orders", "mops.wal.src.orders", "mops.wal.src.ordersHint"],
                  ["tables", "mops.wal.src.tables", "mops.wal.src.tablesHint"],
                  ["reservations", "mops.wal.src.reservations", "mops.wal.src.reservationsHint"],
                  ["orderRefunds", "mops.wal.src.orderRefunds", "mops.wal.src.orderRefundsHint"],
                  ["reservationRefunds", "mops.wal.src.reservationRefunds", "mops.wal.src.reservationRefundsHint"],
                  ["withdrawals", "mops.wal.src.withdrawals", "mops.wal.src.withdrawalsHint"],
                  ["credits", "mops.wal.src.credits", "mops.wal.src.creditsHint"],
                ] as const
              )
                // Income lines always show; the rest only when they happened.
                .filter(([bucket]) => bucket === "orders" || bucket === "reservations" || state.breakdown[bucket] !== 0)
                .map(([bucket, label, hint]) => {
                  const amount = state.breakdown[bucket];
                  return (
                    <div key={bucket} className="flex items-start justify-between gap-4 py-2.5">
                      <div className="min-w-0">
                        <dt className="text-sm font-semibold">{t(label)}</dt>
                        <dd className="text-xs text-text-light">{t(hint)}</dd>
                      </div>
                      <span
                        className={cn(
                          "tnum shrink-0 text-sm font-bold",
                          amount > 0 ? "text-success" : amount < 0 ? "text-error" : "text-text-secondary",
                        )}
                      >
                        {amount > 0 ? "+ " : amount < 0 ? "− " : ""}
                        {money(Math.abs(amount))}
                      </span>
                    </div>
                  );
                })}
              <div className="flex items-center justify-between gap-4 pt-3">
                <dt className="text-sm font-bold">{t("mops.wal.src.total")}</dt>
                <span className="tnum text-base font-bold">{money(state.breakdown.total)}</span>
              </div>
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-[11px] font-bold tracking-[0.08em] text-text-light uppercase">{t("mops.wal.commission")}</p>
            <p className="tnum mt-1 text-xl font-bold text-warning">− {money(state.commissionDue)}</p>
            <p className="mt-1 text-xs text-text-light">{t("mops.wal.commissionHint")}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-[11px] font-bold tracking-[0.08em] text-text-light uppercase">{t("mops.wal.net")}</p>
            <p className="tnum mt-1 text-xl font-bold text-success">{money(state.estimatedNetIncome)}</p>
            <p className="mt-1 text-xs text-text-light">{t("mops.wal.netHint")}</p>
          </CardBody>
        </Card>
      </div>

      {!controls.ready && (
        <p className="rounded-md border border-warning/30 bg-warning-light p-3 text-sm text-warning">{t("mwd.controlsMissing")}</p>
      )}

      {/* ── Withdraw ──────────────────────────────────────────────────────── */}
      <Panel title={t("mops.wal.withdrawTitle")} description={t("mops.wal.withdrawBody")}>
        <CardBody className="flex flex-col gap-4">
          <p
            className={cn(
              "flex items-start gap-2 rounded-md border p-3 text-sm",
              mayWithdraw ? "border-primary/20 bg-primary-light text-primary" : "border-border bg-surface-2 text-text-secondary",
            )}
          >
            <UserCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{standing}</span>
          </p>

          {controls.sandbox && controls.ready && (
            <p className="rounded-md border border-info/25 bg-info-light p-3 text-xs text-info">{t("mwd.sandbox")}</p>
          )}

          {mayWithdraw && (
            <>
              {feeEnabled && (
                <p className="rounded-md border border-warning/30 bg-warning-light p-3 text-xs text-warning">
                  {t("mops.wal.feeNote", { percent: fee.percent })}
                </p>
              )}

              {!pinReady ? (
                <p className="text-sm text-text-secondary">{t("mwd.form.needPin")}</p>
              ) : controls.accounts.length === 0 ? (
                <p className="text-sm text-text-secondary">
                  {controls.ownsAccount ? t("mwd.form.noNumberOwner") : t("mwd.form.noNumberOther")}
                </p>
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label={t("mops.wal.amount")}
                      htmlFor="wl-amount"
                      required
                      hint={t("mops.wal.availableAmount", {
                        amount: money(ceiling === null ? withdrawable : Math.min(withdrawable, ceiling)),
                      })}
                    >
                      <Input
                        id="wl-amount"
                        type="number"
                        min={500}
                        step={1}
                        value={amount}
                        onChange={(event) => setAmount(event.target.value)}
                        placeholder="5000"
                      />
                    </Field>

                    {/* Only the owner's saved numbers — never a typed one (0073). */}
                    {/* min-w-0: a fieldset is otherwise as wide as its widest
                        line, and a long number + holder name pushed the whole
                        page sideways on a phone. */}
                    <fieldset className="flex min-w-0 flex-col gap-1.5">
                      <legend className="text-[11px] font-bold tracking-[0.08em] text-text-light uppercase">
                        {t("mwd.form.to")}
                      </legend>
                      {controls.accounts.map((entry) => (
                        <label
                          key={entry.id}
                          className={cn(
                            "flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm",
                            entry.id === withdrawAccountId ? "border-primary bg-primary-light" : "border-border",
                          )}
                        >
                          <input
                            type="radio"
                            name="payout-account"
                            className="mt-1"
                            checked={entry.id === withdrawAccountId}
                            onChange={() => setAccountId(entry.id)}
                          />
                          <span className="min-w-0">
                            <span className="tnum block font-semibold break-all">{entry.display}</span>
                            <span className="block truncate text-xs text-text-secondary">
                              {[entry.label, entry.holderName].filter(Boolean).join(" · ") || "—"}
                            </span>
                          </span>
                        </label>
                      ))}
                    </fieldset>
                  </div>

                  {feeEnabled && Number.isFinite(gross) && gross > 0 && (
                    <div className="rounded-md border border-border bg-surface-2 p-3 text-sm">
                      <div className="flex items-baseline justify-between gap-4">
                        <span className="text-text-secondary">{t("mops.wal.debited")}</span>
                        <span className="tnum font-semibold">{money(gross)}</span>
                      </div>
                      <div className="mt-1 flex items-baseline justify-between gap-4">
                        <span className="text-text-secondary">{t("mops.wal.feeLine", { percent: fee.percent })}</span>
                        <span className="tnum font-semibold text-text-light">− {money(feeAmount)}</span>
                      </div>
                      <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-border pt-2">
                        <span className="font-semibold">{t("mops.wal.youReceive")}</span>
                        <span className={cn("tnum font-semibold", net >= 500 ? "text-success" : "text-error")}>
                          {money(net)}
                        </span>
                      </div>
                    </div>
                  )}

                  <Button className="self-start" disabled={pending || !valid || !account} loading={pending} onClick={reviewNew}>
                    <ArrowUpFromLine className="size-4" aria-hidden />
                    <span>{t("mops.wal.withdrawNow")}</span>
                  </Button>
                </>
              )}
            </>
          )}
        </CardBody>
      </Panel>

      {/* ── Your PIN ──────────────────────────────────────────────────────── */}
      {controls.ready && controls.right.kind !== "none" && (
        <Panel
          title={t("mwd.pin.title")}
          description={controls.pin.hasPin ? t("mwd.pin.bodySet") : t("mwd.pin.bodyNew")}
          action={
            <Button size="sm" variant={controls.pin.hasPin ? "outline" : "primary"} onClick={openPinForm}>
              <KeyRound className="size-3.5" aria-hidden />
              <span>{controls.pin.hasPin ? t("mwd.pin.change") : t("mwd.pin.save")}</span>
            </Button>
          }
        >
          {controls.pin.lockedUntil && (
            <CardBody>
              <p className="text-sm font-semibold text-error">
                {t("mwd.pin.locked", { time: formatDateTime(controls.pin.lockedUntil) })}
              </p>
            </CardBody>
          )}
        </Panel>
      )}

      {/* ── Payout numbers ────────────────────────────────────────────────── */}
      {controls.ready && (controls.ownsAccount || controls.right.kind !== "none") && (
        <Panel
          title={t("mwd.num.title")}
          description={controls.ownsAccount ? t("mwd.num.bodyOwner") : t("mwd.num.bodyOther")}
          action={
            controls.ownsAccount ? (
              <Button
                size="sm"
                variant="outline"
                onClick={openNumberForm}
              >
                <Plus className="size-3.5" aria-hidden />
                <span>{t("mwd.num.add")}</span>
              </Button>
            ) : undefined
          }
        >
          {controls.accounts.length === 0 ? (
            <CardBody className="text-sm text-text-secondary">{t("mwd.num.empty")}</CardBody>
          ) : (
            <ul className="divide-y divide-border">
              {controls.accounts.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                  <Phone className="size-4 shrink-0 text-text-light" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="tnum text-sm font-semibold break-all">{entry.display}</p>
                    <p className="truncate text-xs text-text-secondary">
                      {[entry.label, entry.holderName].filter(Boolean).join(" · ") ||
                        (controls.sandbox ? "—" : t("mwd.num.unverified"))}
                    </p>
                  </div>
                  {controls.ownsAccount && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-error hover:bg-error-light"
                      disabled={pending}
                      onClick={() => askRemoveNumber(entry.id)}
                    >
                      {t("mwd.num.remove")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {/* ── Who can withdraw (owner) ──────────────────────────────────────── */}
      {controls.ready && controls.isOwnerHere && (
        <Panel title={t("mwd.del.title")} description={t("mwd.del.body")}>
          {controls.delegates.length === 0 ? (
            <CardBody className="text-sm text-text-secondary">{t("mwd.del.empty")}</CardBody>
          ) : (
            <ul className="divide-y divide-border">
              {controls.delegates.map((delegate) => (
                <li key={delegate.profileId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{delegate.name}</p>
                    <p className="text-xs text-text-secondary">{t("common.role.manager")}</p>
                  </div>
                  <Badge tone={delegate.granted ? "success" : "neutral"}>
                    {delegate.granted
                      ? delegate.dailyLimit === null
                        ? t("mwd.del.granted")
                        : t("mwd.del.grantedLimit", { limit: money(delegate.dailyLimit) })
                      : t("mwd.del.notGranted")}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => openGrant(delegate)}
                  >
                    {delegate.granted ? t("mwd.del.edit") : t("mwd.del.grant")}
                  </Button>
                  {delegate.granted && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-error hover:bg-error-light"
                      disabled={pending}
                      onClick={() => askRevoke(delegate)}
                    >
                      {t("mwd.del.revoke")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {/* ── Scheduled payouts (owner, Enterprise) ─────────────────────────── */}
      {controls.ready && controls.isOwnerHere && controls.schedule && (
        <Panel title={t("mwd.sch.title")} description={t("mwd.sch.body")}>
          <CardBody className="flex flex-col gap-4">
            {!controls.schedule.entitled ? (
              <p className="flex flex-wrap items-center gap-2 text-sm text-text-secondary">
                <span>{t("mwd.sch.upsell")}</span>
                <a href="/m/billing" className="font-semibold text-primary underline">
                  {t("mwd.sch.upsellCta")}
                </a>
              </p>
            ) : controls.accounts.length === 0 || !pinReady ? (
              <p className="text-sm text-text-secondary">
                {!pinReady ? t("mwd.form.needPin") : t("mwd.form.noNumberOwner")}
              </p>
            ) : (
              <>
                {currentSchedule?.enabled ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-success/25 bg-success-light p-3 text-sm text-success">
                    <span>
                      {t("mwd.sch.active", {
                        frequency:
                          currentSchedule.frequency === "daily"
                            ? t("mwd.sch.daily")
                            : currentSchedule.frequency === "weekly"
                              ? `${t("mwd.sch.weekly")} (${t(`mwd.sch.day.${currentSchedule.weekday ?? 1}` as TranslationKey)})`
                              : t("mwd.sch.monthly"),
                        hour: `${String(currentSchedule.hour ?? DEFAULT_PAYOUT_HOUR).padStart(2, "0")}:00`,
                        number:
                          controls.accounts.find((entry) => entry.id === currentSchedule.payoutAccountId)?.display ?? "—",
                      })}
                    </span>
                    <Button size="sm" variant="outline" disabled={pending} onClick={stopSchedule}>
                      {t("mwd.sch.stop")}
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-text-secondary">{t("mwd.sch.inactive")}</p>
                )}
                {currentSchedule?.lastRunAt && (
                  <p className="text-xs text-text-light">
                    {t("mwd.sch.last", {
                      when: formatDateTime(currentSchedule.lastRunAt),
                      result: currentSchedule.lastResult ?? "—",
                    })}
                  </p>
                )}

                {/* Every control fills its cell (w-full) and every cell may
                    shrink (min-w-0): a <select> is otherwise as wide as its
                    longest option, and "number — holder's full name" made
                    the page scroll sideways on a phone. */}
                <div className="grid gap-4 *:min-w-0 sm:grid-cols-2">
                  <Field label={t("mwd.sch.frequency")} htmlFor="wl-sch-frequency">
                    <Select
                      id="wl-sch-frequency"
                      className="w-full"
                      value={scheduleForm.frequency}
                      onChange={(event) =>
                        setScheduleForm((prev) => ({ ...prev, frequency: event.target.value as "daily" | "weekly" | "monthly" }))
                      }
                    >
                      <option value="daily">{t("mwd.sch.daily")}</option>
                      <option value="weekly">{t("mwd.sch.weekly")}</option>
                      <option value="monthly">{t("mwd.sch.monthly")}</option>
                    </Select>
                  </Field>
                  {scheduleForm.frequency === "weekly" && (
                    <Field label={t("mwd.sch.weekday")} htmlFor="wl-sch-weekday">
                      <Select
                        id="wl-sch-weekday"
                        className="w-full"
                        value={scheduleForm.weekday}
                        onChange={(event) => setScheduleForm((prev) => ({ ...prev, weekday: Number(event.target.value) }))}
                      >
                        {[1, 2, 3, 4, 5, 6, 0].map((day) => (
                          <option key={day} value={day}>
                            {t(`mwd.sch.day.${day}` as TranslationKey)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}
                  <Field label={t("mwd.sch.hour")} htmlFor="wl-sch-hour" hint={t("mwd.sch.hourHint")}>
                    <Select
                      id="wl-sch-hour"
                      className="w-full"
                      value={scheduleForm.hour}
                      onChange={(event) => setScheduleForm((prev) => ({ ...prev, hour: Number(event.target.value) }))}
                    >
                      {HOURS.map((hour) => (
                        <option key={hour} value={hour}>
                          {`${String(hour).padStart(2, "0")}:00`}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t("mwd.form.to")} htmlFor="wl-sch-account">
                    <Select
                      id="wl-sch-account"
                      className="w-full truncate"
                      value={scheduleAccountId}
                      onChange={(event) => setScheduleForm((prev) => ({ ...prev, accountId: event.target.value }))}
                    >
                      {controls.accounts.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.display}
                          {entry.holderName ? ` — ${entry.holderName}` : ""}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t("mwd.sch.keep")} htmlFor="wl-sch-keep" hint={t("mwd.sch.keepHint")}>
                    <Input
                      id="wl-sch-keep"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={500}
                      suffix="FCFA"
                      value={scheduleForm.keep}
                      onChange={(event) => setScheduleForm((prev) => ({ ...prev, keep: event.target.value }))}
                    />
                  </Field>
                  <Field label={t("mwd.sch.min")} htmlFor="wl-sch-min" hint={t("mwd.sch.minHint")}>
                    <Input
                      id="wl-sch-min"
                      type="number"
                      inputMode="numeric"
                      min={500}
                      step={500}
                      suffix="FCFA"
                      value={scheduleForm.min}
                      onChange={(event) => setScheduleForm((prev) => ({ ...prev, min: event.target.value }))}
                    />
                  </Field>
                  <Field label={t("mwd.pin.enter")} htmlFor="wl-sch-pin" required>
                    <PinInput
                      id="wl-sch-pin"
                      value={scheduleForm.pin}
                      onChange={(pin) => setScheduleForm((prev) => ({ ...prev, pin }))}
                    />
                  </Field>
                </div>

                {/* When the first (next) payout will go, before saving — the
                    answer to "if I set this today, when does money arrive?" */}
                <p className="rounded-md border border-info/25 bg-info-light p-3 text-sm text-info">
                  {scheduleNext.due
                    ? t("mwd.sch.nextNow")
                    : t("mwd.sch.nextAt", { when: formatDateTime(scheduleNext.at.toISOString()) })}
                </p>

                <FormError message={errorIn("schedule")} />

                {/* Never a silently dead button: a click on an incomplete form
                    says, just above, what is missing. */}
                <Button className="self-start" loading={pending} disabled={pending} onClick={saveSchedule}>
                  {t("mwd.sch.save")}
                </Button>
              </>
            )}
          </CardBody>
        </Panel>
      )}

      {/* ── History ───────────────────────────────────────────────────────── */}
      {state.requests.length > 0 && (
        <Panel title={t("mops.wal.requests")} description={t("mops.wal.requestsBody")}>
          <ul className="divide-y divide-border">
            {state.requests.map((request) => {
              const processing =
                request.status === "paid" && Boolean(request.replyTo) && !request.decidedAt;
              const displayStatus = processing
                ? { label: "mops.wal.status.processing" as TranslationKey, tone: "warning" as const }
                : REQUEST_STATUS[request.status];
              return (
                <li key={request.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="tnum text-sm font-semibold">
                      {money(request.amount)}
                      <span className="ml-2 font-normal break-all text-text-light">→ {request.phone}</span>
                    </p>
                    <p className="tnum mt-0.5 text-xs text-text-light">
                      {formatDateTime(request.requestedAt)}
                    </p>
                    {/* Who took it out, and whose account it reached (0073). */}
                    {(request.requestedByName || request.recipientName) && (
                      <p className="mt-0.5 text-xs text-text-secondary">
                        {request.requestedByName &&
                          t("mwd.hist.by", {
                            name: request.requestedByName,
                            role: request.requesterRole
                              ? t(`common.role.${request.requesterRole}` as TranslationKey)
                              : "—",
                          })}
                        {request.requestedByName && request.recipientName && " · "}
                        {request.recipientName && t("mwd.hist.to", { name: request.recipientName })}
                      </p>
                    )}
                  </div>
                  {request.fee !== null && (
                    <span className="tnum text-xs text-text-light">
                      {t("mops.wal.requestFee", { amount: money(request.fee) })}
                    </span>
                  )}
                  <Badge tone={displayStatus?.tone ?? "neutral"}>
                    {displayStatus ? t(displayStatus.label) : request.status}
                  </Badge>
                  {request.status === "pending" && mayWithdraw && pinReady && (
                    <Button size="sm" loading={pending} disabled={pending} onClick={() => reviewQueued(request)}>
                      {t("mops.wal.sendNow")}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      {state.ledger.length > 0 && (
        <Panel title={t("mops.wal.ledger")} description={t("mops.wal.ledgerBody")}>
          <ul className="divide-y divide-border">
            {state.ledger.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-x-6 gap-y-1 px-5 py-3">
                <span
                  className={cn(
                    "tnum text-sm font-semibold",
                    entry.amount >= 0 ? "text-success" : "text-error",
                  )}
                >
                  {entry.amount >= 0 ? "+" : ""}
                  {money(entry.amount)}
                </span>
                <span className="min-w-0 flex-1 text-sm text-text-secondary">
                  {KIND_LABEL[entry.kind] ? t(KIND_LABEL[entry.kind]!) : entry.kind}
                  {entry.note && <span className="text-text-light"> · {entry.note}</span>}
                </span>
                <span className="tnum shrink-0 text-xs text-text-light">
                  {formatDateTime(entry.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/* ── Confirm a withdrawal: who receives it, then the PIN ──────────── */}
      <Dialog
        open={confirmTarget !== null}
        onClose={() => setConfirmTarget(null)}
        title={t("mops.wal.confirmTitle")}
        size="sm"
        error={errorIn("confirm")}
        footer={
          <>
            <Button variant="outline" disabled={pending} onClick={() => setConfirmTarget(null)}>
              {t("mops.wal.cancel")}
            </Button>
            <Button
              loading={pending}
              disabled={pending || confirmTarget === null}
              onClick={confirmWithdrawal}
            >
              {t("mops.wal.confirmSend")}
            </Button>
          </>
        }
      >
        {confirmTarget && (
          <div className="flex flex-col gap-4 text-sm">
            <p className="leading-relaxed text-text-secondary">{t("mops.wal.confirmBody")}</p>

            {/* WHO RECEIVES IT — first, and larger than anything else in the
                dialog: the name is what tells you the money goes where you mean. */}
            {confirmTarget.recipientName ? (
              <div className="rounded-md border border-success/35 bg-success-light p-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-success">
                  <ShieldCheck className="size-3.5" aria-hidden />
                  {t("mops.wal.recipient")}
                </p>
                <p className="mt-1 break-words text-lg font-bold leading-tight">{confirmTarget.recipientName}</p>
                <p className="mt-1 text-xs leading-relaxed text-text-secondary">{t("mops.wal.recipientHint")}</p>
              </div>
            ) : (
              <p className="rounded-md border border-warning/30 bg-warning-light p-3 text-xs text-warning">
                {t("mops.wal.recipientUnverified")}
              </p>
            )}

            <dl className="divide-y divide-border rounded-md border border-border bg-surface-2 px-4">
              <div className="flex items-center justify-between gap-4 py-3">
                <dt className="text-text-secondary">{t("mops.wal.number")}</dt>
                <dd className="tnum font-semibold">{confirmTarget.display}</dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-3">
                <dt className="text-text-secondary">{t("mops.wal.withdrawn")}</dt>
                <dd className="tnum font-semibold">{money(confirmTarget.amount)}</dd>
              </div>
              {feeEnabled && (
                <div className="flex items-center justify-between gap-4 py-3">
                  <dt className="text-text-secondary">{t("mops.wal.youReceive")}</dt>
                  <dd className="tnum font-semibold text-success">
                    {money(computeWithdrawalFee(confirmTarget.amount, fee.percent).net)}
                  </dd>
                </div>
              )}
              <div className="flex items-center justify-between gap-4 py-3">
                <dt className="text-text-secondary">{t("mops.wal.balance")}</dt>
                <dd className="tnum font-semibold">{money(state.balance)}</dd>
              </div>
            </dl>
            {/* A queued request is already counted against the balance. */}
            {confirmTarget.requestId === null && (
              <p className={cn("text-xs font-medium", withdrawable >= confirmTarget.amount ? "text-success" : "text-error")}>
                {withdrawable >= confirmTarget.amount ? t("mops.wal.covered") : t("mops.wal.notCovered")}
              </p>
            )}

            <Field label={t("mwd.pin.enter")} htmlFor="wl-confirm-pin" required>
              <PinInput id="wl-confirm-pin" value={confirmPin} onChange={setConfirmPin} />
            </Field>
          </div>
        )}
      </Dialog>

      {/* ── Set or change the PIN ────────────────────────────────────────── */}
      <Dialog
        open={pinOpen}
        onClose={() => setPinOpen(false)}
        title={t("mwd.pin.title")}
        size="sm"
        error={errorIn("pin")}
        footer={
          <>
            <Button variant="outline" disabled={pending} onClick={() => setPinOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              loading={pending}
              disabled={pending}
              onClick={savePin}
            >
              {t("mwd.pin.save")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-secondary">{t("mwd.pin.bodyNew")}</p>
          <Field label={t("mwd.pin.password")} htmlFor="wl-pin-password" required>
            <Input
              id="wl-pin-password"
              type="password"
              autoComplete="current-password"
              value={pinForm.password}
              onChange={(event) => setPinForm((prev) => ({ ...prev, password: event.target.value }))}
            />
          </Field>
          <Field label={t("mwd.pin.new")} htmlFor="wl-pin-new" required>
            <PinInput id="wl-pin-new" value={pinForm.pin} onChange={(pin) => setPinForm((prev) => ({ ...prev, pin }))} />
          </Field>
          <Field
            label={t("mwd.pin.confirm")}
            htmlFor="wl-pin-again"
            required
            error={pinForm.again.length >= 4 && pinForm.again !== pinForm.pin ? t("mwd.pin.mismatch") : undefined}
          >
            <PinInput id="wl-pin-again" value={pinForm.again} onChange={(again) => setPinForm((prev) => ({ ...prev, again }))} />
          </Field>
        </div>
      </Dialog>

      {/* ── Add a payout number ──────────────────────────────────────────── */}
      <Dialog
        open={numberOpen}
        onClose={() => setNumberOpen(false)}
        title={t("mwd.num.add")}
        size="sm"
        error={errorIn("number")}
        footer={
          <>
            <Button variant="outline" disabled={pending} onClick={() => setNumberOpen(false)}>
              {t("common.cancel")}
            </Button>
            {checkedHolder ? (
              <Button loading={pending} disabled={pending} onClick={saveNumber}>
                {t("mwd.num.save")}
              </Button>
            ) : (
              <Button loading={pending} disabled={pending} onClick={checkNumber}>
                {t("mwd.num.check")}
              </Button>
            )}
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label={t("mwd.num.phone")} htmlFor="wl-num-phone" required>
            <Input
              id="wl-num-phone"
              inputMode="numeric"
              placeholder="6XXXXXXXX"
              value={numberForm.phone}
              onChange={(event) => {
                setCheckedHolder(null);
                setNumberForm((prev) => ({ ...prev, phone: event.target.value }));
              }}
            />
          </Field>
          <Field label={t("mwd.num.label")} htmlFor="wl-num-label" hint={t("mwd.num.labelHint")}>
            <Input
              id="wl-num-label"
              maxLength={40}
              value={numberForm.label}
              onChange={(event) => setNumberForm((prev) => ({ ...prev, label: event.target.value }))}
            />
          </Field>

          {checkedHolder && (
            <>
              {checkedHolder.name ? (
                <div className="rounded-md border border-success/35 bg-success-light p-3">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-success">
                    <ShieldCheck className="size-3.5" aria-hidden />
                    {t("mwd.num.holder")}
                  </p>
                  <p className="mt-1 break-words text-lg font-bold leading-tight">{checkedHolder.name}</p>
                  <p className="mt-1 text-xs text-text-secondary">{t("mwd.num.holderHint")}</p>
                </div>
              ) : (
                <p className="rounded-md border border-warning/30 bg-warning-light p-3 text-xs text-warning">
                  {t("mops.wal.recipientUnverified")}
                </p>
              )}
              <Field label={t("mwd.pin.enter")} htmlFor="wl-num-pin" required>
                <PinInput id="wl-num-pin" value={numberForm.pin} onChange={(pin) => setNumberForm((prev) => ({ ...prev, pin }))} />
              </Field>
            </>
          )}
        </div>
      </Dialog>

      <ConfirmDialog
        open={removingNumber !== null}
        onClose={() => setRemovingNumber(null)}
        onConfirm={confirmRemoveNumber}
        title={t("mwd.num.removeTitle")}
        message={t("mwd.num.removeBody")}
        error={errorIn("remove")}
        confirmLabel={t("mwd.num.remove")}
        destructive
        loading={pending}
      />

      {/* ── Let a manager withdraw ───────────────────────────────────────── */}
      <Dialog
        open={granting !== null}
        onClose={() => setGranting(null)}
        title={t("mwd.del.grantTitle", { name: granting?.name ?? "" })}
        size="sm"
        error={errorIn("grant")}
        footer={
          <>
            <Button variant="outline" disabled={pending} onClick={() => setGranting(null)}>
              {t("common.cancel")}
            </Button>
            <Button loading={pending} disabled={pending} onClick={saveGrant}>
              {t("mwd.del.grant")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label={t("mwd.del.limit")} htmlFor="wl-grant-limit" hint={t("mwd.del.limitHint")}>
            <Input
              id="wl-grant-limit"
              type="number"
              min={500}
              step={500}
              suffix="FCFA"
              value={grantForm.limit}
              onChange={(event) => setGrantForm((prev) => ({ ...prev, limit: event.target.value }))}
            />
          </Field>
          <Field label={t("mwd.pin.enter")} htmlFor="wl-grant-pin" required>
            <PinInput id="wl-grant-pin" value={grantForm.pin} onChange={(pin) => setGrantForm((prev) => ({ ...prev, pin }))} />
          </Field>
        </div>
      </Dialog>

      <ConfirmDialog
        open={revoking !== null}
        onClose={() => setRevoking(null)}
        onConfirm={confirmRevoke}
        title={t("mwd.del.revokeTitle", { name: revoking?.name ?? "" })}
        message={t("mwd.del.revokeBody", { name: revoking?.name ?? "" })}
        error={errorIn("revoke")}
        confirmLabel={t("mwd.del.revoke")}
        destructive
        loading={pending}
      />

      <Dialog
        open={payoutOpen}
        onClose={() => setPayoutOpen(false)}
        title={t("mops.wal.pendingTitle")}
        size="sm"
        footer={
          <Button variant="outline" onClick={() => setPayoutOpen(false)}>
            {t("mops.wal.background")}
          </Button>
        }
      >
        <PaymentPendingView
          body={t("mops.wal.pendingBody")}
          hint={t("mops.wal.pendingHint")}
          amountLabel={t("mops.wal.amount")}
          amount={money(payoutAmount)}
          referenceLabel={t("mops.wal.withdrawal")}
          reference={payoutRequestId ?? ""}
          phoneLabel={t("mops.wal.number")}
          phone={payoutPhone}
          gatewayLabel={t("mops.wal.gateway")}
        />
      </Dialog>
    </div>
  );
}
