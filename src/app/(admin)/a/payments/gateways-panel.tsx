"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SuperAdminOnlyHint, useIsSuperAdmin } from "@/components/layout/admin-shell";
import { useToast } from "@/components/ui/toast";
import { formatMoney } from "@/lib/format/currency";
import { getGatewayStatus, setPaymentGateway, type GatewayStatus } from "@/lib/data/payment-gateway-actions";
import type { GatewayId } from "@/lib/payments/gateway";
import type { SaspayTier } from "@/lib/payments/saspay/client";

const LABEL: Record<GatewayId, string> = { camerpay: "CamerPay", saspay: "SasPay" };

function tierText(t: SaspayTier): string {
  const parts = [`${t.percent}%`];
  if (t.fixed) parts.push(`+ ${formatMoney(t.fixed)}`);
  if (t.floor !== null) parts.push(`min fee ${formatMoney(t.floor)}`);
  if (t.cap !== null) parts.push(`max fee ${formatMoney(t.cap)}`);
  const range = `${formatMoney(t.minAmount)} – ${t.maxAmount === null ? "∞" : formatMoney(t.maxAmount)}`;
  return `${range}: ${parts.join(" ")}${t.feeChargeMode ? ` (${t.feeChargeMode === "ADD_ON" ? "fee added for the payer" : "fee deducted from what you receive"})` : ""}`;
}

/**
 * Payments → Gateways. Cameroon only: both gateways are pinned to CM / XAF
 * and MTN / Orange numbers. Collections and payouts switch independently —
 * see lib/payments/gateway.ts for why.
 */
export function GatewaysPanel({ initial }: { initial: GatewayStatus }) {
  const { toast } = useToast();
  const canSwitch = useIsSuperAdmin();
  const [status, setStatus] = useState(initial);
  const [pending, startTransition] = useTransition();

  function change(direction: "collect" | "payout", gateway: GatewayId) {
    startTransition(async () => {
      const result = await setPaymentGateway(direction, gateway);
      if (!result.ok) toast(result.error, "error");
      else {
        toast(`${direction === "collect" ? "Collections" : "Payouts"} now use ${LABEL[gateway]}.`, "success");
        setStatus(await getGatewayStatus());
      }
    });
  }

  const s = status.saspay;

  return (
    <section className="mb-8 space-y-5 rounded-xl border border-border bg-surface p-5">
      <div>
        <h2 className="font-semibold">Payment gateways — Cameroon</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Every payment is restricted to Cameroon (XAF, MTN MoMo and Orange Money numbers). Money already in flight is
          always confirmed with the gateway that took it, so switching is safe at any time.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {(["collect", "payout"] as const).map((direction) => (
          <div key={direction} className="rounded-lg border border-border p-4">
            <p className="text-sm font-semibold">
              {direction === "collect" ? "Collections (customers paying)" : "Payouts (refunds, restaurant withdrawals)"}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(["camerpay", "saspay"] as const).map((gateway) => {
                const active = status[direction] === gateway;
                return (
                  <Button
                    key={gateway}
                    size="sm"
                    variant={active ? "primary" : "outline"}
                    disabled={pending || active || !canSwitch || (gateway === "saspay" && !s.configured)}
                    onClick={() => change(direction, gateway)}
                  >
                    {LABEL[gateway]}
                    {active ? " · active" : ""}
                  </Button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-text-light">
              Per transaction: {LABEL.camerpay} {formatMoney(status.ranges.camerpay.min)} – {formatMoney(status.ranges.camerpay.max)} ·{" "}
              {LABEL.saspay} {formatMoney(status.ranges.saspay.min)} – {formatMoney(status.ranges.saspay.max)}
            </p>
            {direction === "payout" && (
              <p className="mt-2 text-xs text-warning">
                SasPay payouts need your server IP whitelisted in the SasPay dashboard. Vercel has no fixed IP unless Static
                IPs are enabled — otherwise keep payouts on CamerPay.
              </p>
            )}
          </div>
        ))}
      </div>
      {!canSwitch && <SuperAdminOnlyHint />}

      <div className="rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold">SasPay</p>
          <Badge tone={s.configured ? "success" : "warning"}>{s.configured ? "Key configured" : "No API key"}</Badge>
          {s.environment && <Badge tone={s.environment === "live" ? "success" : "info"}>{s.environment === "live" ? "Live key" : "Test key"}</Badge>}
          <Badge tone={s.webhookSecretSet ? "success" : "warning"}>
            {s.webhookSecretSet ? "Webhook secret set" : "No webhook secret"}
          </Badge>
        </div>

        {!s.configured ? (
          <p className="mt-2 text-sm text-text-secondary">
            Add <code>SASPAY_API_KEY</code> (sk_live_… or sk_test_…) and <code>SASPAY_WEBHOOK_SECRET</code> to the server
            environment, redeploy, then register the webhook URL <code>/api/webhooks/saspay</code> in the SasPay dashboard
            (events: transaction.success, transaction.failed, transaction.cancelled).
          </p>
        ) : (
          <>
            <p className="mt-3 text-sm">
              Cameroon balance:{" "}
              {s.balance ? (
                <strong>
                  {formatMoney(s.balance.available)} available · {formatMoney(s.balance.pending)} pending
                  {s.balance.frozen ? " · FROZEN (outgoing blocked)" : ""}
                </strong>
              ) : (
                <span className="text-text-light">{s.balanceError ?? "no Cameroon wallet yet (created on the first payment)"}</span>
              )}
            </p>

            <p className="mt-4 text-sm font-semibold">Your rates (live from SasPay, Cameroon)</p>
            {s.ratesError && <p className="mt-1 text-sm text-error">{s.ratesError}</p>}
            {s.rates && s.rates.length === 0 && <p className="mt-1 text-sm text-text-light">No Cameroon network returned.</p>}
            {s.rates && s.rates.length > 0 && (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[36rem] text-left text-sm">
                  <thead className="text-xs text-text-light">
                    <tr>
                      <th className="py-1 pr-3">Network</th>
                      <th className="py-1 pr-3">Collection (payin)</th>
                      <th className="py-1">Payout</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {s.rates.map((rate) => (
                      <tr key={rate.networkCode} className="align-top">
                        <td className="py-2 pr-3 font-medium">
                          {rate.networkName}
                          <span className="block text-xs text-text-light">{rate.networkCode}</span>
                        </td>
                        <td className="py-2 pr-3">
                          {!rate.payin?.available ? (
                            <span className="text-text-light">not available</span>
                          ) : (
                            rate.payin.tiers.map((t, i) => <span key={i} className="block">{tierText(t)}</span>)
                          )}
                        </td>
                        <td className="py-2">
                          {!rate.payout?.available ? (
                            <span className="text-text-light">not available</span>
                          ) : (
                            rate.payout.tiers.map((t, i) => <span key={i} className="block">{tierText(t)}</span>)
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
