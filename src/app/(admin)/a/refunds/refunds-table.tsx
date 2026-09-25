"use client";

import { SuperAdminOnlyHint, useIsSuperAdmin } from "@/components/layout/admin-shell";
import { useState, useTransition } from "react";
import { Ban, Info, Plus, RotateCcw, Undo2 } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CellStack, DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Radio, Select, Textarea } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { StatTile } from "@/components/ui/stat-tile";
import { useToast } from "@/components/ui/toast";
import { formatMoney } from "@/lib/format/currency";
import { formatDate } from "@/lib/format/datetime";
import { adminCancelOrder, adminRetryRefund, createRefund } from "@/lib/data/billing-actions";
import type { RefundRow } from "@/lib/data/billing";

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  pending: { label: "Pending", tone: "warning" },
  completed: { label: "Completed", tone: "success" },
  rejected: { label: "Rejected", tone: "error" },
};

export function RefundsTable({
  refunds,
  restaurants,
}: {
  refunds: RefundRow[];
  restaurants: { id: string; name: string }[];
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const isSuper = useIsSuperAdmin();

  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"refund" | "chargeback">("refund");
  const [restaurantId, setRestaurantId] = useState(restaurants[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [orderRef, setOrderRef] = useState("");
  const [cancelReason, setCancelReason] = useState("");

  const completed = refunds
    .filter((r) => r.status === "completed")
    .reduce((sum, r) => sum + r.amount, 0);

  const amountValue = Number(amount);
  const ready =
    restaurantId && Number.isInteger(amountValue) && amountValue > 0 && reason.trim().length >= 5;

  const columns: Column<RefundRow>[] = [
    {
      key: "reference",
      header: "Reference",
      cell: (r) => (
        <CellStack primary={<span className="tnum">{r.reference}</span>} secondary={r.createdBy} />
      ),
    },
    {
      key: "tenant",
      header: "Tenant",
      cell: (r) => <span className="font-medium">{r.restaurantName}</span>,
    },
    {
      key: "type",
      header: "Type",
      cell: (r) => (
        <Badge tone={r.type === "chargeback" ? "error" : "neutral"}>
          {r.type === "chargeback" ? "Chargeback" : "Refund"}
        </Badge>
      ),
    },
    {
      key: "reason",
      header: "Reason",
      hideBelow: "lg",
      cell: (r) => <span className="text-text-secondary">{r.reason}</span>,
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      cell: (r) => <span className="tnum font-semibold">{formatMoney(r.amount)}</span>,
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => {
        const meta = STATUS[r.status] ?? STATUS.pending;
        return (
          <span className="inline-flex items-center gap-2">
            <Badge tone={meta.tone}>{meta.label}</Badge>
            {/* A customer payout the saga gave up on: check CamerPay, then requeue. */}
            {r.customerRefund && r.status === "rejected" && !isSuper && <SuperAdminOnlyHint />}
            {r.customerRefund && r.status === "rejected" && isSuper && (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await adminRetryRefund(r.id);
                    toast(result.ok ? "Refund requeued." : result.error, result.ok ? "success" : "error");
                  })
                }
              >
                <RotateCcw className="size-3.5" aria-hidden />
                Retry
              </Button>
            )}
          </span>
        );
      },
    },
    {
      key: "created",
      header: "Created",
      align: "right",
      hideBelow: "md",
      cell: (r) => <span className="tnum text-text-light">{formatDate(r.createdAt)}</span>,
    },
  ];

  return (
    <>
      <div className="mb-6 flex flex-wrap justify-end gap-3">
        {/* Support's exit for a paid order that went wrong: cancel it and the
            customer's money goes back automatically (0059). */}
        <Button variant="outline" onClick={() => setCancelOpen(true)} disabled={pending}>
          <Ban className="size-4" aria-hidden />
          <span>Cancel &amp; refund an order</span>
        </Button>
        {/* Cancel & refund stays open to every admin (support work, the
            refund amount is the order's own); a free-form refund entry is
            money out by hand, so that button is super-admin only. */}
        <Button onClick={() => setOpen(true)} disabled={pending || restaurants.length === 0 || !isSuper}>
          <Plus className="size-4" aria-hidden />
          <span>New refund</span>
        </Button>
        {!isSuper && <SuperAdminOnlyHint />}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label="Refunded"
          value={formatMoney(completed, { showSymbol: false })}
          hint="FCFA"
          icon={<Undo2 />}
          positiveIsGood={false}
        />
        <StatTile label="Pending" value={refunds.filter((r) => r.status === "pending").length} />
        <StatTile
          label="Chargebacks"
          value={refunds.filter((r) => r.type === "chargeback").length}
          positiveIsGood={false}
        />
      </div>

      {/*
        §14.5 — refunds and chargebacks are THEIR OWN ROWS, never an edit to the
        original payment. Mutating the original destroys the record of what was
        actually collected, and the two numbers disagree forever.
      */}
      <p className="mt-6 flex max-w-3xl items-start gap-2.5 rounded-md border border-border bg-surface-2 p-4 text-sm text-text-secondary">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <span>
          A refund creates a <strong className="text-text">new entry</strong>. The original payment
          is never touched: it records what was collected, this records what was returned. Refunded
          orders are also excluded from the next commission run.
        </span>
      </p>

      <div className="mt-6 overflow-hidden rounded-lg border border-border bg-surface">
        <DataTable
          columns={columns}
          rows={refunds}
          rowKey={(r) => r.id}
          empty={
            <EmptyState
              icon={<Undo2 />}
              title="No refunds"
              description="Nothing has been refunded or charged back. Entries appear here as they are raised — none are seeded."
            />
          }
        />
      </div>

      <Sheet
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel & refund an order"
        footer={
          <div className="flex gap-3">
            <Button variant="outline" fullWidth onClick={() => setCancelOpen(false)}>
              Close
            </Button>
            <Button
              fullWidth
              variant="danger"
              disabled={!orderRef.trim() || cancelReason.trim().length < 5 || pending}
              loading={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await adminCancelOrder({ reference: orderRef, reason: cancelReason });
                  if (result.ok) {
                    setCancelOpen(false);
                    setOrderRef("");
                    setCancelReason("");
                    toast(result.note ?? "Order cancelled.", "success");
                  } else {
                    toast(result.error, "error");
                  }
                })
              }
            >
              Cancel order
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-5">
          <p className="text-sm text-text-secondary">
            Paid online orders are refunded in full to the customer&apos;s Mobile Money (or wallet), and the
            restaurant&apos;s wallet is debited. Unpaid orders are simply cancelled. The customer reads the reason.
          </p>
          <Field label="Order reference" htmlFor="cancel-order-ref" required>
            <Input
              id="cancel-order-ref"
              placeholder="CMD-A1B2C3"
              value={orderRef}
              onChange={(e) => setOrderRef(e.target.value)}
            />
          </Field>
          <Field label="Reason" htmlFor="cancel-order-reason" required>
            <Textarea
              id="cancel-order-reason"
              rows={3}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
          </Field>
        </div>
      </Sheet>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="New refund"
        footer={
          <div className="flex gap-3">
            <Button variant="outline" fullWidth onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              fullWidth
              disabled={!ready || pending}
              loading={pending}
              onClick={() => {
                setOpen(false);
                startTransition(async () => {
                  const result = await createRefund({
                    restaurantId,
                    amount: amountValue,
                    reason,
                    type,
                  });
                  if (result.ok) {
                    setAmount("");
                    setReason("");
                    toast("Refund entry created.", "success");
                  } else {
                    toast(result.error, "error");
                  }
                });
              }}
            >
              Create entry
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-5">
          <fieldset>
            <legend className="mb-2 text-[11px] font-bold tracking-[0.08em] text-text-light uppercase">
              Type
            </legend>
            <div className="flex flex-col gap-2">
              <Radio
                name="refund-type"
                checked={type === "refund"}
                onChange={() => setType("refund")}
                label="Refund"
                description="We are voluntarily returning money we collected."
              />
              <Radio
                name="refund-type"
                checked={type === "chargeback"}
                onChange={() => setType("chargeback")}
                label="Chargeback"
                description="The operator or bank pulled the money back."
              />
            </div>
          </fieldset>

          <Field label="Tenant" htmlFor="rf-restaurant" required>
            <Select
              id="rf-restaurant"
              value={restaurantId}
              onChange={(e) => setRestaurantId(e.target.value)}
            >
              {restaurants.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Amount" htmlFor="rf-amount" required hint="Whole francs — XAF has no decimals.">
            <Input
              id="rf-amount"
              inputMode="numeric"
              suffix="FCFA"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="9000"
            />
          </Field>

          <Field
            label="Reason"
            htmlFor="rf-reason"
            required
            hint="Appears on the tenant's statement. Be specific."
          >
            <Textarea
              id="rf-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Duplicate charge on invoice INV-2026-014"
            />
          </Field>

          <p className="text-xs leading-relaxed text-text-light">
            Recorded against your account in the audit trail, and deducted from the period&apos;s
            revenue.
          </p>
        </div>
      </Sheet>
    </>
  );
}
