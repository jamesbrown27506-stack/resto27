import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import { getActiveProfile } from "@/lib/auth/session";
import { can, type BranchRole } from "@/lib/capabilities";
import { diningFeatureAllowed } from "@/lib/dining/access";
import {
  isVoucherCode,
  normaliseVoucherCode,
  voucherCredit,
  voucherState,
  voucherWindow,
  type VoucherState,
} from "@/lib/reservations/voucher";

/**
 * What /v/<code> shows, decided by WHO is looking (0068).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  A voucher is a QR on a phone screen; anyone who sees it can scan it. So:
 *
 *    · staff of THAT restaurant  → the booking (name, party, time, deposit)
 *                                  and the Redeem button;
 *    · the customer who booked   → their voucher, full size, with the QR;
 *    · anyone else               → the restaurant and "valid" / "not valid".
 *
 *  Nothing on the anonymous view names the guest or their phone, and staff
 *  of another restaurant are "anyone else" — membership is checked against
 *  THIS booking's restaurant, not the viewer's active branch.
 * ─────────────────────────────────────────────────────────────────────────
 */

export interface VoucherBooking {
  id: string;
  code: string;
  reference: string;
  restaurantId: string;
  restaurantName: string;
  restaurantSlug: string;
  guestName: string;
  partySize: number;
  reservedFor: string;
  durationMin: number;
  status: string;
  occasion: string | null;
  depositAmount: number;
  depositPaid: boolean;
  depositPercent: number;
  credit: number;
  redeemedAt: string | null;
  tableNumbers: string[];
  state: VoucherState;
  opensAt: string;
  closesAt: string;
}

export type VoucherView =
  | { kind: "notFound" }
  | { kind: "public"; code: string; restaurantName: string; state: VoucherState }
  | { kind: "owner"; booking: VoucherBooking }
  | {
      kind: "staff";
      booking: VoucherBooking;
      canRedeem: boolean;
      /** Enterprise table service: the bill can be opened or picked on redeem. */
      tableService: boolean;
      openBills: { id: string; label: string | null; tableNumber: string | null }[];
      tables: { id: string; number: string; capacity: number }[];
    };

export async function getVoucherView(rawCode: string): Promise<VoucherView> {
  const code = normaliseVoucherCode(rawCode);
  if (!isVoucherCode(code)) return { kind: "notFound" };
  const db = createAdminClient();
  const { data, error } = await db
    .from("reservations")
    .select(
      `id, reference, restaurant_id, customer_id, guest_name, party_size, reserved_for, duration_min, status,
       occasion, deposit_amount, deposit_paid, deposit_percent, voucher_code, voucher_redeemed_at, table_id,
       restaurants ( name, slug )`,
    )
    .eq("voucher_code", code)
    .maybeSingle();
  if (error) console.error("[voucher:view]", error.code ?? "", error.message);
  if (!data) return { kind: "notFound" };

  const row = data as unknown as {
    id: string; reference: string; restaurant_id: string; customer_id: string | null; guest_name: string;
    party_size: number; reserved_for: string; duration_min: number; status: string; occasion: string | null;
    deposit_amount: number; deposit_paid: boolean; deposit_percent: number | null; voucher_code: string;
    voucher_redeemed_at: string | null; table_id: string | null;
    restaurants: { name: string; slug: string } | { name: string; slug: string }[] | null;
  };
  const restaurant = Array.isArray(row.restaurants) ? row.restaurants[0] : row.restaurants;
  const state = voucherState({
    status: row.status,
    reservedFor: row.reserved_for,
    redeemedAt: row.voucher_redeemed_at,
    depositPaid: Boolean(row.deposit_paid),
  });

  const session = await getActiveProfile();
  const viewer = session.profile ?? null;

  let staffRole: BranchRole | null = null;
  if (viewer) {
    const { data: staff } = await db
      .from("restaurant_staff")
      .select("role")
      .eq("restaurant_id", row.restaurant_id)
      .eq("profile_id", viewer.id)
      .eq("status", "active")
      .maybeSingle();
    staffRole = ((staff as { role?: BranchRole } | null)?.role ?? null) as BranchRole | null;
  }
  const isOwner = Boolean(viewer && row.customer_id && viewer.id === row.customer_id);

  if (!staffRole && !isOwner) {
    return { kind: "public", code, restaurantName: restaurant?.name ?? "", state };
  }

  const { data: links } = await db
    .from("reservation_tables")
    .select("restaurant_tables ( number )")
    .eq("reservation_id", row.id);
  const tableNumbers = ((links ?? []) as { restaurant_tables: { number: string } | { number: string }[] | null }[])
    .map((link) => (Array.isArray(link.restaurant_tables) ? link.restaurant_tables[0] : link.restaurant_tables)?.number)
    .filter((n): n is string => Boolean(n));

  const { opensAt, closesAt } = voucherWindow(row.reserved_for);
  const booking: VoucherBooking = {
    id: row.id,
    code,
    reference: row.reference,
    restaurantId: row.restaurant_id,
    restaurantName: restaurant?.name ?? "",
    restaurantSlug: restaurant?.slug ?? "",
    guestName: row.guest_name,
    partySize: row.party_size,
    reservedFor: row.reserved_for,
    durationMin: row.duration_min,
    status: row.status,
    occasion: row.occasion,
    depositAmount: Number(row.deposit_amount ?? 0),
    depositPaid: Boolean(row.deposit_paid),
    depositPercent: Number(row.deposit_percent ?? 0),
    credit: voucherCredit({
      depositPaid: Boolean(row.deposit_paid),
      depositAmount: Number(row.deposit_amount ?? 0),
      depositPercent: Number(row.deposit_percent ?? 0),
    }),
    redeemedAt: row.voucher_redeemed_at,
    tableNumbers,
    state,
    opensAt: opensAt.toISOString(),
    closesAt: closesAt.toISOString(),
  };

  if (!staffRole) return { kind: "owner", booking };

  const tableService = await restaurantHasTableService(row.restaurant_id);
  const [bills, tables] = tableService
    ? await Promise.all([
        db.from("dining_sessions")
          .select("id, label, restaurant_tables ( number )")
          .eq("restaurant_id", row.restaurant_id)
          .in("status", ["awaiting_staff", "open"])
          .order("created_at"),
        db.from("restaurant_tables")
          .select("id, number, capacity, status")
          .eq("restaurant_id", row.restaurant_id)
          .neq("status", "out_of_service")
          .order("number"),
      ])
    : [{ data: [] }, { data: [] }];

  return {
    kind: "staff",
    booking,
    canRedeem: can(staffRole, "reservations.seat"),
    tableService,
    openBills: ((bills.data ?? []) as { id: string; label: string | null; restaurant_tables: { number: string } | { number: string }[] | null }[])
      .map((bill) => ({
        id: bill.id,
        label: bill.label,
        tableNumber: (Array.isArray(bill.restaurant_tables) ? bill.restaurant_tables[0] : bill.restaurant_tables)?.number ?? null,
      })),
    tables: ((tables.data ?? []) as { id: string; number: string; capacity: number }[])
      .map((table) => ({ id: table.id, number: table.number, capacity: table.capacity })),
  };
}

async function restaurantHasTableService(restaurantId: string): Promise<boolean> {
  const db = createAdminClient();
  const { data } = await db.from("subscription_state").select("plan_id, state").eq("restaurant_id", restaurantId).maybeSingle();
  if (!data?.plan_id) return false;
  const { data: plan } = await db.from("subscription_plans").select("tier").eq("id", data.plan_id).maybeSingle();
  return diningFeatureAllowed(plan?.tier ?? "", data.state);
}
