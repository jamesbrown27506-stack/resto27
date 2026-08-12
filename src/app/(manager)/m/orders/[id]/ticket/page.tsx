import { notFound } from "next/navigation";
import { TicketView } from "./ticket-view";
import { requireCapability } from "@/lib/auth/branch";
import { fetchOrder } from "@/lib/data/orders";
import { getBranding } from "@/lib/branding";

export const dynamic = "force-dynamic";

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { active } = await requireCapability("orders.view");

  const [order, brand] = await Promise.all([fetchOrder(active.restaurantId, id), getBranding()]);
  if (!order) notFound();

  return <TicketView order={order} restaurantName={active.restaurantName} brandName={brand.name} />;
}
