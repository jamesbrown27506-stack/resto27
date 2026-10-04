"use client";

import { SuperAdminOnlyHint, useIsSuperAdmin } from "@/components/layout/admin-shell";
import { useEffect, useState, useTransition } from "react";
import { AlertTriangle, ArrowUpFromLine, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, Panel } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { PaymentPendingView } from "@/components/payment/payment-pending";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/format/datetime";
import {
  checkWalletFunding,
  checkWithdrawalPayout,
  fundWallet,
  resolveUnresolvedWithdrawal,
} from "@/lib/data/wallet-actions";
import type { PaymentInstruction } from "@/lib/payments/camerpay/notification";
import type { AdminWithdrawalRequest } from "@/lib/data/wallet";

/**
 * The withdrawal inbox. Approving sends REAL money via CamerPay (fee
 * withheld) and debits the restaurant's wallet; rejecting returns it to the
 * balance untouched. The fee preview reads the same setting the action will.
 */
export function WalletInbox({
  requests,
}: {
  adminName: string;
  requests: AdminWithdrawalRequest[];
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const isSuper = useIsSuperAdmin();

  // The credit box — which restaurant, how much, and for what.
  const [creditRestaurant, setCreditRestaurant] = useState("");
  const [creditAmount, setCreditAmount] = useState("");
  const [showCredit, setShowCredit] = useState(false);
  const [creditPhone, setCreditPhone] = useState("");
  const [fundingAttemptId, setFundingAttemptId] = useState<string | null>(null);
  const [fundingOpen, setFundingOpen] = useState(false);
  const [fundingInstruction, setFundingInstruction] = useState<PaymentInstruction | null>(null);
  const initialPayout = requests.find(
    (request) => request.status === "paid" && Boolean(request.replyTo) && !request.decidedAt,
  );
  const [payoutRequestId, setPayoutRequestId] = useState<string | null>(initialPayout?.id ?? null);
  const [payoutOpen, setPayoutOpen] = useState(Boolean(initialPayout));

  const pendingRequests = requests.filter((r) => r.status === "pending");
  const unresolvedRequests = requests.filter((r) => r.unresolved);
  const decidedRequests = requests.filter((r) => r.status !== "pending" && !r.unresolved);

  // Settling an unknown payout: "sent" needs the operator's reference.
  const [resolving, setResolving] = useState<{ request: AdminWithdrawalRequest; outcome: "sent" | "not_sent" } | null>(null);
  const [resolveReference, setResolveReference] = useState("");

  function submitResolve() {
    const target = resolving;
    if (!target) return;
    startTransition(async () => {
      const result = await resolveUnresolvedWithdrawal({
        requestId: target.request.id,
        outcome: target.outcome,
        reference: resolveReference,
      });
      if (!result.ok) return toast(result.error, "error");
      setResolving(null);
      setResolveReference("");
      toast(
        target.outcome === "sent" ? "Recorded as sent." : "Recorded as not sent — the wallet was credited back.",
        "success",
      );
    });
  }

  function submitCredit() {
    const amount = Number(creditAmount);
    setFundingInstruction(null);
    startTransition(async () => {
      const result = await fundWallet(creditRestaurant, creditPhone, amount);
      if (!result.ok) {
        toast(result.error, "error");
        return;
      }
      if (result.status === "pending" && result.attemptId) {
        if (result.instruction) setFundingInstruction(result.instruction);
        setFundingAttemptId(result.attemptId);
        setFundingOpen(true);
        return;
      }
      toast("CamerPay confirmed the payment and the wallet was credited.", "success");
      setCreditRestaurant("");
      setCreditAmount("");
      setCreditPhone("");
      setShowCredit(false);
    });
  }

  useEffect(() => {
    if (!fundingAttemptId) return;
    let checking = false;
    const timer = setInterval(async () => {
      if (checking) return;
      checking = true;
      try {
        const result = await checkWalletFunding(fundingAttemptId);
        if (result.instruction) setFundingInstruction(result.instruction);
        if (result.status === "succeeded") {
          clearInterval(timer);
          setFundingAttemptId(null);
          setFundingOpen(false);
          toast("CamerPay confirmed the payment and the wallet was credited.", "success");
          setCreditRestaurant("");
          setCreditAmount("");
          setCreditPhone("");
          setShowCredit(false);
        } else if (!result.ok || result.status === "failed") {
          clearInterval(timer);
          setFundingAttemptId(null);
          setFundingOpen(false);
          toast(result.ok ? "CamerPay rejected the payment." : result.error, "error");
        }
      } finally {
        checking = false;
      }
    }, 4_000);
    return () => clearInterval(timer);
  }, [fundingAttemptId, toast]);

  useEffect(() => {
    if (!payoutRequestId) return;
    let checking = false;
    const timer = setInterval(async () => {
      if (checking) return;
      checking = true;
      try {
        const result = await checkWithdrawalPayout(payoutRequestId);
        if (result.status === "succeeded") {
          clearInterval(timer);
          setPayoutRequestId(null);
          setPayoutOpen(false);
          toast("CamerPay confirmed the restaurant payout.", "success");
        } else if (!result.ok || result.status === "failed") {
          clearInterval(timer);
          setPayoutRequestId(null);
          setPayoutOpen(false);
          toast(result.ok ? "CamerPay reported that the payout failed. The wallet was refunded." : result.error, "error");
        }
      } finally {
        checking = false;
      }
    }, 4_000);
    return () => clearInterval(timer);
  }, [payoutRequestId, toast]);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-secondary">
          Restaurant withdrawals are sent immediately. This page monitors their provider status and wallet funding.
        </p>
        {/* Choosing whose wallet a collection credits is super-admin only
            (fundWallet refuses anyone else). */}
        {isSuper ? (
          <Button variant="outline" size="sm" onClick={() => setShowCredit((v) => !v)}>
            <Wallet className="size-3.5" aria-hidden />
            <span>{showCredit ? "Hide credit" : "Credit a wallet"}</span>
          </Button>
        ) : (
          <SuperAdminOnlyHint />
        )}
      </div>

      {showCredit && isSuper && (
        <Card className="border-primary/30">
          <CardBody className="flex flex-col gap-4">
            <p className="text-sm font-semibold">Fund a restaurant wallet through CamerPay</p>
            <p className="text-xs text-text-light">
              CamerPay collects the amount from the phone below. The wallet is credited only after provider confirmation.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Restaurant id" htmlFor="wl-credit-restaurant" required className="sm:col-span-1">
                <Input
                  id="wl-credit-restaurant"
                  value={creditRestaurant}
                  onChange={(e) => setCreditRestaurant(e.target.value)}
                  placeholder="uuid"
                  className="font-mono text-xs"
                />
              </Field>
              <Field label="Amount (FCFA)" htmlFor="wl-credit-amount" required>
                <Input
                  id="wl-credit-amount"
                  type="number"
                  min={1}
                  value={creditAmount}
                  onChange={(e) => setCreditAmount(e.target.value)}
                />
              </Field>

              <Field label="Customer Mobile Money number" htmlFor="wl-credit-phone" required>
                <Input
                  id="wl-credit-phone"
                  type="tel"
                  inputMode="tel"
                  value={creditPhone}
                  onChange={(e) => setCreditPhone(e.target.value)}
                  placeholder="6XXXXXXXX"
                />
              </Field>
            </div>
            <Button
              className="self-start"
              disabled={pending || !creditRestaurant.trim() || !creditPhone.trim() || !(Number(creditAmount) > 0)}
              loading={pending}
              onClick={submitCredit}
            >
              <Wallet className="size-4" aria-hidden />
              <span>Collect and fund wallet</span>
            </Button>
          </CardBody>
        </Card>
      )}

      {/*
        Debited, outcome unknown: the payout call broke after the wallet was
        debited. Check the provider's own report, then record what happened.
        Until then the restaurant's money is in limbo — this panel is first.
      */}
      {unresolvedRequests.length > 0 && (
        <Panel
          title="Payouts to verify"
          description="The wallet was debited but the provider never answered. Look each one up in the CamerPay/SasPay report, then record the outcome."
        >
          <ul className="divide-y divide-border">
            {unresolvedRequests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
                <AlertTriangle className="size-4 shrink-0 text-error" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    {r.restaurantName}
                    <span className="ml-2 tnum font-normal text-text-light">
                      {r.amount.toLocaleString("fr-CM")} FCFA → {r.phone}
                    </span>
                  </p>
                  <p className="tnum mt-0.5 text-xs text-text-light">
                    {formatDateTime(r.requestedAt)}
                    {who(r) && ` · ${who(r)}`}
                  </p>
                </div>
                {isSuper ? (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => setResolving({ request: r, outcome: "sent" })}>
                      It was sent
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-error hover:bg-error-light"
                      disabled={pending}
                      onClick={() => setResolving({ request: r, outcome: "not_sent" })}
                    >
                      Not sent — refund
                    </Button>
                  </div>
                ) : (
                  <SuperAdminOnlyHint />
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel
        title="Pending withdrawals"
        description={`${pendingRequests.length} request${pendingRequests.length === 1 ? "" : "s"} waiting.`}
      >
        {pendingRequests.length === 0 ? (
          <EmptyState
            icon={<ArrowUpFromLine />}
            title="Nothing pending"
            description="Restaurant withdrawal requests will appear here."
          />
        ) : (
          <ul className="divide-y divide-border">
            {pendingRequests.map((r) => (
              <PendingRow key={r.id} request={r} />
            ))}
          </ul>
        )}
      </Panel>

      {decidedRequests.length > 0 && (
        <Panel title="History" description="Decided requests, newest first.">
          <ul className="divide-y divide-border">
            {decidedRequests.slice(0, 15).map((r) => {
              const processing = r.status === "paid" && Boolean(r.replyTo) && !r.decidedAt;
              return (
              <li key={r.id} className="flex flex-wrap items-center gap-x-6 gap-y-1 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    {r.restaurantName}
                    <span className="ml-2 tnum font-normal text-text-light">
                      {r.amount.toLocaleString("fr-CM")} FCFA → {r.phone}
                    </span>
                  </p>
                  <p className="tnum mt-0.5 text-xs text-text-light">
                    {formatDateTime(r.requestedAt)}
                    {/* Who sent it and whose account it reached (0073). */}
                    {who(r) && ` · ${who(r)}`}
                  </p>
                </div>
                {r.fee !== null && (
                  <span className="tnum text-xs text-text-light">
                    fee {r.fee.toLocaleString("fr-CM")} · net {r.net?.toLocaleString("fr-CM")}
                  </span>
                )}
                <Badge tone={processing ? "warning" : r.status === "paid" ? "success" : "neutral"}>
                  {processing ? "Processing" : r.status === "paid" ? "Paid" : "Rejected"}
                </Badge>
              </li>
              );
            })}
          </ul>
        </Panel>
      )}
      <Dialog
        open={resolving !== null}
        onClose={() => setResolving(null)}
        title={resolving?.outcome === "sent" ? "Confirm the payout was sent" : "Record the payout as not sent"}
        size="sm"
        footer={
          <>
            <Button variant="outline" disabled={pending} onClick={() => setResolving(null)}>
              Cancel
            </Button>
            <Button
              loading={pending}
              disabled={pending || (resolving?.outcome === "sent" && resolveReference.trim().length < 4)}
              onClick={submitResolve}
            >
              {resolving?.outcome === "sent" ? "Record as sent" : "Credit the wallet back"}
            </Button>
          </>
        }
      >
        {resolving && (
          <div className="flex flex-col gap-3 text-sm text-text-secondary">
            <p>
              {resolving.request.restaurantName} · {resolving.request.amount.toLocaleString("fr-CM")} FCFA →{" "}
              {resolving.request.phone}
            </p>
            {resolving.outcome === "sent" ? (
              <Field label="Operator reference (from the provider report)" htmlFor="wl-resolve-ref" required>
                <Input
                  id="wl-resolve-ref"
                  value={resolveReference}
                  onChange={(e) => setResolveReference(e.target.value)}
                  className="font-mono text-xs"
                />
              </Field>
            ) : (
              <p className="rounded-md border border-warning/30 bg-warning-light p-3 text-xs text-warning">
                Only do this if the provider report shows NO transfer to this number. The full amount goes back to the
                restaurant&apos;s wallet; if the money had in fact left, it would be paid twice.
              </p>
            )}
          </div>
        )}
      </Dialog>

      <Dialog
        open={payoutOpen}
        onClose={() => setPayoutOpen(false)}
        title="Restaurant payout processing"
        size="sm"
        footer={
          <Button variant="outline" onClick={() => setPayoutOpen(false)}>
            Continue in background
          </Button>
        }
      >
        <PaymentPendingView
          body="CamerPay accepted the transfer request. The restaurant sees Processing until the provider confirms it."
          hint="This status updates automatically. A failed payout is returned to the restaurant wallet."
          amountLabel="Status"
          amount="Processing"
          referenceLabel="Withdrawal"
          reference={payoutRequestId ?? ""}
          phoneLabel="Provider"
          phone="CamerPay"
          gatewayLabel="Confirmation"
        />
      </Dialog>

      <Dialog
        open={fundingOpen}
        onClose={() => setFundingOpen(false)}
        title="Wallet payment pending"
        size="sm"
        footer={
          <Button variant="outline" onClick={() => setFundingOpen(false)}>
            Continue in background
          </Button>
        }
      >
        <PaymentPendingView
          body="Approve the Mobile Money request. The wallet remains unchanged until CamerPay confirms it."
          hint="This status updates automatically. Closing the window does not mark the payment as successful."
          amountLabel="Amount"
          amount={Number(creditAmount || 0).toLocaleString("fr-CM") + " FCFA"}
          referenceLabel="Restaurant"
          reference={creditRestaurant}
          phoneLabel="Phone"
          phone={creditPhone}
          gatewayLabel="Provider"
          instruction={fundingInstruction}
        />
      </Dialog>
    </div>
  );
}

/** "by Paul (manager) → Jean Mbarga": who withdrew, as what, to whom. */
function who(request: AdminWithdrawalRequest): string {
  const by = request.requestedByName
    ? `by ${request.requestedByName}${request.requesterRole ? ` (${request.requesterRole})` : ""}`
    : "";
  const to = request.recipientName ? `to ${request.recipientName}` : "";
  return [by, to].filter(Boolean).join(" ");
}

function PendingRow({ request }: { request: AdminWithdrawalRequest }) {
  return (
    <li className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{request.restaurantName}</p>
        <p className="tnum text-sm text-text-secondary">
          {request.amount.toLocaleString("fr-CM")} FCFA
          <span className="ml-2 font-mono text-xs text-text-light">→ {request.phone}</span>
        </p>
        <p className="mt-0.5 text-xs text-text-light">
          {who(request) ? `${who(request)} · ` : ""}
          {formatDateTime(request.requestedAt)}
          {request.note ? ` · ${request.note}` : ""}
        </p>
      </div>
      <Badge tone="warning">Awaiting restaurant retry</Badge>
    </li>
  );
}
