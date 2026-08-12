"use client";

import { useMemo, useState, useTransition } from "react";
import { CreditCard, ShieldCheck } from "lucide-react";
import { FilterBar } from "@/components/data/filter-bar";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CellStack, DataTable, type Column } from "@/components/ui/data-table";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { StatTile } from "@/components/ui/stat-tile";
import { useToast } from "@/components/ui/toast";
import { formatMoney } from "@/lib/format/currency";
import { formatDateTime } from "@/lib/format/datetime";
import { confirmPaymentAttempt } from "@/lib/data/billing-actions";
import type { PaymentAttemptRow } from "@/lib/data/billing";

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  pending: { label: "Pending", tone: "warning" },
  succeeded: { label: "Succeeded", tone: "success" },
  failed: { label: "Failed", tone: "error" },
  abandoned: { label: "Abandoned", tone: "neutral" },
};

export function PaymentsTable({ attempts }: { attempts: PaymentAttemptRow[] }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [confirming, setConfirming] = useState<PaymentAttemptRow | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return attempts.filter((a) => {
      if (status !== "all" && a.status !== status) return false;
      if (!q) return true;
      return (
        a.reference.toLowerCase().includes(q) ||
        a.restaurantName.toLowerCase().includes(q) ||
        a.invoiceNumber.toLowerCase().includes(q) ||
        (a.transactionId?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [attempts, query, status]);

  const settled = attempts
    .filter((a) => a.status === "succeeded")
    .reduce((sum, a) => sum + a.amount, 0);

  const columns: Column<PaymentAttemptRow>[] = [
    {
      key: "reference",
      header: "Reference",
      cell: (a) => (
        <CellStack
          primary={<span className="tnum">{a.reference}</span>}
          secondary={a.transactionId ?? "no provider id yet"}
        />
      ),
    },
    {
      key: "tenant",
      header: "Tenant",
      cell: (a) => <CellStack primary={a.restaurantName} secondary={a.invoiceNumber} />,
    },
    {
      key: "method",
      header: "Method",
      hideBelow: "md",
      cell: (a) => (
        <CellStack primary={a.method ?? a.provider} secondary={a.phone ?? undefined} />
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      cell: (a) => <span className="tnum font-semibold">{formatMoney(a.amount)}</span>,
    },
    {
      key: "status",
      header: "Status",
      cell: (a) => {
        const meta = STATUS[a.status] ?? STATUS.pending;
        return <Badge tone={meta.tone}>{meta.label}</Badge>;
      },
    },
    {
      key: "created",
      header: "Created",
      align: "right",
      hideBelow: "lg",
      cell: (a) => (
        <span className="tnum text-text-light">{formatDateTime(a.createdAt)}</span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      cell: (a) =>
        a.status === "pending" ? (
          <Button size="sm" disabled={pending} onClick={() => setConfirming(a)}>
            Confirm
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label="Settled"
          value={formatMoney(settled, { showSymbol: false })}
          hint="FCFA"
          icon={<CreditCard />}
          tone="dark"
        />
        <StatTile
          label="Pending"
          value={attempts.filter((a) => a.status === "pending").length}
          hint="Swept by the reconciler every 10 min"
          positiveIsGood={false}
        />
        <StatTile
          label="Failed"
          value={attempts.filter((a) => a.status === "failed").length}
          positiveIsGood={false}
        />
      </div>

      {/*
        §6 — the single idempotent activation path. The webhook, the reconciler
        and this button all go through the same function. The moment there are
        two paths they disagree, and the disagreement is money.
      */}
      <p className="mt-6 flex max-w-3xl items-start gap-2.5 rounded-md border border-border bg-surface-2 p-4 text-sm text-text-secondary">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <span>
          Confirming here takes <strong className="text-text">exactly the same path</strong> as the
          provider webhook and the reconciler. The amount is re-checked against the invoice first,
          and confirming twice credits once.
        </span>
      </p>

      <div className="mt-6">
        <FilterBar
          query={query}
          onQueryChange={setQuery}
          placeholder="Reference, transaction or tenant…"
          onClear={() => {
            setQuery("");
            setStatus("all");
          }}
          selects={[
            {
              key: "status",
              label: "Status",
              value: status,
              onChange: setStatus,
              options: [
                { value: "all", label: "All statuses" },
                { value: "pending", label: "Pending" },
                { value: "succeeded", label: "Succeeded" },
                { value: "failed", label: "Failed" },
                { value: "abandoned", label: "Abandoned" },
              ],
            },
          ]}
        />
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-border bg-surface">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(a) => a.id}
          empty={
            <EmptyState
              icon={<CreditCard />}
              title="No payment attempts"
              description="Attempts appear here once a restaurant pays a subscription invoice. Nothing is seeded — every figure on this page comes from a real transaction."
            />
          }
        />
      </div>

      <ConfirmDialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        onConfirm={() => {
          const attempt = confirming;
          setConfirming(null);
          if (!attempt) return;
          startTransition(async () => {
            const result = await confirmPaymentAttempt(attempt.id);
            if (result.ok) toast("Payment confirmed. The invoice is settled.", "success");
            else toast(result.error, "error");
          });
        }}
        title="Confirm this payment?"
        message={
          confirming
            ? `${formatMoney(confirming.amount)} for ${confirming.restaurantName}, invoice ${confirming.invoiceNumber}. The amount is verified against the invoice before anything is credited — a provider saying "paid" does not prove it settles the invoice you think it does.`
            : ""
        }
        confirmLabel="Confirm payment"
      />
    </>
  );
}
