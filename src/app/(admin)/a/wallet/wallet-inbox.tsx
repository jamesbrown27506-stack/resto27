"use client";

import { useState, useTransition } from "react";
import { ArrowUpFromLine, Check, Wallet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, Panel } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/format/datetime";
import { approveWithdrawal, creditWallet, rejectWithdrawal } from "@/lib/data/wallet-actions";
import type { AdminWithdrawalRequest } from "@/lib/data/wallet";

/**
 * The withdrawal inbox. Approving sends REAL money via CamerPay (fee
 * withheld) and debits the restaurant's wallet; rejecting returns it to the
 * balance untouched. The fee preview reads the same setting the action will.
 */
export function WalletInbox({
  adminName,
  requests,
}: {
  adminName: string;
  requests: AdminWithdrawalRequest[];
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [acting, setActing] = useState<string | null>(null);

  // The credit box — which restaurant, how much, and for what.
  const [creditRestaurant, setCreditRestaurant] = useState("");
  const [creditAmount, setCreditAmount] = useState("");
  const [creditNote, setCreditNote] = useState("");
  const [showCredit, setShowCredit] = useState(false);

  const pendingRequests = requests.filter((r) => r.status === "pending");
  const decidedRequests = requests.filter((r) => r.status !== "pending");

  function run(id: string, fn: () => Promise<{ ok: boolean; error?: string; note?: string }>) {
    setActing(id);
    startTransition(async () => {
      const result = await fn();
      setActing(null);
      if (!result.ok) {
        toast(result.error ?? "Failed.", "error");
        return;
      }
      toast(result.note ?? "Done.", "success");
    });
  }

  function submitCredit() {
    const amount = Number(creditAmount);
    startTransition(async () => {
      const result = await creditWallet(creditRestaurant, amount, creditNote);
      if (!result.ok) {
        toast(result.error, "error");
        return;
      }
      toast(`Credited — new balance ${(result.balance ?? 0).toLocaleString("fr-CM")} FCFA.`, "success");
      setCreditRestaurant("");
      setCreditAmount("");
      setCreditNote("");
      setShowCredit(false);
    });
  }

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-secondary">
          Approving sends the payout through CamerPay (fee withheld) and debits the wallet.
        </p>
        <Button variant="outline" size="sm" onClick={() => setShowCredit((v) => !v)}>
          <Wallet className="size-3.5" aria-hidden />
          <span>{showCredit ? "Hide credit" : "Credit a wallet"}</span>
        </Button>
      </div>

      {showCredit && (
        <Card className="border-primary/30">
          <CardBody className="flex flex-col gap-4">
            <p className="text-sm font-semibold">Credit a restaurant wallet</p>
            <p className="text-xs text-text-light">
              Use this when money has actually been received for a restaurant (a CamerPay
              collection, a deposit paid at the counter). Audited.
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
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
              <Field label="Note" htmlFor="wl-credit-note">
                <Input
                  id="wl-credit-note"
                  value={creditNote}
                  onChange={(e) => setCreditNote(e.target.value)}
                  placeholder="Commande #…, acompte…"
                />
              </Field>
            </div>
            <Button
              className="self-start"
              disabled={pending || !creditRestaurant.trim() || !(Number(creditAmount) > 0)}
              loading={pending}
              onClick={submitCredit}
            >
              <Wallet className="size-4" aria-hidden />
              <span>Credit wallet</span>
            </Button>
          </CardBody>
        </Card>
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
              <PendingRow
                key={r.id}
                request={r}
                acting={acting === r.id}
                disabled={pending}
                onApprove={() =>
                  run(r.id, () => approveWithdrawal(r.id))
                }
                onReject={() =>
                  run(r.id, () => rejectWithdrawal(r.id))
                }
              />
            ))}
          </ul>
        )}
      </Panel>

      {decidedRequests.length > 0 && (
        <Panel title="History" description="Decided requests, newest first.">
          <ul className="divide-y divide-border">
            {decidedRequests.slice(0, 15).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-6 gap-y-1 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    {r.restaurantName}
                    <span className="ml-2 tnum font-normal text-text-light">
                      {r.amount.toLocaleString("fr-CM")} FCFA → {r.phone}
                    </span>
                  </p>
                  <p className="tnum mt-0.5 text-xs text-text-light">{formatDateTime(r.requestedAt)}</p>
                </div>
                {r.fee !== null && (
                  <span className="tnum text-xs text-text-light">
                    fee {r.fee.toLocaleString("fr-CM")} · net {r.net?.toLocaleString("fr-CM")}
                  </span>
                )}
                <Badge tone={r.status === "paid" ? "success" : "neutral"}>
                  {r.status === "paid" ? "Paid" : "Rejected"}
                </Badge>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function PendingRow({
  request,
  acting,
  disabled,
  onApprove,
  onReject,
}: {
  request: AdminWithdrawalRequest;
  acting: boolean;
  disabled: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{request.restaurantName}</p>
        <p className="tnum text-sm text-text-secondary">
          {request.amount.toLocaleString("fr-CM")} FCFA
          <span className="ml-2 font-mono text-xs text-text-light">→ {request.phone}</span>
        </p>
        <p className="mt-0.5 text-xs text-text-light">
          {request.requestedByName ? `${request.requestedByName} · ` : ""}
          {formatDateTime(request.requestedAt)}
          {request.note ? ` · ${request.note}` : ""}
        </p>
      </div>
      <div className="flex gap-1.5">
        <Button size="sm" loading={acting} disabled={disabled || acting} onClick={onApprove}>
          <Check className="size-3.5" aria-hidden />
          <span>Pay out</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || acting}
          className="text-error hover:bg-error-light"
          onClick={onReject}
        >
          <X className="size-3.5" aria-hidden />
          <span className="sr-only">Reject</span>
        </Button>
      </div>
    </li>
  );
}
