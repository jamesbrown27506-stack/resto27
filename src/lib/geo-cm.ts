/**
 * Cameroon geography helpers.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY THIS EXISTS.
 *
 *  `Restaurant` JSON-LD was emitting the *quartier* in `addressRegion`:
 *
 *      "addressLocality": "Douala", "addressRegion": "ndogbong"
 *
 *  Ndogbong is a neighbourhood, not a region — the region is Littoral. That
 *  is a factual error in structured data, not merely a missing field, and it
 *  would contradict any Google Business Profile the restaurant later claims
 *  (which will correctly say Littoral). Entity consistency across the site,
 *  GBP and Maps is the thing local ranking actually rests on, so a mismatch
 *  here is worth more than the field itself.
 *
 *  Quartiers are also stored as the operator typed them ("ndogbong"), and
 *  that raw value reaches page titles — "Mami Chop — ndogbong, Douala".
 * ─────────────────────────────────────────────────────────────────────────
 */

/**
 * Every city the marketplace serves today is in Littoral.
 *
 * Kept as a lookup rather than a constant so that adding Yaoundé (Centre) or
 * Bafoussam (Ouest) later is a one-line change here instead of a hunt through
 * the schema builders.
 */
const CITY_TO_REGION: Record<string, string> = {
  douala: "Littoral",
  yaounde: "Centre",
  yaoundé: "Centre",
  bafoussam: "Ouest",
  bamenda: "Nord-Ouest",
  garoua: "Nord",
  buea: "Sud-Ouest",
};

/** The administrative region for a city, or null when we do not know it. */
export function regionForCity(city: string | null | undefined): string | null {
  if (!city) return null;
  return CITY_TO_REGION[city.trim().toLowerCase()] ?? null;
}

/**
 * Display form for a quartier: "ndogbong" -> "Ndogbong", "bonaMoussadi" -> "Bonamoussadi".
 *
 * Title-cases each hyphen- or space-separated part. Deliberately conservative:
 * it only changes casing, never spelling, so an operator's unusual but correct
 * name survives intact.
 */
export function formatQuartier(quartier: string | null | undefined): string {
  if (!quartier) return "";
  return quartier
    .trim()
    .split(/(\s+|-)/)
    .map(part => (/^[\s-]+$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()))
    .join("");
}

/**
 * The `streetAddress` for schema: the operator's address line plus the
 * quartier, which is how an address is actually given in Douala ("Carrefour
 * Bifaga, Ndogbong"). Either half may be missing.
 */
export function composeStreetAddress(
  addressLine: string | null | undefined,
  quartier: string | null | undefined,
): string | undefined {
  const parts = [addressLine?.trim(), formatQuartier(quartier)].filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
}
