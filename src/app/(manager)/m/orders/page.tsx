import type { Metadata } from "next";
import { ManagerPage } from "@/components/layout/manager-shell";
import { OrdersQueue } from "./orders-queue";
import { requireCapability } from "@/lib/auth/branch";
import { can } from "@/lib/capabilities";
import { fetchOrders } from "@/lib/data/orders";
import { fetchDeliveryFeeBand } from "@/lib/data/manager";
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
  const [orders, feeBand] = await Promise.all([
    fetchOrders(active.restaurantId),
    fetchDeliveryFeeBand(active.restaurantId),
  ]);

  return (
    <ManagerPage titleKey="m.orders.title" descriptionKey="m.orders.subtitle">
      {/* `now` is stamped on the server so elapsed times are computed against
          one clock — Date.now() in a client render is impure and drifts from
          the HTML anyway. */}
      {/* Viewing the queue and acting on it are DIFFERENT capabilities: the
          page is gated on `orders.view` so a waiter can read the board, while
          the buttons are gated on `orders.advance`, which both server actions
          re-check anyway. */}
      <OrdersQueue
        orders={orders}
        now={new Date().toISOString()}
        feeBand={feeBand}
        canAdvance={can(active.role, "orders.advance")}
      />
    </ManagerPage>
  );
}
