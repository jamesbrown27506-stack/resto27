"use client";

import {
  Check,
  Clock,
  Flame,
  HandPlatter,
  PackageCheck,
  ShoppingBag,
  Truck,
  UtensilsCrossed,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  orderStatusMeta,
  type OrderStatus,
  type OrderStatusIcon,
  type OrderType,
} from "@/lib/format/order-status";
import { useLocale } from "@/lib/i18n/use-locale";

/**
 * Exported so the timeline draws the SAME glyph for a step as the badge does
 * for the state — two maps drift, and a lorry on the timeline beside a paper
 * bag on the badge is exactly the confusion this change is fixing.
 */
export const STATUS_ICONS: Record<OrderStatusIcon, typeof Clock> = {
  clock: Clock,
  check: Check,
  flame: Flame,
  truck: Truck,
  "package-check": PackageCheck,
  x: X,
  "shopping-bag": ShoppingBag,
  utensils: UtensilsCrossed,
  "hand-platter": HandPlatter,
};

/**
 * One component for order status, used on /orders, /orders/[id], /m/orders,
 * /m/kitchen, /a and every receipt.
 *
 * `type` is REQUIRED, not optional with a delivery default. The same stored
 * status reads as "out for delivery", "ready for pickup" or "served at your
 * table" depending on it, and a default would have quietly kept every call
 * site that forgot to pass one saying the delivery words — which is the bug,
 * not the fix. Making it required turns each of those into a compile error.
 */
export function OrderStatusBadge({
  status,
  type,
  size = "md",
  showIcon = true,
  className,
}: {
  status: OrderStatus;
  type: OrderType;
  size?: "sm" | "md";
  showIcon?: boolean;
  className?: string;
}) {
  const { t } = useLocale();
  const meta = orderStatusMeta(status, type);
  const Icon = STATUS_ICONS[meta.icon];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-semibold whitespace-nowrap",
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
        meta.badge,
        className,
      )}
    >
      {/*
        The icon component changes with the status, so React replaces that
        element every time an order advances. If the label beside it were a
        bare text node, a browser translator would have replaced it with a
        <font> wrapper and the swap would throw NotFoundError.
        Wrapping the label gives React an element to reconcile against.
      */}
      {showIcon && <Icon className={size === "sm" ? "size-3" : "size-3.5"} aria-hidden />}
      <span>{t(meta.labelKey)}</span>
    </span>
  );
}

/** Bare coloured dot — for dense table rows where a full badge is too heavy. */
export function OrderStatusDot({
  status,
  type,
  className,
}: {
  status: OrderStatus;
  type: OrderType;
  className?: string;
}) {
  const { t } = useLocale();
  const meta = orderStatusMeta(status, type);
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className={cn("size-2 shrink-0 rounded-full", meta.dot)} aria-hidden />
      <span className="text-sm">{t(meta.labelKey)}</span>
    </span>
  );
}
