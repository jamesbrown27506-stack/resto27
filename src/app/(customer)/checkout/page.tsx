import { CheckoutClient } from "./checkout-client";
import { getActiveProfile } from "@/lib/auth/session";
import { fetchCustomerAddresses } from "@/lib/data/customer";
import { fetchQuartierNames } from "@/lib/data/public";

export default async function CheckoutPage() {
  const [auth, quartiers] = await Promise.all([getActiveProfile(), fetchQuartierNames()]);

  const profile = auth.profile ?? null;
  const addresses = profile ? await fetchCustomerAddresses(profile.id) : [];

  return <CheckoutClient user={profile} addresses={addresses} quartiers={quartiers} />;
}