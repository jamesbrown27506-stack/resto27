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

const KIND_LABEL: Record<string, string> = {
  payment: "Payment received",
  deposit: "Reservation deposit",
  withdrawal: "Withdrawal",
  adjustment: "Adjustment",
};

const REQUEST_STATUS: Record<string, { label: string; tone: "success" | "warning" | "neutral" }> = {
  pending: { label: "À envoyer", tone: "warning" },
  paid: { label: "Payé", tone: "success" },
  rejected: { label: "Échoué", tone: "neutral" },
};

export function WalletClient({
  state,
  fee,
}: {
  state: WalletState;
  fee: { enabled: boolean; percent: number };
}) {
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

  const gross = Number(amount);
  const feeEnabled = fee.enabled && fee.percent > 0;
  const { fee: feeAmount, net } = computeWithdrawalFee(gross, feeEnabled ? fee.percent : 0);
  const valid = Number.isInteger(gross) && gross >= 500 && gross <= state.balance && net >= 500;

  function finishStart(
    result: Awaited<ReturnType<typeof requestWithdrawal>>,
    requestAmount: number,
    requestPhone: string,
    clearForm: boolean,
  ) {
    if (!result.ok) {
      toast(result.error, "error");
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
      toast("Retrait envoyé. Confirmation CamerPay en cours.", "success");
    } else {
      toast(result.note ?? "Retrait effectué.", "success");
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
          toast("CamerPay a confirmé le retrait.", "success");
          router.refresh();
        } else if (!result.ok || result.status === "failed") {
          clearInterval(timer);
          setPayoutRequestId(null);
          setPayoutOpen(false);
          toast(
            result.ok
              ? "Le retrait a échoué. Le montant a été recrédité au portefeuille."
              : result.error,
            "error",
          );
          router.refresh();
        }
      } finally {
        checking = false;
      }
    }, 4_000);
    return () => clearInterval(timer);
  }, [payoutRequestId, router, toast]);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Card className="border-primary/30">
        <CardBody className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold tracking-[0.08em] text-text-light uppercase">
              Solde disponible
            </p>
            <p className="tnum mt-1 font-display text-3xl font-bold">
              {state.balance.toLocaleString("fr-CM")} FCFA
            </p>
            <p className="mt-1 text-xs text-text-light">
              L&apos;argent reçu via la plateforme, disponible pour un retrait immédiat.
            </p>
          </div>
          <Wallet className="size-10 text-primary" aria-hidden />
        </CardBody>
      </Card>

      <Panel
        title="Retirer de l'argent"
        description="Après votre confirmation, le paiement est envoyé immédiatement au numéro Mobile Money indiqué."
      >
        <CardBody className="flex flex-col gap-4">
          {feeEnabled && (
            <p className="rounded-md border border-warning/30 bg-warning-light p-3 text-xs text-warning">
              Taxe : <strong>{fee.percent} %</strong>. Ils sont retenus sur le montant demandé.
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Montant (FCFA)"
              htmlFor="wl-amount"
              required
              hint={`Disponible : ${state.balance.toLocaleString("fr-CM")} FCFA`}
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

            <Field
              label="Numéro Mobile Money"
              htmlFor="wl-phone"
              required
              hint="9 chiffres commençant par 6, sans +237."
            >
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
                <span className="text-text-secondary">Retiré du portefeuille</span>
                <span className="tnum font-semibold">{gross.toLocaleString("fr-CM")} FCFA</span>
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-4">
                <span className="text-text-secondary">Frais ({fee.percent}%)</span>
                <span className="tnum font-semibold text-text-light">
                  − {feeAmount.toLocaleString("fr-CM")} FCFA
                </span>
              </div>
              <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-border pt-2">
                <span className="font-semibold">Vous recevez</span>
                <span className={cn("tnum font-semibold", net >= 500 ? "text-success" : "text-error")}>
                  {net.toLocaleString("fr-CM")} FCFA
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
            <span>Retirer maintenant</span>
          </Button>
        </CardBody>
      </Panel>

      {state.requests.length > 0 && (
        <Panel title="Retraits" description="Vos retraits, du plus récent au plus ancien.">
          <ul className="divide-y divide-border">
            {state.requests.map((request) => {
              const processing =
                request.status === "paid" && Boolean(request.replyTo) && !request.decidedAt;
              const displayStatus = processing
                ? { label: "Confirmation", tone: "warning" as const }
                : REQUEST_STATUS[request.status];
              return (
                <li key={request.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="tnum text-sm font-semibold">
                      {request.amount.toLocaleString("fr-CM")} FCFA
                      <span className="ml-2 font-normal text-text-light">→ {request.phone}</span>
                    </p>
                    <p className="tnum mt-0.5 text-xs text-text-light">
                      {formatDateTime(request.requestedAt)}
                    </p>
                  </div>
                  {request.fee !== null && (
                    <span className="tnum text-xs text-text-light">
                      frais {request.fee.toLocaleString("fr-CM")} FCFA
                    </span>
                  )}
                  <Badge tone={displayStatus?.tone ?? "neutral"}>
                    {displayStatus?.label ?? request.status}
                  </Badge>
                  {request.status === "pending" && (
                    <Button
                      size="sm"
                      loading={pending}
                      disabled={pending}
                      onClick={() => retryWithdrawal(request.id, request.amount, request.phone)}
                    >
                      Envoyer maintenant
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      {state.ledger.length > 0 && (
        <Panel title="Historique du portefeuille" description="Chaque ligne explique le solde.">
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
                  {entry.amount.toLocaleString("fr-CM")} FCFA
                </span>
                <span className="min-w-0 flex-1 text-sm text-text-secondary">
                  {KIND_LABEL[entry.kind] ?? entry.kind}
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
        title="Confirmer le retrait"
        size="sm"
        footer={
          <>
            <Button variant="outline" disabled={pending} onClick={() => setConfirmOpen(false)}>
              Annuler
            </Button>
            <Button loading={pending} disabled={!valid} onClick={confirmWithdrawal}>
              Confirmer et envoyer
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4 text-sm">
          <p className="leading-relaxed text-text-secondary">
            Vérifiez le montant et le numéro. Le paiement sera lancé immédiatement après votre confirmation.
          </p>
          <dl className="divide-y divide-border rounded-md border border-border bg-surface-2 px-4">
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-text-secondary">Solde disponible</dt>
              <dd className="tnum font-semibold">{state.balance.toLocaleString("fr-CM")} FCFA</dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-text-secondary">Montant retiré</dt>
              <dd className="tnum font-semibold">{gross.toLocaleString("fr-CM")} FCFA</dd>
            </div>
            {feeEnabled && (
              <div className="flex items-center justify-between gap-4 py-3">
                <dt className="text-text-secondary">Vous recevez</dt>
                <dd className="tnum font-semibold text-success">{net.toLocaleString("fr-CM")} FCFA</dd>
              </div>
            )}
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-text-secondary">Numéro</dt>
              <dd className="tnum font-semibold">{phone.trim()}</dd>
            </div>
          </dl>
          <p className={cn("text-xs font-medium", state.balance >= gross ? "text-success" : "text-error")}>
            {state.balance >= gross
              ? "Le solde couvre ce retrait."
              : "Le solde ne couvre pas ce retrait."}
          </p>
        </div>
      </Dialog>

      <Dialog
        open={payoutOpen}
        onClose={() => setPayoutOpen(false)}
        title="Retrait en cours de confirmation"
        size="sm"
        footer={
          <Button variant="outline" onClick={() => setPayoutOpen(false)}>
            Continuer en arrière-plan
          </Button>
        }
      >
        <PaymentPendingView
          body="CamerPay a accepté le retrait. Le statut restera en cours jusqu'à la confirmation du paiement."
          hint="Vous pouvez fermer cette fenêtre. La vérification continue automatiquement."
          amountLabel="Montant"
          amount={payoutAmount.toLocaleString("fr-CM") + " FCFA"}
          referenceLabel="Retrait"
          reference={payoutRequestId ?? ""}
          phoneLabel="Numéro"
          phone={payoutPhone}
          gatewayLabel="Opérateur"
        />
      </Dialog>
    </div>
  );
}