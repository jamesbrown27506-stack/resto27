"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireRole, superAdminOrError } from "@/lib/auth/session";
import { writeAudit } from "./platform-actions";
import { gatewayRange, type GatewayId } from "@/lib/payments/gateway";
import {
  saspayCameroonBalance,
  saspayCameroonRates,
  saspayConfigured,
  saspayKeyEnvironment,
  type SaspayNetworkRate,
} from "@/lib/payments/saspay/client";
import type { ActionResult } from "./admin-actions";

/**
 * Payments → Gateways (admin). Reading is open to every admin; switching a
 * gateway is super-admin only (0063) — it decides who holds the platform's
 * money in flight.
 */

export interface GatewayStatus {
  collect: GatewayId;
  payout: GatewayId;
  saspay: {
    configured: boolean;
    environment: "live" | "test" | null;
    webhookSecretSet: boolean;
    rates: SaspayNetworkRate[] | null;
    ratesError: string | null;
    balance: { available: number; pending: number; frozen: boolean } | null;
    balanceError: string | null;
  };
  ranges: Record<GatewayId, { min: number; max: number }>;
}

export async function getGatewayStatus(): Promise<GatewayStatus> {
  await requireRole("admin");
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("settings")
    .select("key, value")
    .in("key", ["payment_provider_collect", "payment_provider_payout"]);
  const map = new Map(((data ?? []) as { key: string; value: string | null }[]).map((r) => [r.key, r.value]));
  const as = (v: string | null | undefined): GatewayId => (v === "saspay" ? "saspay" : "camerpay");

  const configured = saspayConfigured();
  let rates: SaspayNetworkRate[] | null = null;
  let ratesError: string | null = null;
  let balance: GatewayStatus["saspay"]["balance"] = null;
  let balanceError: string | null = null;
  if (configured) {
    const [r, b] = await Promise.allSettled([saspayCameroonRates(), saspayCameroonBalance()]);
    if (r.status === "fulfilled") {
      if (r.value.ok) rates = r.value.data;
      else ratesError = `${r.value.error.code}: ${r.value.error.message}`;
    } else ratesError = String(r.reason);
    if (b.status === "fulfilled") {
      if (b.value.ok) balance = b.value.data;
      else balanceError = `${b.value.error.code}: ${b.value.error.message}`;
    } else balanceError = String(b.reason);
  }

  return {
    collect: as(map.get("payment_provider_collect")),
    payout: as(map.get("payment_provider_payout")),
    saspay: {
      configured,
      environment: saspayKeyEnvironment(),
      webhookSecretSet: Boolean(process.env.SASPAY_WEBHOOK_SECRET?.trim()),
      rates,
      ratesError,
      balance,
      balanceError,
    },
    ranges: { camerpay: gatewayRange("camerpay"), saspay: gatewayRange("saspay") },
  };
}

export async function setPaymentGateway(
  direction: "collect" | "payout",
  gateway: GatewayId,
): Promise<ActionResult> {
  const gate = await superAdminOrError();
  if (!gate.ok) return gate;
  if (gateway !== "camerpay" && gateway !== "saspay") return { ok: false, error: "Unknown gateway." };
  if (gateway === "saspay" && !saspayConfigured()) {
    return { ok: false, error: "Add SASPAY_API_KEY to the server environment and redeploy before switching to SasPay." };
  }
  if (gateway === "saspay" && direction === "collect" && !process.env.SASPAY_WEBHOOK_SECRET?.trim()) {
    return {
      ok: false,
      error: "Add SASPAY_WEBHOOK_SECRET (the signing secret of your SasPay webhook) first — without it payment confirmations can only arrive through the reconciler.",
    };
  }

  const key = direction === "collect" ? "payment_provider_collect" : "payment_provider_payout";
  const supabase = createAdminClient();
  const { data: updated, error } = await supabase
    .from("settings")
    .update({ value: gateway })
    .eq("key", key)
    .select("key")
    .maybeSingle();
  if (error || !updated) {
    return {
      ok: false,
      error: error ? `Could not save: ${error.message}` : "Run migration 0063 in the Supabase SQL editor first.",
    };
  }

  await writeAudit(gate.admin, {
    action: "settings.payment_gateway",
    entityType: "settings",
    summary: `${direction === "collect" ? "Collections" : "Payouts"} now go through ${gateway}`,
    metadata: { key, value: gateway },
  });
  revalidatePath("/a/payments");
  return { ok: true };
}
