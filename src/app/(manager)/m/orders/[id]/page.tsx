import { notFound } from "next/navigation";
import { OrderDetailView } from "./order-detail-view";
import { requireCapability } from "@/lib/auth/branch";
import { can } from "@/lib/capabilities";
import { fetchOrder } from "@/lib/data/orders";
import { fetchDeliveryFeeBand } from "@/lib/data/manager";
import { fetchOrderCustomerId } from "@/lib/data/chat-context";
import { getTimeLimits } from "@/lib/orders/time-limit-settings";

export const dynamic = "force-dynamic";

export default async function ManagerOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { active } = await requireCapability("orders.view");

  // Scoped by branch inside fetchOrder: an id copied from another tenant's URL
  // returns null here, which renders as 404 rather than as their order.
  //
  // The advertised delivery band is fetched HERE rather than inside the view,
  // because confirming a delivery order from this page opens the same fee
  // dialog the queue uses, and that dialog pre-fills the minimum the customer
  // was shown before ordering (migration 0035).
  // customerId: the account behind the order, for "Écrire au client" — null
  // for a guest / table order, which then shows no chat button at all.
  const [order, feeBand, customerId, limits] = await Promise.all([
    fetchOrder(active.restaurantId, id),
    fetchDeliveryFeeBand(active.restaurantId),
    fetchOrderCustomerId(active.restaurantId, id),
    // The time limit behind the accept / pay-by countdown (0059).
    getTimeLimits(),
  ]);
  if (!order) notFound();

  return (
    /*
      Two different capabilities on purpose. `orders.view` gates the PAGE, so
      a waiter can open a ticket to read an address. `orders.advance` gates the
      BUTTONS, and both server actions re-check it — so a role that cannot act
      sees no controls instead of controls that fail.
    */
    <OrderDetailView
      order={order}
      feeBand={feeBand}
      canAdvance={can(active.role, "orders.advance")}
      canCancel={can(active.role, "orders.cancel")}
      orderMinutes={limits.orderMinutes}
      now={new Date().toISOString()}
      customerId={customerId}
    />
  );
}
