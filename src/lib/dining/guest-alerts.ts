import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { sendGuestDiningPush } from "@/lib/push";
import { formatMoney } from "@/lib/format/currency";
import { notify } from "@/lib/notify";

/**
 * One part of a table bill was paid online (0068). Everyone on the bill hears
 * how much is left — or that it is settled — and the staff floor hears that
 * money arrived (the tip named, it is theirs).
 */
export async function notifyDiningPartPaid(input: {
  sessionId: string;
  restaurantId: string;
  amount: number;
  tip: number;
  closed: boolean;
  payerGuestId: string | null;
}): Promise<void> {
  const db = createAdminClient();
  const { data, error } = await db.from("dining_sessions")
    .select("id,label,restaurant_tables(number,public_token),dining_guests(id,locale,display_name,status)")
    .eq("id", input.sessionId).maybeSingle();
  if (error || !data) return;
  const table = Array.isArray(data.restaurant_tables) ? data.restaurant_tables[0] : data.restaurant_tables;
  const href = table?.public_token ? `/table/${table.public_token}` : "/";
  const guests = (data.dining_guests ?? []) as { id: string; locale: string; display_name: string; status: string }[];
  const payer = guests.find((guest) => guest.id === input.payerGuestId)?.display_name ?? "";

  let remaining = 0;
  if (!input.closed) {
    const [{ data: due }, { data: paid }] = await Promise.all([
      db.rpc("dining_bill_due", { p_session_id: input.sessionId }),
      db.rpc("dining_paid", { p_session_id: input.sessionId }),
    ]);
    remaining = Math.max(0, Number(due ?? 0) - Number(paid ?? 0));
  }

  await Promise.allSettled(guests.filter((guest) => guest.status !== "rejected").map(async (guest) => {
    const fr = guest.locale !== "en";
    const who = payer || (fr ? "Un convive" : "A guest");
    const body = input.closed
      ? (fr ? `${who} a payé ${formatMoney(input.amount)}. L’addition est réglée — merci de votre visite !`
            : `${who} paid ${formatMoney(input.amount)}. The bill is settled — thank you for visiting!`)
      : (fr ? `${who} a payé ${formatMoney(input.amount)}. Reste à payer : ${formatMoney(remaining)}.`
            : `${who} paid ${formatMoney(input.amount)}. Left to pay: ${formatMoney(remaining)}.`);
    await db.from("dining_messages").insert({
      session_id: data.id, guest_id: guest.id, sender_kind: "system", kind: "message", body,
    });
    await sendGuestDiningPush(guest.id, {
      title: input.closed ? (fr ? "Addition réglée" : "Bill settled") : (fr ? "Paiement reçu" : "Payment received"),
      body, href, lang: fr ? "fr" : "en", tone: "success",
      icon: "/app-icon-192.png", badge: "/notification-badge.png",
    });
  }));

  await notify({
    event: "table_service",
    tone: "success",
    restaurantId: input.restaurantId,
    href: `/m/table-order?session=${input.sessionId}`,
    params: {
      reference: table?.number ?? "—",
      customerName: payer || data.label || "Client",
      tableServiceKind: "message",
      preview: input.closed
        ? `Addition réglée en ligne (${formatMoney(input.amount)}${input.tip > 0 ? `, pourboire ${formatMoney(input.tip)}` : ""}).`
        : `Paiement en ligne ${formatMoney(input.amount)}${input.tip > 0 ? ` + pourboire ${formatMoney(input.tip)}` : ""} — reste ${formatMoney(remaining)}.`,
    },
  });
}

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
