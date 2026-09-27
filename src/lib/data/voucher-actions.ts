"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { getActiveProfile } from "@/lib/auth/session";
import { can, type BranchRole } from "@/lib/capabilities";
import { getTranslator } from "@/lib/i18n/locale-server";
import { notify } from "@/lib/notify";
import { isVoucherCode, normaliseVoucherCode } from "@/lib/reservations/voucher";
import { voucherErrorKey } from "@/lib/reservations/voucher-errors";

/**
 * Redeem a booking voucher (0068) — from /v/<code> after scanning its QR.
 *
 * The staff member may be working another branch in their active cookie, so
 * permission is checked against THIS booking's restaurant directly; the
 * database repeats the membership test inside redeem_reservation_voucher,
 * which also locks the row so a voucher can be used exactly once.
 *
 *   · sessionId   — take the deposit off a bill already open (Enterprise);
 *   · openTableId — open a bill on that table for the party (Enterprise);
 *   · neither     — seat the booking; the page tells staff what to deduct.
 */
export async function redeemVoucher(
  rawCode: string,
  options: { sessionId?: string | null; openTableId?: string | null } = {},
): Promise<{ ok: true; credit: number; sessionId: string | null } | { ok: false; error: string }> {
  const t = await getTranslator();
  const code = normaliseVoucherCode(rawCode);
  if (!isVoucherCode(code)) return { ok: false, error: t("ons.err.voucherNotFound") };

  const session = await getActiveProfile();
  const profile = session.profile;
  if (!profile) return { ok: false, error: t("ons.err.voucherOtherRestaurant") };

  const db = createAdminClient();
  const { data: booking } = await db.from("reservations").select("restaurant_id").eq("voucher_code", code).maybeSingle();
  if (!booking) return { ok: false, error: t("ons.err.voucherNotFound") };
  const { data: staff } = await db
    .from("restaurant_staff")
    .select("role")
    .eq("restaurant_id", booking.restaurant_id)
    .eq("profile_id", profile.id)
    .eq("status", "active")
    .maybeSingle();
  const role = (staff as { role?: BranchRole } | null)?.role;
  if (!role || !can(role, "reservations.seat")) return { ok: false, error: t("ons.err.voucherOtherRestaurant") };

  const uuid = /^[0-9a-f-]{36}$/i;
  const { data, error } = await db.rpc("redeem_reservation_voucher", {
    p_code: code,
    p_staff_id: profile.id,
    p_session_id: options.sessionId && uuid.test(options.sessionId) ? options.sessionId : null,
    p_open_table_id: !options.sessionId && options.openTableId && uuid.test(options.openTableId) ? options.openTableId : null,
  });
  if (error) {
    const key = voucherErrorKey(error.message ?? "");
    if (key === "ons.err.voucherFailed") console.error("[voucher:redeem]", error.code ?? "", error.message);
    return { ok: false, error: t(key) };
  }

  const result = data as { credit: number; customerId: string | null; reference: string; sessionId: string | null };
  const { data: restaurant } = await db.from("restaurants").select("name").eq("id", booking.restaurant_id).maybeSingle();
  if (result.customerId) {
    await notify({
      event: "reservation_status",
      tone: "info",
      customerId: result.customerId,
      href: "/reservations",
      params: { reference: result.reference, restaurantName: restaurant?.name ?? undefined, status: "seated" },
    });
  }

  revalidatePath(`/v/${code}`);
  revalidatePath("/m/reservations");
  revalidatePath("/m/table-order");
  revalidatePath("/m/tables");
  revalidatePath("/reservations");
  return { ok: true, credit: Number(result.credit ?? 0), sessionId: result.sessionId ?? null };
}
