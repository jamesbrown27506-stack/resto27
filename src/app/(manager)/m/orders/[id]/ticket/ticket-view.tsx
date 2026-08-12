"use client";

import { useEffect } from "react";
import { Printer, X } from "lucide-react";
import { formatDateTime } from "@/lib/format/datetime";
import { formatMoney } from "@/lib/format/currency";
import type { ManagerOrder } from "@/lib/data/orders";

/* Fixed, accent-free labels: thermal printers and their code pages are the
   audience here, not the language toggle. */
const TYPE_LABEL: Record<string, string> = {
  delivery: "LIVRAISON",
  pickup: "A EMPORTER",
  dine_in: "SUR PLACE",
};
const PAY_LABEL: Record<string, string> = {
  cash_on_delivery: "Especes a la livraison",
  pay_at_restaurant: "Paiement au restaurant",
  mobile_money: "Mobile Money",
};

/**
 * 80 mm thermal ticket (§14.4).
 *
 * Auto-opens the print dialog on mount, because this page is only ever reached
 * by someone who already decided to print. Monospace and pure black on white:
 * thermal paper has no greys, and anything below full black prints as a smear.
 *
 * Every figure comes off the ORDER — the snapshot — never recomputed.
 */
export function TicketView({
  order,
  restaurantName,
  brandName,
}: {
  order: ManagerOrder;
  restaurantName: string;
  brandName: string;
}) {
  useEffect(() => {
    const id = window.setTimeout(() => window.print(), 400);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <div className="mx-auto max-w-[80mm] bg-white p-3 font-mono text-[11px] leading-tight text-black">
      <div className="no-print mb-4 flex gap-2 border-b border-dashed border-black/30 pb-3">
        <button
          type="button"
          onClick={() => window.print()}
          className="flex items-center gap-1.5 rounded bg-black px-3 py-1.5 text-xs font-bold text-white"
        >
          <Printer className="size-3" aria-hidden />
          Imprimer
        </button>
        <button
          type="button"
          onClick={() => window.close()}
          className="flex items-center gap-1.5 rounded border border-black/20 px-3 py-1.5 text-xs font-bold"
        >
          <X className="size-3" aria-hidden />
          Fermer
        </button>
      </div>

      <div className="text-center">
        <p className="text-sm font-bold tracking-wider">{restaurantName.toUpperCase()}</p>
        <p className="mt-0.5">Douala · Cameroun</p>
      </div>

      <Divider />

      <div className="text-center">
        <p className="text-base font-bold">{order.reference}</p>
        <p>{formatDateTime(order.createdAt)}</p>
        <p className="mt-1 font-bold">
          {TYPE_LABEL[order.type]}
          {order.tableNumber && ` — TABLE ${order.tableNumber}`}
        </p>
      </div>

      <Divider />

      <table className="w-full">
        <tbody>
          {order.items.map((item) => (
            <tr key={item.id} className="align-top">
              <td className="w-6 pb-2 font-bold">{item.quantity}×</td>
              <td className="pb-2">
                <span className="font-bold">{item.name}</span>
                {item.optionsLabel && <span className="block">{item.optionsLabel}</span>}
                {item.notes && <span className="block font-bold">** {item.notes}</span>}
              </td>
              <td className="pb-2 text-right whitespace-nowrap">
                {formatMoney(item.unitPrice * item.quantity, { showSymbol: false })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Divider />

      <Row label="Sous-total" value={formatMoney(order.subtotal, { showSymbol: false })} />
      {order.discountAmount > 0 && (
        <Row label="Remise" value={`-${formatMoney(order.discountAmount, { showSymbol: false })}`} />
      )}
      <Row label="Service" value={formatMoney(order.serviceCharge, { showSymbol: false })} />
      {order.type === "delivery" && (
        <Row
          label="Livraison"
          value={
            order.deliveryFeeSetAt === null
              ? "A CONFIRMER"
              : formatMoney(order.deliveryFee, { showSymbol: false })
          }
        />
      )}
      <Divider />

      <div className="flex justify-between text-sm font-bold">
        <span>TOTAL</span>
        <span>{formatMoney(order.total, { showSymbol: false })} FCFA</span>
      </div>

      <p className="mt-1">{PAY_LABEL[order.paymentMethod]}</p>

      {order.type === "delivery" && order.deliveryAddress && (
        <>
          <Divider />
          <p className="font-bold">LIVRAISON</p>
          <p>{order.deliveryName}</p>
          <p>{order.deliveryPhone}</p>
          <p>{order.deliveryAddress}</p>
          <p>{order.deliveryQuartier}</p>
          {order.deliveryLandmark && <p>Repere : {order.deliveryLandmark}</p>}
        </>
      )}

      {order.notes && (
        <>
          <Divider />
          <p className="font-bold">NOTE</p>
          <p>{order.notes}</p>
        </>
      )}

      <Divider />

      <p className="text-center">Merci et bon appetit !</p>
      <p className="mt-3 text-center text-[9px]">{brandName}</p>
      {/* Trailing space so the tear-off does not cut the last line. */}
      <div className="h-8" />
    </div>
  );
}

function Divider() {
  return <p className="my-2 overflow-hidden text-[10px] whitespace-nowrap">{"-".repeat(48)}</p>;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
