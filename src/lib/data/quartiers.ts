import "server-only";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * THE ONE PLACE A NEIGHBOURHOOD BECOMES A ROW.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY A TYPED NAME IS ACCEPTED AT ALL.
 *
 *  A closed list is wrong for Douala. The seeded quartiers are the well-known
 *  few; someone in a quartier we never listed either abandons the form or
 *  picks the nearest wrong answer — which then shows on their public page and
 *  misroutes every delivery they ever take. So every field that asks for a
 *  quartier is a DATALIST: suggestions, not a cage.
 *
 *  WHY THE NEW NAME IS ACTIVE.
 *
 *  It used to be created `is_active = false`, waiting for an admin to promote
 *  it from /a/areas. That is defensible in theory and useless in practice: the
 *  next applicant from the same street was offered the same empty list and
 *  typed the same name again — often spelled differently — so the one thing
 *  the list existed to prevent (three spellings of one neighbourhood) is
 *  exactly what it produced. A name someone typed is now immediately a
 *  suggestion for the next person, which is what makes the list converge.
 *
 *  The cost is that a typo can reach the suggestions. That is recoverable: an
 *  admin renames or deactivates it from /a/areas, and the signup path is rate
 *  limited to five applications per IP per hour. Three spellings of Bonapriso
 *  scattered across the restaurant table is not recoverable in the same way.
 *
 *  MATCHING IS CASE-INSENSITIVE, and that is load-bearing. `unique
 *  (service_area_id, name)` is case-SENSITIVE, so an exact-match lookup lets
 *  "Akwa" and "akwa" both be created — two rows, one neighbourhood, and every
 *  filter that groups by quartier silently splits in half.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** Trim and collapse inner whitespace, so "Akwa  Nord" and "Akwa Nord" agree. */
function normalise(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/**
 * Find a quartier by name within one service area, creating it if it is new.
 *
 * Returns null only when the name is empty or the write genuinely failed —
 * callers treat that as "could not resolve" and surface their own message.
 */
export async function resolveOrCreateQuartier(
  name: string,
  serviceAreaId: string,
): Promise<string | null> {
  const clean = normalise(name);
  if (!clean) return null;

  const supabase = createAdminClient();

  // `ilike` with no wildcards is an exact, case-insensitive compare — which is
  // what stops "Akwa" and "akwa" becoming two neighbourhoods.
  const { data: existing } = await supabase
    .from("quartiers")
    .select("id")
    .eq("service_area_id", serviceAreaId)
    .ilike("name", clean)
    .maybeSingle();

  if (existing?.id) return existing.id as string;

  const { data: created, error } = await supabase
    .from("quartiers")
    // sort_order 999 keeps freshly typed names BELOW the curated ones in every
    // list that orders by it — the seeded quartiers stay the first suggestions.
    .insert({ service_area_id: serviceAreaId, name: clean, is_active: true, sort_order: 999 })
    .select("id")
    .single();

  if (error) {
    /*
      23505 is the unique violation, and it is expected under a race: two
      people submitting the same new quartier within milliseconds both miss
      the SELECT and both INSERT. The loser re-reads rather than failing —
      the row it wanted now exists, which is the outcome it asked for.
    */
    if (error.code === "23505") {
      const { data: raced } = await supabase
        .from("quartiers")
        .select("id")
        .eq("service_area_id", serviceAreaId)
        .ilike("name", clean)
        .maybeSingle();
      return (raced?.id as string) ?? null;
    }

    console.error("[quartiers:resolveOrCreate]", error.message);
    return null;
  }

  return (created?.id as string) ?? null;
}

/**
 * The service area a customer-side form belongs to.
 *
 * Customer addresses and checkout carry no city selector — the platform runs
 * one town at a time — so the area is resolved here rather than asked for.
 * Prefers an area still open for signups, falling back to the first one, so a
 * single-city deployment always resolves.
 */
export async function defaultServiceAreaId(): Promise<string | null> {
  const supabase = createAdminClient();

  const { data } = await supabase
    .from("service_areas")
    .select("id, accepting_signups")
    .order("accepting_signups", { ascending: false })
    .order("city")
    .limit(1)
    .maybeSingle();

  return (data?.id as string) ?? null;
}
