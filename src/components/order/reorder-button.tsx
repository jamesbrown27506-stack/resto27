"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { useCart } from "@/components/cart/cart-provider";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { prepareReorder, type PrepareReorderResult } from "@/lib/data/reorder-actions";
import { useLocale } from "@/lib/i18n/use-locale";

/** One line of the past order, as order_items stores it. */
export interface ReorderButtonLine {
  /** order_items.menu_item_id — null when the dish was deleted since. */
  menuItemId: string | null;
  /** order_items.name — named back to the customer if the line is skipped. */
  name: string;
  quantity: number;
  /** order_items.options_label ("Grande · Piment") or the option names. */
  options?: string | string[] | null;
  /** order_items.notes, carried into the new basket line. */
  notes?: string | null;
}

export interface ReorderButtonProps {
  /** The restaurant's public slug (restaurants.slug). */
  restaurantSlug: string;
  lines: ReorderButtonLine[];
  className?: string;
  variant?: "primary" | "outline" | "ghost";
  size?: "sm" | "md" | "lg";
  fullWidth?: boolean;
}

type Ready = Extract<PrepareReorderResult, { ok: true }>;

/**
 * "Commander à nouveau" — rebuild a past order's basket and go to /cart.
 *
 * The server matches the old lines against TODAY's menu (lib/orders/reorder):
 * current prices, options matched by name, and any dish that is gone,
 * unavailable or can no longer be composed the same way is left out and
 * named in a toast, never silently swapped for something close.
 *
 * Same one-restaurant rule as the menu (menu-orderer / modifier-sheet): a
 * basket holding another kitchen's dishes is only replaced after the
 * customer confirms. A basket from the SAME restaurant is added to.
 *
 * Self-contained so the order page can drop it in:
 *   <ReorderButton restaurantSlug={order.restaurantSlug}
 *     lines={order.items.map((i) => ({ menuItemId: i.menuItemId, name: i.name,
 *       quantity: i.quantity, options: i.optionsLabel, notes: i.notes }))} />
 */
export function ReorderButton({
  restaurantSlug,
  lines,
  className,
  variant = "outline",
  size = "md",
  fullWidth = false,
}: ReorderButtonProps) {
  const router = useRouter();
  const { t } = useLocale();
  const { toast } = useToast();
  const { addLine, clear, itemCount, restaurantId: cartRestaurantId } = useCart();
  const [working, setWorking] = useState(false);
  const [pendingReplace, setPendingReplace] = useState<Ready | null>(null);

  function fill(ready: Ready, replace: boolean) {
    if (replace) clear();
    for (const line of ready.lines) {
      addLine({
        ...line,
        restaurantId: ready.restaurant.id,
        restaurantName: ready.restaurant.name,
        restaurantSlug: ready.restaurant.slug,
      });
    }
    if (ready.skipped.length > 0) {
      toast(t("sui.reorder.skipped", { dishes: ready.skipped.join(", ") }), "warning");
    } else {
      toast(t("sui.reorder.done"), "success");
    }
    router.push("/cart");
  }

  async function start() {
    if (working || lines.length === 0) return;
    setWorking(true);
    let result: PrepareReorderResult;
    try {
      result = await prepareReorder({ restaurantSlug, lines });
    } catch {
      result = { ok: false, reason: "failed" };
    }
    setWorking(false);

    if (!result.ok) {
      toast(t(result.reason === "unavailable" ? "sui.reorder.unavailable" : "sui.reorder.failed"), "error");
      return;
    }
    if (result.lines.length === 0) {
      toast(t("sui.reorder.nothing"), "warning");
      return;
    }
    if (itemCount > 0 && cartRestaurantId && cartRestaurantId !== result.restaurant.id) {
      setPendingReplace(result);
      return;
    }
    fill(result, false);
  }

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        fullWidth={fullWidth}
        className={className}
        loading={working}
        disabled={working || lines.length === 0}
        onClick={() => void start()}
      >
        {!working && <RotateCcw className="size-4" aria-hidden />}
        {working ? t("sui.reorder.working") : t("sui.reorder.button")}
      </Button>
      <ConfirmDialog
        open={pendingReplace !== null}
        onClose={() => setPendingReplace(null)}
        onConfirm={() => {
          const ready = pendingReplace;
          setPendingReplace(null);
          if (ready) fill(ready, true);
        }}
        title={t("sui.reorder.replaceTitle")}
        message={t("sui.reorder.replaceBody")}
        confirmLabel={t("sui.reorder.replaceConfirm")}
        cancelLabel={t("sui.reorder.cancel")}
      />
    </>
  );
}
