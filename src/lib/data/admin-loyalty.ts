import "server-only";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { readCamerPayBalance } from "@/lib/payments/camerpay/balance";
import { paymentMode } from "@/lib/data/billing";
import { payoutGateway } from "@/lib/payments/gateway";
import type { LoyaltySummary } from "@/lib/loyalty/reserve";

const amount = z.number().int().nonnegative().safe();
const summarySchema = z.object({
  pointValue: amount, outstandingPoints: amount, outstandingValue: amount,
  customersWithPoints: amount, negativeBalances: amount, pendingRedemptionValue: amount,
  fundedValue: amount, reversedValue: amount, restaurantBalances: amount, customerBalances: amount,
  pendingRefunds: amount, pendingWithdrawals: amount, unconfirmedPayouts: amount,
});

export interface LoyaltyFundingRow {
  id: string; reference: string; restaurantName: string; points: number; amount: number;
  status: "credited" | "reversed"; creditedAt: string;
}

export async function getAdminLoyalty(): Promise<{
  summary: LoyaltySummary | null; recent: LoyaltyFundingRow[]; balance: number | null;
  checkedAt: string; mode: "live" | "sandbox"; payoutProvider: "camerpay" | "saspay";
}> {
  await requireRole("admin");
  const db = createAdminClient();
  const [totals, funding, balance, mode, payoutProvider] = await Promise.all([
    db.rpc("admin_loyalty_summary"),
    db.from("loyalty_funding").select("id, reference, points, amount, status, credited_at, restaurants(name)")
      .order("credited_at", { ascending: false }).order("id", { ascending: false }).limit(25),
    readCamerPayBalance(), paymentMode(), payoutGateway(),
  ]);
  const parsed = summarySchema.safeParse(totals.data);
  const ready = !totals.error && !funding.error && parsed.success;
  if (!ready) console.error("[admin:loyalty] summary unavailable", totals.error?.code ?? funding.error?.code ?? "invalid_totals");
  const recent = ready ? (funding.data ?? []).map((row) => {
    const restaurant = Array.isArray(row.restaurants) ? row.restaurants[0] : row.restaurants;
    return { id: String(row.id), reference: String(row.reference), points: Number(row.points), amount: Number(row.amount),
      status: row.status as "credited" | "reversed", creditedAt: String(row.credited_at), restaurantName: restaurant?.name ?? "Removed restaurant" };
  }) : [];
  return { summary: ready && parsed.success ? parsed.data : null, recent, balance, checkedAt: new Date().toISOString(), mode, payoutProvider };
}
