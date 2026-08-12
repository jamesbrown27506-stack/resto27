import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * The commercial dials the basket needs, read from `settings`.
 *
 * The service charge and the loyalty rates are numbers an administrator
 * changes; a basket that hardcodes 5 % shows one figure while the order the
 * server writes uses another, and the customer notices at exactly the wrong
 * moment.
 *
 * Handed to <CartProvider> by the root layout rather than fetched from the
 * client. A provider that fetched its own config would render every total
 * twice — once wrong, once right — on every page load.
 */
export interface CartConfig {
  serviceChargePercent: number;
  loyaltyEnabled: boolean;
  /** Points earned per 1 000 XAF of food. */
  pointsPer1000: number;
  /** Francs knocked off per point spent. */
  pointValue: number;
  /** Below this, points cannot be spent at all. */
  minRedeem: number;
}

export const CART_CONFIG_FALLBACK: CartConfig = {
  serviceChargePercent: 5,
  loyaltyEnabled: false,
  pointsPer1000: 0,
  pointValue: 0,
  minRedeem: 0,
};

/** Settings values are text; a missing or unparseable row falls back. */
function num(map: Map<string, string>, key: string, fallback: number): number {
  const raw = map.get(key);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const getCartConfig = cache(async (): Promise<CartConfig> => {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("settings")
    .select("key, value")
    .in("key", [
      "service_charge_percent",
      "loyalty_enabled",
      "loyalty_points_per_1000",
      "loyalty_point_value",
      "loyalty_min_redeem",
    ]);

  if (error) {
    // Never throw: the basket is on every page through the header badge, and
    // a settings outage must not take the whole site down with it.
    console.error("[cart:getCartConfig]", error.message);
    return CART_CONFIG_FALLBACK;
  }

  const map = new Map(((data ?? []) as { key: string; value: string | null }[]).map((r) => [r.key, r.value ?? ""]));

  return {
    serviceChargePercent: num(map, "service_charge_percent", 5),
    // Loyalty stays OFF unless the row says otherwise. Defaulting a rewards
    // scheme on would have the site promising points it never awards until
    // 0013 has been run.
    loyaltyEnabled: map.get("loyalty_enabled") === "true",
    pointsPer1000: num(map, "loyalty_points_per_1000", 0),
    pointValue: num(map, "loyalty_point_value", 0),
    minRedeem: num(map, "loyalty_min_redeem", 0),
  };
});
