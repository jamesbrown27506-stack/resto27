import { AddressesClient } from "./addresses-client";
import { requireUser } from "@/lib/auth/session";
import { fetchCustomerAddresses } from "@/lib/data/customer";
import { fetchQuartierNames } from "@/lib/data/public";

export default async function AddressesPage() {
  const user = await requireUser();

  const [addresses, quartiers] = await Promise.all([
    fetchCustomerAddresses(user.id),
    fetchQuartierNames(),
  ]);

  return <AddressesClient user={user} initial={addresses} quartiers={quartiers} />;
}