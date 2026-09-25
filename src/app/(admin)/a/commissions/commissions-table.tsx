"use client";

import { SuperAdminOnlyHint, useIsSuperAdmin } from "@/components/layout/admin-shell";
import { useState, useTransition } from "react";
import { Info, Lock, Percent, RefreshCw } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CellStack, DataTable, type Column } from "@/components/ui/data-table";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input } from "@/components/ui/input";
import { StatTile } from "@/components/ui/stat-tile";
import { useToast } from "@/components/ui/toast";
import { formatMoney, formatPercent } from "@/lib/format/currency";
import { formatDate } from "@/lib/format/datetime";
import { generateCommissions, setCommissionStatus } from "@/lib/data/billing-actions";
import type { CommissionRow } from "@/lib/data/billing";

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  issued: { label: "Issued", tone: "info" },
  settled: { label: "Settled", tone: "success" },
  written_off: { label: "Written off", tone: "error" },
};

/** First and last day of the previous whole month, as ISO strings. */
function defaultPeriod(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export function CommissionsTable({ statements }: { statements: CommissionRow[] }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const isSuper = useIsSuperAdmin();

  const initial = defaultPeriod();
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [regenerating, setRegenerating] = useState(false);

  const drafts = statements.filter((s) => s.status === "draft");
  const totalCommission = statements.reduce((sum, s) => sum + s.commissionAmount, 0);
  const totalSales = statements.reduce((sum, s) => sum + s.grossSales, 0);

  function act(fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const result = await fn();
      if (result.ok) toast(success, "success");
      else toast(result.error ?? "Something went wrong.", "error");
    });
  }

  const columns: Column<CommissionRow>[] = [
    {
      key: "tenant",
      header: "Tenant",
      cell: (s) => (
        <CellStack
          primary={s.restaurantName}
          secondary={`${formatDate(s.periodStart)} – ${formatDate(s.periodEnd)}`}
        />
      ),
    },
    {
      key: "orders",
      header: "Orders",
      align: "right",
      hideBelow: "md",
      cell: (s) => <span className="tnum">{s.orderCount}</span>,
    },
    {
      key: "sales",
      header: "Qualifying sales",
      align: "right",
      cell: (s) => <span className="tnum font-medium">{formatMoney(s.grossSales)}</span>,
    },
    {
      key: "rate",
      header: "Rate",
      align: "right",
      hideBelow: "sm",
      cell: (s) => (
        <span className="tnum font-semibold" title="Frozen when the statement was generated">
          {formatPercent(s.commissionRate)}
        </span>
      ),
    },
    {
      key: "commission",
      header: "Commission",
      align: "right",
      cell: (s) => (
        <span className="tnum font-display font-bold text-primary">
          {formatMoney(s.commissionAmount)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (s) => {
        const meta = STATUS[s.status] ?? STATUS.draft;
        return (
          <span className="inline-flex items-center gap-1.5">
            <Badge tone={meta.tone}>{meta.label}</Badge>
            {s.status !== "draft" && (
              <Lock className="size-3 text-text-light" aria-label="Locked" />
            )}
          </span>
        );
      },
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      cell: (s) => (
        <div className="flex justify-end gap-1.5">
          {s.status === "draft" && (
            <Button
              size="sm"
              disabled={pending}
              onClick={() => act(() => setCommissionStatus(s.id, "issued"), "Statement issued.")}
            >
              Issue
            </Button>
          )}
          {s.status === "issued" && !isSuper && <SuperAdminOnlyHint />}
          {s.status === "issued" && isSuper && (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() =>
                  act(() => setCommissionStatus(s.id, "settled"), "Marked settled.")
                }
              >
                Mark settled
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                className="text-error hover:bg-error-light"
                onClick={() =>
                  act(() => setCommissionStatus(s.id, "written_off"), "Written off.")
                }
              >
                Write off
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label="Total commission"
          value={formatMoney(totalCommission, { showSymbol: false })}
          hint="FCFA"
          icon={<Percent />}
          tone="dark"
        />
        <StatTile
          label="Qualifying sales"
          value={formatMoney(totalSales, { showSymbol: false })}
          hint="FCFA, delivery excluded"
        />
        <StatTile label="Drafts" value={drafts.length} hint="Review before issuing" />
      </div>

      {/*
        §7 — the two rules that decide every figure on this page. Stating them
        on screen is not decoration: someone about to issue a statement should
        be able to see why a number is what it is.
      */}
      <p className="mt-6 flex max-w-3xl items-start gap-2.5 rounded-md border border-border bg-surface-2 p-4 text-sm text-text-secondary">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <span>
          Only <strong className="text-text">delivered, non-refunded</strong> orders count, and{" "}
          <strong className="text-text">delivery fees are excluded</strong> — that money is the
          restaurant&apos;s cost, not its revenue. The rate is frozen when a statement is
          generated, so changing a plan later never rewrites a statement a tenant has already seen.
        </span>
      </p>

      {/* ── Generate ─────────────────────────────────────────────────── */}
      <div className="mt-6 rounded-lg border border-border bg-surface p-5">
        <h2 className="font-display text-lg font-bold">Generate a period</h2>
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <Field label="From" htmlFor="period-start" className="w-44">
            <Input
              id="period-start"
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </Field>
          <Field label="To (exclusive)" htmlFor="period-end" className="w-44">
            <Input id="period-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
          <Button
            variant="outline"
            disabled={pending || !start || !end}
            loading={pending}
            onClick={() => setRegenerating(true)}
          >
            <RefreshCw className="size-4" aria-hidden />
            <span>Generate</span>
          </Button>
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-lg border border-border bg-surface">
        <DataTable
          columns={columns}
          rows={statements}
          rowKey={(s) => s.id}
          empty={
            <EmptyState
              icon={<Percent />}
              title="No statements yet"
              description="Pick a period above and generate. Statements are computed from real delivered orders — nothing here is seeded."
            />
          }
        />
      </div>

      <ConfirmDialog
        open={regenerating}
        onClose={() => setRegenerating(false)}
        onConfirm={() => {
          setRegenerating(false);
          act(
            () =>
              generateCommissions(
                new Date(`${start}T00:00:00Z`).toISOString(),
                new Date(`${end}T00:00:00Z`).toISOString(),
              ),
            "Drafts generated.",
          );
        }}
        title="Generate statements for this period?"
        message={`Only DRAFT statements are written or recalculated. Anything already issued, settled or written off is left exactly as the tenant last saw it — silently rewriting an issued statement is how you lose their trust permanently.`}
        confirmLabel="Generate drafts"
      />
    </>
  );
}
