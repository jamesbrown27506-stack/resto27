"use client";

import { useState, useTransition } from "react";
import { ArrowUpFromLine, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, Panel } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/format/datetime";
import { computeWithdrawalFee } from "@/lib/payments/withdrawal-fee";
import { requestWithdrawal } from "@/lib/data/wallet-actions";
import type { WalletState } from "@/lib/data/wallet";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<string, string> = {
  payment: "Payment received",
  deposit: "Reservation deposit",
  withdrawal: "Withdrawal",
  adjustment: "Adjustment",
};

const REQUEST_STATUS: Record<string, { label: string; tone: "success" | "warning" | "neutral" }> = {
  pending: { label: "Pending", tone: "warning" },
  paid: { label: "Paid", tone: "success" },
  rejected: { label: "Rejected", tone: "neutral" },
};

export function WalletClient({
  state,
  fee,
}: {
  state: WalletState;
  fee: { enabled: boolean; percent: number };
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [amount, setAmount] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");

  const gross = Number(amount);
  const feeEnabled = fee.enabled && fee.percent > 0;
  const { fee: feeAmount, net } = computeWithdrawalFee(gross, feeEnabled ? fee.percent : 0);
  const valid = Number.isInteger(gross) && gross >= 500 && gross <= state.balance && net >= 500;

  function submit() {
    startTransition(async () => {
      const result = await requestWithdrawal({
        amount: gross,
        phone,
        note,
      });
      if (!result.ok) {
        toast(result.error, "error");
        return;
      }
      toast("Demande envoyée. Un administrateur la traitera.", "success");
      setAmount("");
      setPhone("");
      setNote("");
    });
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {/* ── Balance ─────────────────────────────────────────────────── */}
      <Card className="border-primary/30">
        <CardBody className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold tracking-[0.08em] text-text-light uppercase">
              <span>Solde disponible</span>
            </p>
            <p className="tnum mt-1 font-display text-3xl font-bold">
              {state.balance.toLocaleString("fr-CM")} FCFA
            </p>
            <p className="mt-1 text-xs text-text-light">
              <span>L&apos;argent reçu via la plateforme, en attente de retrait.</span>
            </p>
          </div>
          <Wallet className="size-10 text-primary" aria-hidden />
        </CardBody>
      </Card>

      {/* ── Withdraw form ───────────────────────────────────────────── */}
      <Panel
        title="Demander un retrait"
        description="Le montant part vers un numéro Mobile Money de votre choix. Un administrateur approuve et envoie le paiement."
      >
        <CardBody className="flex flex-col gap-4">
          {feeEnabled && (
            <p className="rounded-md border border-warning/30 bg-warning-light p-3 text-xs text-warning">
              <span>
                Frais de retrait : <strong>{fee.percent} %</strong> — retenus sur le montant. Vous
                recevez le montant net.
              </span>
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
                onChange={(e) => setAmount(e.target.value)}
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
                onChange={(e) => setPhone(e.target.value)}
                placeholder="6XXXXXXXX"
                inputMode="numeric"
              />
            </Field>
          </div>

          {feeEnabled && Number.isFinite(gross) && gross > 0 && (
            <div className="rounded-md border border-border bg-surface-2 p-3 text-sm">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-text-secondary">Demandé (brut)</span>
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
            onClick={submit}
          >
            <ArrowUpFromLine className="size-4" aria-hidden />
            <span>Demander le retrait</span>
          </Button>
        </CardBody>
      </Panel>

      {/* ── Requests ────────────────────────────────────────────────── */}
      {state.requests.length > 0 && (
        <Panel title="Demandes de retrait" description="Vos retraits, du plus récent au plus ancien.">
          <ul className="divide-y divide-border">
            {state.requests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-6 gap-y-1 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="tnum text-sm font-semibold">
                    {r.amount.toLocaleString("fr-CM")} FCFA
                    <span className="ml-2 font-normal text-text-light">→ {r.phone}</span>
                  </p>
                  <p className="tnum mt-0.5 text-xs text-text-light">{formatDateTime(r.requestedAt)}</p>
                </div>
                {r.fee !== null && (
                  <span className="tnum text-xs text-text-light">frais {r.fee.toLocaleString("fr-CM")} FCFA</span>
                )}
                <Badge tone={REQUEST_STATUS[r.status]?.tone ?? "neutral"}>
                  {REQUEST_STATUS[r.status]?.label ?? r.status}
                </Badge>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/* ── Ledger ──────────────────────────────────────────────────── */}
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
                <span className="tnum shrink-0 text-xs text-text-light">{formatDateTime(entry.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
