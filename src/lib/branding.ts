import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * The platform's own identity — name, tagline, logo, favicon.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  ONE READ, ONE SOURCE, EVERY SURFACE.
 *
 *  Before this existed, "RestoLink" was a string literal in the header, the
 *  footer, the auth shell, the sidebar and four `metadata` blocks. Changing
 *  the platform name in /a/settings wrote a row nothing ever read, so the
 *  setting appeared to do nothing — which is worse than not offering it.
 *
 *  Every one of those places now calls this. `cache()` dedupes within a
 *  request, so a page rendering the header, the footer and its own metadata
 *  hits the database once.
 * ─────────────────────────────────────────────────────────────────────────
 */

export interface Branding {
  name: string;
  tagline: string;
  /** Absolute or site-relative URL, or null to fall back to the wordmark. */
  logoUrl: string | null;
  faviconUrl: string | null;
  supportEmail: string;
}

/**
 * What ships before an administrator has set anything.
 *
 * Deliberately a real, usable identity rather than empty strings: a fresh
 * install should look finished, not broken.
 */
export const DEFAULT_BRANDING: Branding = {
  name: "RestoLink",
  tagline: "Commandez vos plats préférés au Cameroun",
  logoUrl: null,
  faviconUrl: null,
  supportEmail: "contact@restolink.cm",
};

const KEYS = [
  "brand_name",
  "brand_tagline",
  "brand_logo_url",
  "brand_favicon_url",
  "support_email",
] as const;

export const getBranding = cache(async (): Promise<Branding> => {
  const supabase = createAdminClient();

  const { data, error } = await supabase.from("settings").select("key, value").in("key", KEYS);

  if (error) {
    /**
     * FAIL OPEN, and loudly in the log.
     *
     * A settings outage must not take down every page on the platform. The
     * defaults render a working site; the error tells whoever is on call why
     * the logo vanished.
     */
    console.error("[branding] falling back to defaults —", error.message);
    return DEFAULT_BRANDING;
  }

  const map = new Map(
    ((data ?? []) as { key: string; value: string | null }[]).map((r) => [r.key, r.value?.trim() ?? ""]),
  );

  // `|| default`, not `?? default`: an administrator who clears the field is
  // asking for the default back, and an empty brand name renders as a blank
  // header.
  return {
    name: map.get("brand_name") || DEFAULT_BRANDING.name,
    tagline: map.get("brand_tagline") || DEFAULT_BRANDING.tagline,
    logoUrl: map.get("brand_logo_url") || null,
    faviconUrl: map.get("brand_favicon_url") || null,
    supportEmail: map.get("support_email") || DEFAULT_BRANDING.supportEmail,
  };
});
