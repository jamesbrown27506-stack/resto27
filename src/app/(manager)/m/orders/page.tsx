import type { Metadata } from "next";
import { ManagerPage } from "@/components/layout/manager-shell";
import { ServicePauseToggle } from "@/components/order/service-pause-toggle";
import { OrdersQueue } from "./orders-queue";
import { requireCapability } from "@/lib/auth/branch";
import { can } from "@/lib/capabilities";
import { fetchOrders } from "@/lib/data/orders";
import { fetchDeliveryFeeBand } from "@/lib/data/manager";
import { getTimeLimits } from "@/lib/orders/time-limit-settings";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/locale-server";

/** The browser tab is a user-visible string too, so it follows the locale. */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: DICTIONARIES[locale]["nav.m.orders"] };
}

// Orders change by the minute; caching this page would show a stale queue.
export const dynamic = "force-dynamic";

export default async function ManagerOrdersPage() {
  const { active } = await requireCapability("orders.view");
  const [orders, feeBand, limits] = await Promise.all([
    fetchOrders(active.restaurantId),
    fetchDeliveryFeeBand(active.restaurantId),
    // The admin's time limit (0059): each waiting card counts down to it.
    getTimeLimits(),
  ]);

  return (
    <ManagerPage
      titleKey="m.orders.title"
      descriptionKey="m.orders.subtitle"
      // The emergency brake lives where the flood is visible (service.pause).
      action={
        can(active.role, "service.pause") ? (
          <ServicePauseToggle accepting={active.isAcceptingOrders} />
        ) : undefined
      }
    >
      {/* `now` is stamped on the server so elapsed times are computed against
          one clock — Date.now() in a client render is impure and drifts from
          the HTML anyway. */}
      {/* Viewing the queue and acting on it are DIFFERENT capabilities: the
          page is gated on `orders.view` so a waiter can read the board, while
          the buttons are gated on `orders.advance` (and cancelling on the
          separate `orders.cancel`), which the server actions re-check. */}
      <OrdersQueue
        orders={orders}
        now={new Date().toISOString()}
        feeBand={feeBand}
        canAdvance={can(active.role, "orders.advance")}
        canCancel={can(active.role, "orders.cancel")}
        orderMinutes={limits.orderMinutes}
      />
    </ManagerPage>
  );
}
