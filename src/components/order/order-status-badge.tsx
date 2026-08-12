"use client";

import { Check, Clock, Flame, PackageCheck, Truck, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ORDER_STATUS_META, type OrderStatus } from "@/lib/format/order-status";
import { useLocale } from "@/lib/i18n/use-locale";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

const ICONS = {
  clock: Clock,
  check: Check,
  flame: Flame,
  truck: Truck,
  "package-check": PackageCheck,
  x: X,
} as const;

/**
 * One component for order status, used on /orders, /orders/[id], /m/orders,
 * /m/kitchen, /a and every receipt. Colour and icon come from
 * ORDER_STATUS_META; the LABEL comes from the dictionary, so every one of
 * those screens follows the language toggle at once.
 */
export function OrderStatusBadge({
  status,
  size = "md",
  showIcon = true,
  className,
}: {
  status: OrderStatus;
  size?: "sm" | "md";
  showIcon?: boolean;
  className?: string;
}) {
  const { t } = useLocale();
  const meta = ORDER_STATUS_META[status];
  const Icon = ICONS[meta.icon];

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
      <span>{t(`order.status.${status}` as TranslationKey)}</span>
    </span>
  );
}

/** Bare coloured dot — for dense table rows where a full badge is too heavy. */
export function OrderStatusDot({ status, className }: { status: OrderStatus; className?: string }) {
  const { t } = useLocale();
  const meta = ORDER_STATUS_META[status];
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className={cn("size-2 shrink-0 rounded-full", meta.dot)} aria-hidden />
      <span className="text-sm">{t(`order.status.${status}` as TranslationKey)}</span>
    </span>
  );
}
