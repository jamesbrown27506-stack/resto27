import { OrdersClient } from "./orders-client";
import { requireUser } from "@/lib/auth/session";
import { fetchCustomerOrders } from "@/lib/data/customer";

export default async function OrdersPage() {
  const user = await requireUser();
  const orders = await fetchCustomerOrders(user.id);

  return <OrdersClient user={user} orders={orders} />;
}
