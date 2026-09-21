import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { sendGuestDiningPush } from "@/lib/push";
import { formatMoney } from "@/lib/format/currency";

/** Tell anonymous QR guests that a real online payment has settled. */
export async function notifyDiningPaymentSettled(orderId: string, amount: number): Promise<void> {
  const db = createAdminClient();
  const { data, error } = await db.from("dining_sessions")
    .select("id,restaurant_tables(public_token),dining_guests(id,locale)")
    .eq("order_id", orderId).maybeSingle();
  if (error || !data) return;
  const table = Array.isArray(data.restaurant_tables) ? data.restaurant_tables[0] : data.restaurant_tables;
  const href = table?.public_token ? `/table/${table.public_token}` : "/";
  await Promise.allSettled((data.dining_guests ?? []).map(async (guest) => {
    const fr = guest.locale !== "en";
    const body = fr
      ? `Votre paiement de ${formatMoney(amount)} a été confirmé. Merci de votre visite.`
      : `Your payment of ${formatMoney(amount)} was confirmed. Thank you for visiting.`;
    await db.from("dining_messages").insert({
      session_id: data.id, guest_id: guest.id, sender_kind: "system",
      kind: "message", body,
    });
    await sendGuestDiningPush(guest.id, {
      title: fr ? "Paiement confirmé" : "Payment confirmed",
      body, href, lang: fr ? "fr" : "en", tone: "success",
      icon: "/app-icon-192.png", badge: "/notification-badge.png",
    });
  }));
}
