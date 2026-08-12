import { CartView } from "./cart-view";
import { getLoyaltyState } from "@/lib/data/cart-actions";

export default async function CartPage() {
  const loyalty = await getLoyaltyState();

  return <CartView balance={loyalty.balance} />;
}