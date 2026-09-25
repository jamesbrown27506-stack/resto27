"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpFromLine, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, Panel } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { PaymentPendingView } from "@/components/payment/payment-pending";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/format/datetime";
import { computeWithdrawalFee } from "@/lib/payments/withdrawal-fee";
import {
  checkOwnWithdrawalPayout,
  processOwnWithdrawal,
  requestWithdrawal,
} from "@/lib/data/wallet-actions";
import type { WalletState } from "@/lib/data/wallet";
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

export function WalletClient({
  state,
  fee,
}: {
  state: WalletState;
  fee: { enabled: boolean; percent: number };
}) {
  const { t, locale } = useLocale();
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const initialPayout = state.requests.find(
    (request) => request.status === "paid" && Boolean(request.replyTo) && !request.decidedAt,
  );

  const [amount, setAmount] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [payoutRequestId, setPayoutRequestId] = useState<string | null>(initialPayout?.id ?? null);
  const [payoutOpen, setPayoutOpen] = useState(Boolean(initialPayout));
  const [payoutAmount, setPayoutAmount] = useState(initialPayout?.amount ?? 0);
  const [payoutPhone, setPayoutPhone] = useState(initialPayout?.phone ?? "");

  // Paid orders not yet delivered and online deposits on upcoming bookings
  // stay in the wallet until they can no longer be refunded (wallet.ts).
  const withdrawable = Math.max(0, state.balance - (state.heldForOrders ?? 0));
  const gross = Number(amount);
  const feeEnabled = fee.enabled && fee.percent > 0;
  const { fee: feeAmount, net } = computeWithdrawalFee(gross, feeEnabled ? fee.percent : 0);
  const valid = Number.isInteger(gross) && gross >= 500 && gross <= withdrawable && net >= 500;

  function finishStart(
    result: Awaited<ReturnType<typeof requestWithdrawal>>,
    requestAmount: number,
    requestPhone: string,
    clearForm: boolean,
  ) {
    if (!result.ok) {
      toast(localizeActionError(result.error, locale, t("common.error")), "error");
      return;
    }
    if (clearForm) {
      setAmount("");
      setPhone("");
      setNote("");
    }
    if (result.status === "pending" && result.requestId) {
      setPayoutRequestId(result.requestId);
      setPayoutAmount(requestAmount);
      setPayoutPhone(requestPhone);
      setPayoutOpen(true);
      toast(t("mops.wal.sent"), "success");
    } else {
      toast(result.note ?? t("mops.wal.done"), "success");
    }
    router.refresh();
  }

  function confirmWithdrawal() {
    setConfirmOpen(false);
    const requestAmount = gross;
    const requestPhone = phone.trim();
    startTransition(async () => {
      const result = await requestWithdrawal({ amount: requestAmount, phone: requestPhone, note });
      finishStart(result, requestAmount, requestPhone, true);
    });
  }

  function retryWithdrawal(requestId: string, requestAmount: number, requestPhone: string) {
    startTransition(async () => {
      const result = await processOwnWithdrawal(requestId);
      finishStart(result, requestAmount, requestPhone, false);
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
        <Card>
          <CardBody>
            <p className="text-[11px] font-bold tracking-[0.08em] text-text-light uppercase">{t("mops.wal.gross")}</p>
            <p className="tnum mt-1 text-xl font-bold">{money(state.grossIncome)}</p>
            <p className="mt-1 text-xs text-text-light">{t("mops.wal.grossHint")}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-[11px] font-bold tracking-[0.08em] text-text-light uppercase">{t("mops.wal.fees")}</p>
            <p className="tnum mt-1 text-xl font-bold text-text-secondary">− {money(state.paymentFees)}</p>
            <p className="mt-1 text-xs text-text-light">{t("mops.wal.feesHint")}</p>
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

      <Panel title={t("mops.wal.withdrawTitle")} description={t("mops.wal.withdrawBody")}>
        <CardBody className="flex flex-col gap-4">
          {feeEnabled && (
            <p className="rounded-md border border-warning/30 bg-warning-light p-3 text-xs text-warning">
              {t("mops.wal.feeNote", { percent: fee.percent })}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t("mops.wal.amount")}
              htmlFor="wl-amount"
              required
              hint={t("mops.wal.availableAmount", { amount: money(withdrawable) })}
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

            <Field label={t("mops.wal.phone")} htmlFor="wl-phone" required hint={t("mops.wal.phoneHint")}>
              <Input
                id="wl-phone"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="6XXXXXXXX"
                inputMode="numeric"
              />
            </Field>
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

          <Button
            className="self-start"
            disabled={pending || !valid || phone.trim().length < 9}
            loading={pending}
            onClick={() => setConfirmOpen(true)}
          >
            <ArrowUpFromLine className="size-4" aria-hidden />
            <span>{t("mops.wal.withdrawNow")}</span>
          </Button>
        </CardBody>
      </Panel>

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
                      <span className="ml-2 font-normal text-text-light">→ {request.phone}</span>
                    </p>
                    <p className="tnum mt-0.5 text-xs text-text-light">
                      {formatDateTime(request.requestedAt)}
                    </p>
                  </div>
                  {request.fee !== null && (
                    <span className="tnum text-xs text-text-light">
                      {t("mops.wal.requestFee", { amount: money(request.fee) })}
                    </span>
                  )}
                  <Badge tone={displayStatus?.tone ?? "neutral"}>
                    {displayStatus ? t(displayStatus.label) : request.status}
                  </Badge>
                  {request.status === "pending" && (
                    <Button
                      size="sm"
                      loading={pending}
                      disabled={pending}
                      onClick={() => retryWithdrawal(request.id, request.amount, request.phone)}
                    >
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

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t("mops.wal.confirmTitle")}
        size="sm"
        footer={
          <>
            <Button variant="outline" disabled={pending} onClick={() => setConfirmOpen(false)}>
              {t("mops.wal.cancel")}
            </Button>
            <Button loading={pending} disabled={!valid} onClick={confirmWithdrawal}>
              {t("mops.wal.confirmSend")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4 text-sm">
          <p className="leading-relaxed text-text-secondary">{t("mops.wal.confirmBody")}</p>
          <dl className="divide-y divide-border rounded-md border border-border bg-surface-2 px-4">
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-text-secondary">{t("mops.wal.balance")}</dt>
              <dd className="tnum font-semibold">{money(state.balance)}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-text-secondary">{t("mops.wal.withdrawn")}</dt>
              <dd className="tnum font-semibold">{money(gross)}</dd>
            </div>
            {feeEnabled && (
              <div className="flex items-center justify-between gap-4 py-3">
                <dt className="text-text-secondary">{t("mops.wal.youReceive")}</dt>
                <dd className="tnum font-semibold text-success">{money(net)}</dd>
              </div>
            )}
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-text-secondary">{t("mops.wal.number")}</dt>
              <dd className="tnum font-semibold">{phone.trim()}</dd>
            </div>
          </dl>
          <p className={cn("text-xs font-medium", withdrawable >= gross ? "text-success" : "text-error")}>
            {withdrawable >= gross ? t("mops.wal.covered") : t("mops.wal.notCovered")}
          </p>
        </div>
      </Dialog>

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
