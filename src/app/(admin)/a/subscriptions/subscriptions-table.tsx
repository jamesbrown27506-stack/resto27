"use client";

import { useIsSuperAdmin } from "@/components/layout/admin-shell";
import { useMemo, useState, useTransition } from "react";
import { CalendarClock, CalendarPlus } from "lucide-react";
import { FilterBar } from "@/components/data/filter-bar";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CellStack, DataTable, type Column } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Select } from "@/components/ui/input";
import { StatTile } from "@/components/ui/stat-tile";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format/datetime";
import { changeSubscriptionPlan, extendSubscription } from "@/lib/data/billing-actions";
import type { Plan, SubscriptionRow } from "@/lib/data/billing";
import { cn } from "@/lib/utils";

const STATE: Record<string, { label: string; tone: BadgeTone }> = {
  active: { label: "Active", tone: "success" },
  grace: { label: "In grace", tone: "warning" },
  locked: { label: "Locked", tone: "error" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  /**
   * A restaurant with NO subscription row at all — not one that lapsed.
   *
   * Shown distinctly from "Locked" on purpose: locked means they stopped
   * paying, this means they were never enrolled. Choosing any plan from the
   * dropdown creates the row and clears it.
   */
  none: { label: "No plan", tone: "warning" },
};

export function SubscriptionsTable({
  subscriptions,
  plans,
}: {
  subscriptions: SubscriptionRow[];
  plans: Plan[];
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const isSuper = useIsSuperAdmin();

  const [query, setQuery] = useState("");
  const [state, setState] = useState("all");
  const [extending, setExtending] = useState<SubscriptionRow | null>(null);
  const [days, setDays] = useState("30");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return subscriptions.filter((s) => {
      if (state !== "all" && s.state !== state) return false;
      return !q || s.restaurantName.toLowerCase().includes(q);
    });
  }, [subscriptions, query, state]);

  const counts = {
    active: subscriptions.filter((s) => s.state === "active").length,
    grace: subscriptions.filter((s) => s.state === "grace").length,
    locked: subscriptions.filter((s) => s.state === "locked").length,
  };

  function act(fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const result = await fn();
      if (result.ok) toast(success, "success");
      else toast(result.error ?? "Something went wrong.", "error");
    });
  }

  const columns: Column<SubscriptionRow>[] = [
    {
      key: "restaurant",
      header: "Tenant",
      cell: (s) => (
        <CellStack
          primary={s.restaurantName}
          secondary={s.branchLabel && s.branchLabel !== "Principal" ? s.branchLabel : undefined}
        />
      ),
    },
    {
      key: "plan",
      header: "Plan",
      cell: (s) => (
        <div className="w-40">
          <label className="sr-only" htmlFor={`plan-${s.restaurantId}`}>
            Plan for {s.restaurantName}
          </label>
          <Select
            id={`plan-${s.restaurantId}`}
            value={plans.find((p) => p.name === s.planName)?.id ?? ""}
            // Moving a tenant between plans (and extending, below) hands out
            // paid service without an invoice — super admins only.
            disabled={pending || !isSuper}
            title={isSuper ? undefined : "Super admin only"}
            onChange={(e) =>
              act(
                () => changeSubscriptionPlan(s.restaurantId, e.target.value),
                `${s.restaurantName} moved plan.`,
              )
            }
            className="h-9 text-sm"
          >
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
      ),
    },
    {
      key: "state",
      header: "State",
      cell: (s) => {
        const meta = STATE[s.state] ?? STATE.cancelled;
        return <Badge tone={meta.tone}>{meta.label}</Badge>;
      },
    },
    {
      key: "end",
      header: "Expires",
      hideBelow: "sm",
      // §5 rule 1 — null means never expires, not "expired in 1970". Rendering
      // it as blank is precisely how the original revenue leak read.
      cell: (s) =>
        s.state === "none" ? (
          <span className="text-text-light">—</span>
        ) : s.endDate === null ? (
          <span className="font-medium text-success">Never</span>
        ) : (
          <span className="tnum text-text-secondary">{formatDate(s.endDate)}</span>
        ),
    },
    {
      key: "remaining",
      header: "Remaining",
      align: "right",
      hideBelow: "md",
      cell: (s) => {
        if (s.state === "none") return <span className="text-text-light">—</span>;
        if (s.endDate === null) return <span className="text-text-light">∞</span>;
        if (s.state === "locked") {
          return <span className="font-semibold text-error">Past grace</span>;
        }
        if (s.state === "grace") {
          return <span className="font-semibold text-warning">In grace ({s.graceDays}d)</span>;
        }
        return (
          <span
            className={cn(
              "tnum font-semibold",
              (s.daysRemaining ?? 0) <= 7 ? "text-warning" : "text-text-secondary",
            )}
          >
            {s.daysRemaining} d
          </span>
        );
      },
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      cell: (s) => (
        <Button
          variant="outline"
          size="sm"
          disabled={pending || s.endDate === null || !isSuper}
          title={
            !isSuper
              ? "Super admin only"
              : s.endDate === null
                ? "This subscription never expires"
                : undefined
          }
          onClick={() => {
            setExtending(s);
            setDays("30");
          }}
        >
          <CalendarPlus className="size-3.5" aria-hidden />
          <span>Extend</span>
        </Button>
      ),
    },
  ];

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Active" value={counts.active} icon={<CalendarClock />} tone="primary" />
        <StatTile label="In grace period" value={counts.grace} positiveIsGood={false} />
        <StatTile label="Locked" value={counts.locked} positiveIsGood={false} />
      </div>

      <div className="mt-6">
        <FilterBar
          query={query}
          onQueryChange={setQuery}
          placeholder="Tenant name…"
          onClear={() => {
            setQuery("");
            setState("all");
          }}
          selects={[
            {
              key: "state",
              label: "State",
              value: state,
              onChange: setState,
              options: [
                { value: "all", label: "All states" },
                { value: "active", label: "Active" },
                { value: "grace", label: "In grace" },
                { value: "locked", label: "Locked" },
                { value: "cancelled", label: "Cancelled" },
                { value: "none", label: "No plan" },
              ],
            },
          ]}
        />
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-border bg-surface">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(s) => s.restaurantId}
          empty={
            <EmptyState
              icon={<CalendarClock />}
              title="No subscriptions"
              description={
                subscriptions.length === 0
                  ? "Run migration 0004_subscriptions.sql to create the tables and give each restaurant a subscription."
                  : "Adjust your filters."
              }
            />
          }
        />
      </div>

      <Dialog
        open={extending !== null}
        onClose={() => setExtending(null)}
        title="Extend subscription"
        description={extending?.restaurantName}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setExtending(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const sub = extending;
                setExtending(null);
                if (sub) {
                  act(
                    () => extendSubscription(sub.restaurantId, Number(days)),
                    `${sub.restaurantName} extended by ${days} days.`,
                  );
                }
              }}
            >
              Extend
            </Button>
          </>
        }
      >
        <Field label="Duration" htmlFor="extend-days" required>
          <Select id="extend-days" value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="7">7 days</option>
            <option value="14">14 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="365">1 year</option>
          </Select>
        </Field>

        <p className="mt-4 text-sm leading-relaxed text-text-secondary">
          Extends from the current expiry when it is still in the future, otherwise from today.
          Extending from today would quietly shorten a subscription that still has time on it. A
          locked tenant regains its paid limits immediately.
        </p>
      </Dialog>
    </>
  );
}
