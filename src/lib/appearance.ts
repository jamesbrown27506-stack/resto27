import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * The pictures on the landing page.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  DEFAULTS ARE REAL PHOTOGRAPHS, NOT EMPTY STRINGS.
 *
 *  These seven URLs were hardcoded across hero-art.tsx and home-content.tsx.
 *  Moving them into `settings` makes them choosable — but a fresh install with
 *  nothing configured must still look finished, so an unset row falls back to
 *  the photograph that was previously compiled in. Same rule `brand_name`
 *  follows, and for the same reason: a half-configured platform should never
 *  render as a broken one.
 *
 *  The defaults are Unsplash URLs and are allow-listed in next.config.ts
 *  alongside the Supabase CDN, so BOTH resolve through next/image.
 * ─────────────────────────────────────────────────────────────────────────
 */

export interface Appearance {
  heroOrder: string;
  heroBook: string;
  heroExplore: string;
  homeDishes: string;
  homeKitchen: string;
  homeBranches: string;
  homePayment: string;
}

/** Every key an administrator can set, paired with what ships without one. */
export const APPEARANCE_IMAGES = [
  {
    key: "hero_order_image",
    field: "heroOrder",
    default:
      "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=1200&q=80",
  },
  {
    key: "hero_book_image",
    field: "heroBook",
    default:
      "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=1200&q=80",
  },
  {
    key: "hero_explore_image",
    field: "heroExplore",
    default:
      "https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?auto=format&fit=crop&w=1200&q=80",
  },
  {
    key: "home_dishes_image",
    field: "homeDishes",
    default:
      "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=1600&q=80",
  },
  {
    key: "home_kitchen_image",
    field: "homeKitchen",
    default:
      "https://images.unsplash.com/photo-1556910103-1c02745aae4d?auto=format&fit=crop&w=1200&q=80",
  },
  {
    key: "home_branches_image",
    field: "homeBranches",
    default:
      "https://images.unsplash.com/photo-1552566626-52f8b828add9?auto=format&fit=crop&w=1200&q=80",
  },
  {
    key: "home_payment_image",
    field: "homePayment",
    default:
      "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&w=1200&q=80",
  },
] as const satisfies readonly {
  key: string;
  field: keyof Appearance;
  default: string;
}[];

export type AppearanceKey = (typeof APPEARANCE_IMAGES)[number]["key"];

/**
 * Built by hand rather than folded out of the list above.
 *
 * `Object.fromEntries` widens its key type to `string`, so the result is not
 * an `Appearance` and only a cast makes it one — which is precisely the cast
 * that would stop the compiler noticing a field added to the interface and
 * forgotten here.
 */
export const DEFAULT_APPEARANCE: Appearance = {
  heroOrder: APPEARANCE_IMAGES[0].default,
  heroBook: APPEARANCE_IMAGES[1].default,
  heroExplore: APPEARANCE_IMAGES[2].default,
  homeDishes: APPEARANCE_IMAGES[3].default,
  homeKitchen: APPEARANCE_IMAGES[4].default,
  homeBranches: APPEARANCE_IMAGES[5].default,
  homePayment: APPEARANCE_IMAGES[6].default,
};

export const getAppearance = cache(async (): Promise<Appearance> => {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("settings")
    .select("key, value")
    .in(
      "key",
      APPEARANCE_IMAGES.map((image) => image.key),
    );

  if (error) {
    // Fail open, loudly. A settings outage must not blank the homepage.
    console.error("[appearance] falling back to defaults —", error.message);
    return DEFAULT_APPEARANCE;
  }

  const map = new Map(
    ((data ?? []) as { key: string; value: string | null }[]).map((r) => [r.key, r.value?.trim() ?? ""]),
  );

  // `|| fallback`, not `?? fallback`: an administrator who clears the field is
  // asking for the shipped photograph back, not for an empty <img>.
  const pick = (key: AppearanceKey, fallback: string) => map.get(key) || fallback;

  return {
    heroOrder: pick("hero_order_image", DEFAULT_APPEARANCE.heroOrder),
    heroBook: pick("hero_book_image", DEFAULT_APPEARANCE.heroBook),
    heroExplore: pick("hero_explore_image", DEFAULT_APPEARANCE.heroExplore),
    homeDishes: pick("home_dishes_image", DEFAULT_APPEARANCE.homeDishes),
    homeKitchen: pick("home_kitchen_image", DEFAULT_APPEARANCE.homeKitchen),
    homeBranches: pick("home_branches_image", DEFAULT_APPEARANCE.homeBranches),
    homePayment: pick("home_payment_image", DEFAULT_APPEARANCE.homePayment),
  };
});
