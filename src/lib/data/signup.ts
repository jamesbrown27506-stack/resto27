import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * The town and neighbourhood lists shown on the restaurant application.
 *
 * Both are read with the ordinary (anon) client, not the admin one: an
 * applicant is by definition not signed in, and both tables carry public
 * SELECT policies for exactly this. Reaching for the service-role key on a
 * public form would be a habit worth not forming.
 */

export interface SignupArea {
  id: string;
  city: string;
  /** Known neighbourhoods, offered as suggestions — never as a closed list. */
  quartiers: string[];
}

/**
 * Only areas that are OPEN FOR SIGNUPS.
 *
 * `accepting_signups` defaults to false, so a city an admin has created but
 * not yet launched cannot receive applications it has no one to approve. If
 * the list comes back empty the form says so plainly rather than presenting a
 * town selector with nothing in it.
 */
export async function fetchSignupAreas(): Promise<SignupArea[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("service_areas")
    .select("id, city, quartiers(name, sort_order, is_active)")
    .eq("accepting_signups", true)
    .order("city");

  if (error) {
    console.error("[signup:fetchSignupAreas]", error.message);
    return [];
  }

  return (data ?? []).map((area) => {
    const rows = (area.quartiers ?? []) as { name: string; sort_order: number; is_active: boolean }[];

    return {
      id: area.id as string,
      city: area.city as string,
      // Sorted here rather than in the query: PostgREST cannot order an
      // embedded resource independently of its parent, and the lists are a
      // few dozen rows at most.
      quartiers: rows
        .filter((q) => q.is_active)
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
        .map((q) => q.name),
    };
  });
}
