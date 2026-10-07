import Link from "next/link";
import { AdminPage } from "@/components/layout/admin-shell";
import { Card, CardBody, Panel } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getAdminLoyalty } from "@/lib/data/admin-loyalty";
import { loyaltyReserve } from "@/lib/loyalty/reserve";
import { formatDateTime } from "@/lib/format/datetime";

export const dynamic = "force-dynamic";
export const metadata = { title: "Loyalty & reserves" };
const money = (value: number) => `${value.toLocaleString("fr-CM")} FCFA`;
const count = (value: number) => value.toLocaleString("fr-CM");

export default async function AdminLoyaltyPage() {
  const data = await getAdminLoyalty();
  const s = data.summary;
  const reserve = s ? loyaltyReserve(s, data.balance) : null;
  return <AdminPage title="Loyalty & reserves" description="The platform funds loyalty discounts. Restaurants receive the full food value after promotions.">
    <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-text-secondary">Checked {formatDateTime(data.checkedAt)} · {data.mode === "live" ? "Live payments" : "Sandbox — wallet credits may be simulated"}</p>
      <a href="/a/loyalty" className="rounded-md border border-border px-4 py-2 text-sm font-semibold">Refresh balances</a>
    </div>
    {!s || !reserve ? <Card><CardBody><p role="alert" className="text-error">Loyalty accounting is unavailable. Apply migration 0079 or check the database connection before relying on these totals.</p></CardBody></Card> : <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Outstanding customer points", value: count(s.outstandingPoints), detail: `${count(s.customersWithPoints)} customers have points` },
          { label: "Value of outstanding points", value: money(s.outstandingValue), detail: `1 point = ${money(s.pointValue)}` },
          { label: "CamerPay available balance", value: data.balance === null ? "Unavailable" : money(data.balance), detail: "Live gateway balance, read only" },
          { label: "Recommended cash reserve", value: money(reserve.recommended), detail: "Wallets, refunds, loyalty and unconfirmed payouts" },
        ].map((tile) => <Card key={tile.label}><CardBody><p className="text-sm text-text-secondary">{tile.label}</p><p className="mt-2 text-2xl font-bold tabular-nums">{tile.value}</p><p className="mt-2 text-xs text-text-light">{tile.detail}</p></CardBody></Card>)}
      </div>
      <div role="status" className={`rounded-lg border p-5 ${reserve.shortfall === null ? "border-border bg-surface" : reserve.shortfall > 0 ? "border-error/30 bg-error-light" : "border-success/30 bg-success-light"}`}>
        <p className="font-semibold">{reserve.shortfall === null ? "CamerPay balance could not be checked" : reserve.shortfall > 0 ? `Platform funding needed: ${money(reserve.shortfall)}` : `Reserve covered · ${money(reserve.surplus ?? 0)} above the target`}</p>
        <p className="mt-2 text-sm text-text-secondary">{reserve.shortfall === null ? "Open CamerPay to verify the balance. An unavailable balance does not mean there is enough cash." : reserve.shortfall > 0 ? "Top up the platform’s CamerPay account to cover these obligations. Loyalty is paid by the platform; the restaurant’s wallet balance is still owed in full." : "This is a snapshot. Keep a buffer for gateway charges and new points, and refresh before making platform transfers."}</p>
        <Link href="/a/camerpay" className="mt-3 inline-block text-sm font-semibold text-primary">Open CamerPay →</Link>
      </div>
      {data.payoutProvider !== "camerpay" && <p role="alert" className="text-warning">Payouts currently use SasPay. The CamerPay balance shown here cannot cover a SasPay payout.</p>}
      {s.negativeBalances > 0 && <p role="alert" className="text-error">{count(s.negativeBalances)} customer point balances are negative and need review. They are not subtracted from other customers’ points.</p>}
      <Panel title="What the platform needs to cover" description="Funded loyalty is already included in restaurant wallets. Pending withdrawal requests are also inside those wallets, so neither is added twice.">
        <CardBody><dl className="divide-y divide-border">
          {[
            ["Restaurant wallet balances (including held orders)", s.restaurantBalances],
            ["Customer wallet balances", s.customerBalances], ["Pending customer refunds", s.pendingRefunds],
            ["Outstanding points at today’s point value", s.outstandingValue],
            ["Points reserved for orders awaiting payment", s.pendingRedemptionValue],
            ["Unconfirmed payouts — conservative reserve", s.unconfirmedPayouts],
          ].map(([label, value]) => <div key={String(label)} className="flex items-start justify-between gap-4 py-3 text-sm"><dt className="text-text-secondary">{label}</dt><dd className="shrink-0 font-semibold tabular-nums">{money(Number(value))}</dd></div>)}
          <div className="flex justify-between gap-4 pt-4 font-bold"><dt>Recommended reserve</dt><dd>{money(reserve.recommended)}</dd></div>
        </dl><p className="mt-4 text-xs text-text-light">Pending restaurant withdrawals: {money(s.pendingWithdrawals)} (already included above). An unconfirmed payout may already have left CamerPay; verify it in Wallet before releasing this reserve.</p></CardBody>
      </Panel>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card><CardBody><p className="text-sm text-text-secondary">Platform loyalty funded, excluding reversals</p><p className="mt-2 text-xl font-bold">{money(s.fundedValue)}</p><p className="mt-2 text-xs text-text-light">Recorded subsidies, including repaired historical orders.</p></CardBody></Card>
        <Card><CardBody><p className="text-sm text-text-secondary">Loyalty subsidies reversed on cancellation</p><p className="mt-2 text-xl font-bold">{money(s.reversedValue)}</p><p className="mt-2 text-xs text-text-light">Customers receive their points back; cash refunds cover only what they paid.</p></CardBody></Card>
      </div>
      <Panel title="Recent restaurant loyalty credits" description="Each order is funded once. Cancelling it reverses the subsidy in the same transaction.">
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-border text-text-secondary"><tr>{["Order", "Restaurant", "Points used", "Platform funding", "Status", "Credited"].map((label) => <th key={label} className="whitespace-nowrap p-4 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-border">
          {data.recent.map((row) => <tr key={row.id}><td className="p-4 font-semibold">{row.reference}</td><td className="p-4">{row.restaurantName}</td><td className="p-4 tabular-nums">{count(row.points)}</td><td className="whitespace-nowrap p-4 tabular-nums">{money(row.amount)}</td><td className="p-4"><Badge tone={row.status === "credited" ? "success" : "neutral"}>{row.status === "credited" ? "Funded" : "Reversed"}</Badge></td><td className="whitespace-nowrap p-4 text-text-secondary">{formatDateTime(row.creditedAt)}</td></tr>)}
          {data.recent.length === 0 && <tr><td colSpan={6} className="p-6 text-text-secondary">No loyalty-funded orders yet.</td></tr>}
        </tbody></table></div>
      </Panel>
    </>}
    </div>
  </AdminPage>;
}
