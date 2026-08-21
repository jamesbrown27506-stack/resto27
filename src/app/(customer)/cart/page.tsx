import { CartView } from "./cart-view";
import { getLoyaltyState } from "@/lib/data/cart-actions";

export default async function CartPage() {
  const loyalty = await getLoyaltyState();

  // The whole state, not just the balance: the redemption control needs the
  // minimum and the point value to explain itself, and reading them from two
  // places is how the cart and checkout came to disagree about the minimum.
  return (
    <CartView
      balance={loyalty.balance}
      minRedeem={loyalty.minRedeem}
      pointValue={loyalty.pointValue}
    />
  );
}