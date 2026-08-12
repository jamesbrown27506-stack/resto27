"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/session";
import { getCartConfig } from "@/lib/orders/cart-config";
import { discountFor, type PromoErrorReason } from "@/lib/orders/promotions";

/**
 * What the basket needs from the server before checkout.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  A PROMOTION IS VALIDATED HERE, NOT IN THE BROWSER.
 *
 *  The old provider matched the typed code against a PROMOTIONS array
 *  compiled into the bundle — so every code, its percentage and its minimum
 *  were readable by anyone who opened devtools, and inventing one was a
 *  matter of editing a variable.
 *
 *  This returns the DISCOUNT IN FRANCS rather than the promotion, so the
 *  client never learns the rule, only the outcome. `placeOrder` re-runs the
 *  whole check anyway — this exists to fail fast on screen, not to be trusted.
 * ─────────────────────────────────────────────────────────────────────────
 */

export type PromoResult =
  | { ok: true; code: string; discount: number; label: string }
  /** A reason CODE, translated by the client — the basket is bilingual. */
  | { ok: false; reason: PromoErrorReason; minimum?: number };

export async function validatePromoCode(input: {
  code: string;
  restaurantId: string;
  subtotal: number;
}): Promise<PromoResult> {
  const code = input.code.trim().toUpperCase();
  if (!code) return { ok: false, reason: "unknown" };

  const supabase = createAdminClient();

  // Scoped to the restaurant: a code is one restaurant's offer, and letting it
  // resolve across tenants would spend one kitchen's margin at another.
  const { data, error } = await supabase
    .from("promotions")
    .select("code, label, discount_type, discount_value, min_order, max_discount, starts_at, ends_at, usage_limit, used_count, is_active")
    .eq("restaurant_id", input.restaurantId)
    .eq("code", code)
    .maybeSingle();

  if (error) {
    console.error("[cart:validatePromoCode]", error.message);
    return { ok: false, reason: "failed" };
  }
  if (!data) return { ok: false, reason: "unknown" };

  const promo = data as {
    code: string;
    label: string | null;
    discount_type: string;
    discount_value: number;
    min_order: number | null;
    max_discount: number | null;
    starts_at: string | null;
    ends_at: string | null;
    usage_limit: number | null;
    used_count: number;
    is_active: boolean;
  };

  if (!promo.is_active) return { ok: false, reason: "inactive" };

  const now = Date.now();
  if (promo.starts_at && now < new Date(promo.starts_at).getTime()) {
    return { ok: false, reason: "notStarted" };
  }
  if (promo.ends_at && now > new Date(promo.ends_at).getTime()) {
    return { ok: false, reason: "expired" };
  }
  if (promo.usage_limit !== null && promo.used_count >= promo.usage_limit) {
    return { ok: false, reason: "usedUp" };
  }

  const minimum = promo.min_order ?? 0;
  if (input.subtotal < minimum) return { ok: false, reason: "minimum", minimum };

  return {
    ok: true,
    code: promo.code,
    label: promo.label ?? promo.code,
    discount: discountFor(promo, input.subtotal),
  };
}

/**
 * How many points the signed-in customer can actually spend.
 *
 * Returns zeroes for a guest rather than refusing — the basket renders for
 * everyone, and "sign in to use your points" is the page's job to say.
 */
export async function getLoyaltyState(): Promise<{
  enabled: boolean;
  balance: number;
  pointValue: number;
  minRedeem: number;
}> {
  const config = await getCartConfig();
  const profile = await getCurrentProfile();

  if (!config.loyaltyEnabled || !profile) {
    return { enabled: config.loyaltyEnabled, balance: 0, pointValue: config.pointValue, minRedeem: config.minRedeem };
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("loyalty_balance", { p_profile: profile.id });

  if (error) {
    // 0013 may not have been run yet. No points is the safe answer: it cannot
    // over-credit anyone, and the page reads as "nothing yet".
    console.error("[cart:getLoyaltyState]", error.message);
    return { enabled: config.loyaltyEnabled, balance: 0, pointValue: config.pointValue, minRedeem: config.minRedeem };
  }

  return {
    enabled: config.loyaltyEnabled,
    balance: Number(data ?? 0),
    pointValue: config.pointValue,
    minRedeem: config.minRedeem,
  };
}
