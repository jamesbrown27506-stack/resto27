import { CheckoutClient } from "./checkout-client";
import { orderScheduleMaxDays } from "@/lib/data/booking-rules";
import { getActiveProfile } from "@/lib/auth/session";
import { fetchCustomerAddresses, fetchCustomerWalletSummary } from "@/lib/data/customer";
import { fetchQuartierNames } from "@/lib/data/public";

export default async function CheckoutPage() {
  const [auth, quartiers] = await Promise.all([getActiveProfile(), fetchQuartierNames()]);

  const profile = auth.profile ?? null;
  const [addresses, wallet] = profile
    ? await Promise.all([fetchCustomerAddresses(profile.id), fetchCustomerWalletSummary(profile.id)])
    : [[], { balance: 0, available: false }];

  // How far ahead a delivery or pickup may be scheduled — the admin's setting (0068).
  const scheduleMaxDays = await orderScheduleMaxDays();

  return <CheckoutClient user={profile} addresses={addresses} quartiers={quartiers} wallet={wallet} scheduleMaxDays={scheduleMaxDays} />;
}