"use client";

import { useState, useTransition } from "react";
import { Percent, Plus, TicketPercent, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardBody, Panel } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select, Switch } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format/datetime";
import {
  savePlatformCoupon,
  togglePlatformCoupon,
} from "@/lib/data/platform-actions";
import type { PlatformCouponRow } from "@/lib/data/platform";
import { cn } from "@/lib/utils";

/**
 * Platform coupon codes — created here, applied at checkout (migration 0023).
 *
 * The whole programme has a master switch in /a/settings → Payments
 * ("Platform coupon codes"); this screen manages the individual codes. The
 * form is deliberately small: a code, a discount, and the two limits that
 * matter (min order, max discount). Everything else has a safe default.
 */
export function CouponsClient({ coupons }: { coupons: PlatformCouponRow[] }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<PlatformCouponRow | null>(null);
  const [showForm, setShowForm] = useState(coupons.length === 0);

  const [code, setCode] = useState("");
  const [discountType, setDiscountType] = useState<"percent" | "fixed">("percent");
  const [discountValue, setDiscountValue] = useState("10");
  const [minOrder, setMinOrder] = useState("0");
  const [maxDiscount, setMaxDiscount] = useState("");

  function openCreate() {
    setEditing(null);
    setCode("");
    setDiscountType("percent");
    setDiscountValue("10");
    setMinOrder("0");
    setMaxDiscount("");
    setShowForm(true);
  }

  function openEdit(c: PlatformCouponRow) {
    setEditing(c);
    setCode(c.code);
    setDiscountType(c.discountType === "percent" ? "percent" : "fixed");
    setDiscountValue(String(c.discountValue));
    setMinOrder(String(c.minOrder));
    setMaxDiscount(c.maxDiscount === null ? "" : String(c.maxDiscount));
    setShowForm(true);
  }

  function save() {
    startTransition(async () => {
      const result = await savePlatformCoupon({
        id: editing?.id,
        code,
        discountType,
        discountValue: Number(discountValue),
        minOrder: Number(minOrder) || 0,
        maxDiscount: maxDiscount === "" ? null : Number(maxDiscount),
        isActive: editing?.isActive ?? true,
      });

      if (!result.ok) {
        toast(result.error, "error");
        return;
      }
      toast(editing ? "Coupon updated." : "Coupon created.", "success");
      setShowForm(false);
      setEditing(null);
    });
  }

  function toggle(c: PlatformCouponRow) {
    startTransition(async () => {
      const result = await togglePlatformCoupon(c.id, !c.isActive);
      toast(
        result.ok ? (c.isActive ? "Coupon paused." : "Coupon active.") : (result.error ?? "Failed."),
        result.ok ? "success" : "error",
      );
    });
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {showForm && (
        <Panel
          title={editing ? `Edit ${editing.code}` : "New coupon code"}
          description="Codes are case-insensitive and applied at checkout when the platform switch is on."
        >
          <CardBody className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Code" htmlFor="cp-code" required hint="Letters, digits, underscore. Stored uppercase.">
                <Input
                  id="cp-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="WELCOME10"
                  className="font-mono uppercase"
                />
              </Field>

              <Field label="Discount type" htmlFor="cp-type">
                <Select id="cp-type" value={discountType} onChange={(e) => setDiscountType(e.target.value as "percent" | "fixed")}>
                  <option value="percent">Percentage (%)</option>
                  <option value="fixed">Fixed amount (FCFA)</option>
                </Select>
              </Field>

              <Field
                label={discountType === "percent" ? "Discount %" : "Discount (FCFA)"}
                htmlFor="cp-value"
                required
              >
                <Input
                  id="cp-value"
                  type="number"
                  min={1}
                  max={discountType === "percent" ? 100 : undefined}
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                />
              </Field>

              <Field label="Minimum order (FCFA)" htmlFor="cp-min" hint="0 = no minimum.">
                <Input id="cp-min" type="number" min={0} value={minOrder} onChange={(e) => setMinOrder(e.target.value)} />
              </Field>

              <Field
                label="Maximum discount (FCFA)"
                htmlFor="cp-cap"
                hint="Caps a percentage discount. Empty = uncapped."
                className="sm:col-span-2"
              >
                <Input
                  id="cp-cap"
                  type="number"
                  min={1}
                  value={maxDiscount}
                  onChange={(e) => setMaxDiscount(e.target.value)}
                  placeholder="Uncapped"
                />
              </Field>
            </div>

            <div className="flex gap-2">
              <Button loading={pending} disabled={pending || !code.trim() || !(Number(discountValue) > 0)} onClick={save}>
                <Plus className="size-4" aria-hidden />
                <span>{editing ? "Save changes" : "Create coupon"}</span>
              </Button>
              <Button variant="ghost" disabled={pending} onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            </div>
          </CardBody>
        </Panel>
      )}

      {!showForm && (
        <Button variant="outline" className="self-start" onClick={openCreate}>
          <Plus className="size-4" aria-hidden />
          <span>New coupon</span>
        </Button>
      )}

      <Panel title="Coupon codes" description="The master switch lives in Settings → Payments.">
        {coupons.length === 0 ? (
          <EmptyState
            icon={<TicketPercent />}
            title="No coupons yet"
            description="Create a code like WELCOME10 to give first orders a discount."
          />
        ) : (
          <ul className="divide-y divide-border">
            {coupons.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold">{c.code}</span>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                        c.isActive ? "bg-success-light text-success" : "bg-surface-2 text-text-light",
                      )}
                    >
                      {c.isActive ? "Active" : "Paused"}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-text-secondary">
                    {c.discountType === "percent" ? `${c.discountValue}% off` : `${c.discountValue.toLocaleString("fr-CM")} FCFA off`}
                    {c.minOrder > 0 && ` · min ${c.minOrder.toLocaleString("fr-CM")} FCFA`}
                    {c.maxDiscount !== null && ` · capped at ${c.maxDiscount.toLocaleString("fr-CM")} FCFA`}
                  </p>
                  <p className="tnum mt-0.5 text-xs text-text-light">
                    Used {c.usedCount}
                    {c.usageLimit !== null ? ` / ${c.usageLimit}` : ""} · created {formatDate(c.createdAt)}
                  </p>
                </div>

                <div className="flex items-center gap-1.5">
                  <Button variant="outline" size="sm" disabled={pending} onClick={() => openEdit(c)}>
                    Edit
                  </Button>
                  <Switch
                    label=""
                    checked={c.isActive}
                    disabled={pending}
                    onChange={(e) => toggle(c)}
                    aria-label={`Toggle ${c.code}`}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <p className="flex items-center gap-2 text-xs text-text-light">
        <Percent className="size-3.5" aria-hidden />
        Restaurant-owned promotions still take precedence — a code that matches a restaurant&apos;s own
        promotion is handled by that restaurant.
      </p>
    </div>
  );
}
