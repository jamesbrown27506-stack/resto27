import { fetchSignupAreas } from "@/lib/data/signup";
import { RestaurantSignupForm } from "./signup-form";

export const metadata = { title: "Inscrire mon restaurant" };

/**
 * Restaurant application (§14.2).
 *
 * A Server Component so the town and neighbourhood lists come from the
 * database rather than a fixture file. Everything the applicant reads lives in
 * the client form — including the "no open towns" state, which is copy like
 * any other and has to be translated like any other.
 */
export default async function RegisterRestaurantPage() {
  const areas = await fetchSignupAreas();

  return <RestaurantSignupForm areas={areas} />;
}
