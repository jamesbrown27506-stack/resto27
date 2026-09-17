"use client";

import { useState, useTransition } from "react";
import { Info, Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Switch } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatMoney } from "@/lib/format/currency";
import { updatePlan } from "@/lib/data/billing-actions";
import type { Plan } from "@/lib/data/billing";
import { cn } from "@/lib/utils";

/** Empty input = unlimited. Not -1, not 0 — those read as real ceilings. */
function toLimit(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export function PlansEditor({ plans }: { plans: Plan[] }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Record<string, Plan>>(() =>
    Object.fromEntries(plans.map((p) => [p.id, p])),
  );

  function patch(id: string, changes: Partial<Plan>) {
    setDraft((prev) => ({ ...prev, [id]: { ...prev[id], ...changes } }));
  }

  function save(plan: Plan) {
    startTransition(async () => {
      const result = await updatePlan(plan.id, {
        monthlyPrice: plan.monthlyPrice,
        commissionRate: plan.commissionRate,
        menuItemLimit: plan.menuItemLimit,
        tableLimit: plan.tableLimit,
        promotionLimit: plan.promotionLimit,
        includedBranches: plan.includedBranches,
        staffLimit: plan.staffLimit,
        scheduledPayouts: plan.scheduledPayouts,
        prioritySupport: plan.prioritySupport,
        staffManagement: plan.staffManagement,
        analytics: plan.analytics,
        isActive: plan.isActive,
        isFeatured: plan.isFeatured,
      });
      if (result.ok) toast(`${plan.name} saved. Public pricing updated.`, "success");
      else toast(result.error, "error");
    });
  }

  if (plans.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Layers />}
          title="No plans"
          description="Run migration 0004_subscriptions.sql to create the plan table and its three tiers."
        />
      </Card>
    );
  }

  return (
    <>
      {/*
        The reason this page exists at all. In the PHP build the limits were
        hardcoded in code while /pricing rendered its own copy from a template,
        so the marketing page could promise 100 dishes while the app refused
        the 21st.
      */}
      <p className="mb-6 flex max-w-3xl items-start gap-2.5 rounded-md border border-info/25 bg-info-light p-4 text-sm text-info">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          These values are read by <strong>both</strong> the public pricing page and the limit
          checks inside the app. There is no second copy: what you advertise is what you enforce.
          Leave a limit empty for unlimited.
        </span>
      </p>

      <div className="grid gap-6 xl:grid-cols-3">
        {plans.map((original) => {
          const plan = draft[original.id] ?? original;
          const dirty = JSON.stringify(plan) !== JSON.stringify(original);

          return (
            <Card key={plan.id} className={cn(plan.isFeatured && "border-primary")}>
              <div className="flex items-start justify-between gap-3 border-b border-border p-5">
                <div>
                  <h2 className="font-display text-xl font-bold">{plan.name}</h2>
                  <p className="tnum text-sm text-text-secondary">
                    {formatMoney(plan.monthlyPrice)} / month
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  {plan.isFeatured && <Badge tone="primary">Featured</Badge>}
                  <Badge tone={plan.isActive ? "success" : "neutral"}>
                    {plan.isActive ? "Active" : "Hidden"}
                  </Badge>
                  <Badge tone="neutral">
                    {plan.subscriberCount} tenant{plan.subscriberCount === 1 ? "" : "s"}
                  </Badge>
                </div>
              </div>

              <CardBody className="flex flex-col gap-4">
                <Field label="Monthly price" htmlFor={`price-${plan.id}`}>
                  <Input
                    id={`price-${plan.id}`}
                    inputMode="numeric"
                    suffix="FCFA"
                    value={String(plan.monthlyPrice)}
                    onChange={(e) =>
                      patch(plan.id, { monthlyPrice: Number(e.target.value) || 0 })
                    }
                  />
                </Field>

                <Field label="Commission" htmlFor={`commission-${plan.id}`}>
                  <Input
                    id={`commission-${plan.id}`}
                    inputMode="decimal"
                    suffix="%"
                    value={String(plan.commissionRate)}
                    onChange={(e) =>
                      patch(plan.id, { commissionRate: Number(e.target.value) || 0 })
                    }
                  />
                </Field>

                <div className="grid grid-cols-3 gap-3">
                  <Field label="Dishes" htmlFor={`menu-${plan.id}`}>
                    <Input
                      id={`menu-${plan.id}`}
                      inputMode="numeric"
                      placeholder="∞"
                      value={plan.menuItemLimit ?? ""}
                      onChange={(e) => patch(plan.id, { menuItemLimit: toLimit(e.target.value) })}
                    />
                  </Field>
                  <Field label="Tables" htmlFor={`tables-${plan.id}`}>
                    <Input
                      id={`tables-${plan.id}`}
                      inputMode="numeric"
                      placeholder="∞"
                      value={plan.tableLimit ?? ""}
                      onChange={(e) => patch(plan.id, { tableLimit: toLimit(e.target.value) })}
                    />
                  </Field>
                  <Field label="Promos" htmlFor={`promos-${plan.id}`}>
                    <Input
                      id={`promos-${plan.id}`}
                      inputMode="numeric"
                      placeholder="∞"
                      value={plan.promotionLimit ?? ""}
                      onChange={(e) => patch(plan.id, { promotionLimit: toLimit(e.target.value) })}
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Included branches" htmlFor={`branches-${plan.id}`}>
                    <Input id={`branches-${plan.id}`} inputMode="numeric" min={1} value={String(plan.includedBranches)} onChange={(e) => patch(plan.id, { includedBranches: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
                  </Field>
                  <Field label="Staff seats" htmlFor={`staff-limit-${plan.id}`}>
                    <Input id={`staff-limit-${plan.id}`} inputMode="numeric" min={0} value={String(plan.staffLimit)} onChange={(e) => patch(plan.id, { staffLimit: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
                  </Field>
                </div>

                <div className="flex flex-col gap-3 border-t border-border pt-4">
                  <Switch
                    label="Staff management"
                    checked={plan.staffManagement}
                    onChange={(e) => patch(plan.id, { staffManagement: e.target.checked })}
                  />
                  <Switch
                    label="Reports and analytics"
                    checked={plan.analytics}
                    onChange={(e) => patch(plan.id, { analytics: e.target.checked })}
                  />
                  <Switch
                    label="Scheduled payouts"
                    description="Allows restaurants on this plan to schedule withdrawals."
                    checked={plan.scheduledPayouts}
                    onChange={(e) => patch(plan.id, { scheduledPayouts: e.target.checked })}
                  />
                  <Switch
                    label="Priority support"
                    checked={plan.prioritySupport}
                    onChange={(e) => patch(plan.id, { prioritySupport: e.target.checked })}
                  />
                  <Switch
                    label="Plan is active"
                    description={
                      plan.subscriberCount > 0
                        ? `${plan.subscriberCount} tenant(s) are on it — hiding it keeps them, it just stops new signups.`
                        : "Hidden plans stay valid for existing subscribers."
                    }
                    checked={plan.isActive}
                    onChange={(e) => patch(plan.id, { isActive: e.target.checked })}
                  />
                  <Switch
                    label="Feature on /pricing"
                    checked={plan.isFeatured}
                    onChange={(e) => patch(plan.id, { isFeatured: e.target.checked })}
                  />
                </div>

                <Button
                  fullWidth
                  disabled={!dirty || pending}
                  loading={pending}
                  onClick={() => save(plan)}
                >
                  {dirty ? "Save changes" : "No changes"}
                </Button>
              </CardBody>
            </Card>
          );
        })}
      </div>

      <p className="mt-6 text-sm text-text-light">
        Existing subscribers keep the price they signed up at until their next renewal.
      </p>
    </>
  );
}
