import "server-only";
import { cache } from "react";
import { getSettingsMap } from "@/lib/settings-map";

/**
 * The platform's own identity — name, tagline, logo, favicon.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  ONE READ, ONE SOURCE, EVERY SURFACE.
 *
 *  Before this existed, "Resto237" was a string literal in the header, the
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
  /** The PWA/home-screen icon (migration 0021), or null for the default. */
  iconUrl: string | null;
  supportEmail: string;
  supportPhone: string | null;
  supportAddress: string | null;
  /**
   * The site's colour palette (admin: Appearance → Palette). "classic" is the
   * original sage; "ndole" is the appetite palette in globals.css.
   */
  palette: ColorPalette;
}

export type ColorPalette = "classic" | "ndole";
export const COLOR_PALETTES: readonly ColorPalette[] = ["classic", "ndole"];

/**
 * What ships before an administrator has set anything.
 *
 * Deliberately a real, usable identity rather than empty strings: a fresh
 * install should look finished, not broken.
 */
export const DEFAULT_BRANDING: Branding = {
  name: "Resto237",
  tagline: "Commandez vos plats préférés à Douala",
  logoUrl: null,
  faviconUrl: null,
  iconUrl: null,
  supportEmail: "contact@resto237.online",
  supportPhone: null,
  supportAddress: "Douala, Cameroun",
  palette: "classic",
};

/**
 * Reads through the SHARED settings map rather than querying on its own.
 *
 * This used to issue its own `select … in (brand_*)`, as did appearance and
 * the cart config — three round trips to one 2.2 KB table on every page in
 * the platform, none of them able to see the other two. `getSettingsMap` is
 * itself `cache()`d, so all three now resolve from a single read.
 *
 * Failing open is unchanged: a settings outage yields an empty map here and
 * every field below falls back to its default, which is exactly what a
 * missing row already did.
 */
export const getBranding = cache(async (): Promise<Branding> => {
  const map = await getSettingsMap();

  // `|| default`, not `?? default`: an administrator who clears the field is
  // asking for the default back, and an empty brand name renders as a blank
  // header.
  return {
    name: map.get("brand_name")?.trim() || DEFAULT_BRANDING.name,
    tagline: map.get("brand_tagline")?.trim() || DEFAULT_BRANDING.tagline,
    logoUrl: map.get("brand_logo_url")?.trim() || null,
    faviconUrl: map.get("brand_favicon_url")?.trim() || null,
    iconUrl: map.get("brand_icon_url")?.trim() || null,
    supportEmail: map.get("support_email")?.trim() || DEFAULT_BRANDING.supportEmail,
    supportPhone: map.get("support_phone")?.trim() || null,
    supportAddress: map.get("support_address")?.trim() || null,
    palette: map.get("color_palette")?.trim() === "ndole" ? "ndole" : "classic",
  };
});
