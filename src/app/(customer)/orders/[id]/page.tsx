import { notFound } from "next/navigation";
import { OrderDetail } from "./order-detail";
import { requireUser } from "@/lib/auth/session";
import { fetchCustomerOrder } from "@/lib/data/customer";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const order = await fetchCustomerOrder(user.id, id);
  if (!order) notFound();

  return <OrderDetail order={order} />;
}
