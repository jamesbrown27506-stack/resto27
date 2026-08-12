import { notFound } from "next/navigation";
import { OrderDetailView } from "./order-detail-view";
import { requireCapability } from "@/lib/auth/branch";
import { fetchOrder } from "@/lib/data/orders";

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
  const order = await fetchOrder(active.restaurantId, id);
  if (!order) notFound();

  return <OrderDetailView order={order} />;
}
