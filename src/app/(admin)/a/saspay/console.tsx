"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { SuperAdminOnlyHint, useIsSuperAdmin } from "@/components/layout/admin-shell";
import { formatMoney } from "@/lib/format/currency";
import { checkStatus, consoleOverview, testCollection, testPayout, type ConsoleResult } from "./actions";

type Overview = Awaited<ReturnType<typeof consoleOverview>>;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-border bg-surface p-5">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function ResultBox({ result }: { result: ConsoleResult | null }) {
  if (!result) return null;
  return (
    <div className={`rounded-md border p-3 text-sm ${result.ok ? "border-success/30 bg-success-light" : "border-error/30 bg-error-light"}`}>
      <p className="font-semibold">{result.label}</p>
      <p className="mt-1 text-text-secondary">{result.detail}</p>
      {result.id && <p className="mt-1 font-mono text-xs">id: {result.id}</p>}
      {result.checkoutUrl && (
        <a href={result.checkoutUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 font-semibold text-primary hover:underline">
          Open the payment page <ExternalLink className="size-3.5" aria-hidden />
        </a>
      )}
      {result.payload !== undefined && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-text-light">Raw response</summary>
          <pre className="mt-1 max-h-64 overflow-auto rounded bg-surface p-2 text-xs">{JSON.stringify(result.payload, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

/**
 * A test form: start → poll the verdict every 4 s until it is final (or the
 * admin leaves), exactly what the customer's pending screen does.
 */
function TestForm({ kind, disabled }: { kind: "collection" | "payout"; disabled: boolean }) {
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState(kind === "collection" ? "200" : "500");
  const [started, setStarted] = useState<ConsoleResult | null>(null);
  const [latest, setLatest] = useState<ConsoleResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [polling, setPolling] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setPolling(false);
  }, []);
  useEffect(() => stop, [stop]);

  async function start() {
    stop();
    setBusy(true);
    setLatest(null);
    const result = kind === "collection" ? await testCollection(phone, Number(amount)) : await testPayout(phone, Number(amount));
    setStarted(result);
    setBusy(false);
    if (result.ok && result.id && result.status === "pending") {
      const id = result.id;
      setPolling(true);
      timer.current = setInterval(async () => {
        const check = await checkStatus(kind, id);
        setLatest(check);
        if (check.status === "success" || check.status === "failed") stop();
      }, 4_000);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
        <Field label={kind === "collection" ? "Number to charge" : "Number to pay"} htmlFor={`sp-${kind}-phone`}>
          <Input id={`sp-${kind}-phone`} inputMode="tel" placeholder="6XXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Amount (FCFA)" htmlFor={`sp-${kind}-amount`}>
          <Input id={`sp-${kind}-amount`} type="number" min={200} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Button disabled={disabled || busy || !phone.trim()} loading={busy} onClick={() => void start()}>
          {kind === "collection" ? "Charge" : "Send"}
        </Button>
      </div>
      <ResultBox result={started} />
      {latest && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-text-secondary">Live status:</span>
          <Badge tone={latest.status === "success" ? "success" : latest.status === "failed" ? "error" : "warning"}>{latest.label}</Badge>
          {polling && <RefreshCw className="size-3.5 animate-spin text-text-light" aria-hidden />}
        </div>
      )}
      {latest && <ResultBox result={latest} />}
    </div>
  );
}

export function SaspayConsole(props: {
  configured: boolean;
  environment: "live" | "test" | null;
  webhookSecretSet: boolean;
  webhookUrl: string;
}) {
  const canTest = useIsSuperAdmin();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, startLoading] = useTransition();
  const [lookupKind, setLookupKind] = useState<"collection" | "payout">("collection");
  const [lookupId, setLookupId] = useState("");
  const [lookup, setLookup] = useState<ConsoleResult | null>(null);

  const refresh = useCallback(() => {
    startLoading(async () => setOverview(await consoleOverview()));
  }, []);
  useEffect(() => {
    if (props.configured) refresh();
  }, [props.configured, refresh]);

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <Section title="Configuration">
        <div className="flex flex-wrap gap-2">
          <Badge tone={props.configured ? "success" : "error"}>{props.configured ? "SASPAY_API_KEY set" : "SASPAY_API_KEY missing"}</Badge>
          {props.environment && <Badge tone={props.environment === "live" ? "success" : "info"}>{props.environment === "live" ? "Live key (real money)" : "Test key (SasPay sandbox)"}</Badge>}
          <Badge tone={props.webhookSecretSet ? "success" : "warning"}>{props.webhookSecretSet ? "SASPAY_WEBHOOK_SECRET set" : "SASPAY_WEBHOOK_SECRET missing"}</Badge>
          {overview && <Badge tone={overview.ping.ok ? "success" : "error"}>{overview.ping.ok ? "API reachable" : "API error"}</Badge>}
        </div>
        {overview && !overview.ping.ok && <p className="text-sm text-error">{overview.ping.detail}</p>}
        <p className="text-sm text-text-secondary">
          Webhook URL to register in the SasPay dashboard (events transaction.success, transaction.failed, transaction.cancelled):
        </p>
        <code className="block break-all rounded bg-surface-2 px-3 py-2 text-sm">{props.webhookUrl}</code>
        <p className="text-xs text-text-light">
          Which gateway customers actually use is chosen in Payments → Gateways. Tests below never touch orders or wallets.
        </p>
        {!props.configured && (
          <p className="text-sm text-warning">
            Add SASPAY_API_KEY (and SASPAY_WEBHOOK_SECRET) to the server environment and redeploy — see docs/SASPAY.md.
          </p>
        )}
      </Section>

      {props.configured && (
        <>
          <Section title="Balance and rates (Cameroon)">
            <div className="flex items-center gap-3">
              <Button size="sm" variant="outline" loading={loading} disabled={loading} onClick={refresh}>
                <RefreshCw className="size-3.5" aria-hidden /> Refresh
              </Button>
            </div>
            {overview && (
              <>
                <p className="text-sm">
                  {overview.balance ? (
                    <>
                      <strong>{formatMoney(overview.balance.available)}</strong> available ·{" "}
                      {formatMoney(overview.balance.pending)} pending
                      {overview.balance.frozen && <span className="font-semibold text-error"> · FROZEN (outgoing blocked)</span>}
                    </>
                  ) : (
                    <span className="text-text-light">{overview.balanceError ?? "No Cameroon wallet yet — created on the first payment."}</span>
                  )}
                </p>
                {overview.ratesError && <p className="text-sm text-error">{overview.ratesError}</p>}
                {overview.rates?.map((rate) => (
                  <div key={rate.networkCode} className="rounded-md border border-border p-3 text-sm">
                    <p className="font-semibold">
                      {rate.networkName} <span className="font-normal text-text-light">({rate.networkCode})</span>
                    </p>
                    {(["payin", "payout"] as const).map((dir) => {
                      const side = rate[dir];
                      return (
                        <div key={dir} className="mt-1">
                          <span className="text-text-secondary">{dir === "payin" ? "Collection" : "Payout"}: </span>
                          {!side?.available ? (
                            <span className="text-text-light">not available</span>
                          ) : (
                            side.tiers.map((t, i) => (
                              <span key={i} className="block pl-4">
                                {formatMoney(t.minAmount)} – {t.maxAmount === null ? "∞" : formatMoney(t.maxAmount)}: {t.percent}%
                                {t.fixed ? ` + ${formatMoney(t.fixed)}` : ""}
                                {t.floor !== null ? ` · min fee ${formatMoney(t.floor)}` : ""}
                                {t.cap !== null ? ` · max fee ${formatMoney(t.cap)}` : ""}
                                {t.feeChargeMode ? ` · ${t.feeChargeMode}` : ""}
                                {side.otpRequired ? " · OTP required" : ""}
                              </span>
                            ))
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </>
            )}
          </Section>

          <Section title="Test a collection (charge a phone)">
            <p className="text-sm text-text-secondary">
              Real money on a live key. MTN usually receives a prompt; Orange usually returns a payment page to open.
            </p>
            <TestForm kind="collection" disabled={!canTest} />
            {!canTest && <SuperAdminOnlyHint />}
          </Section>

          <Section title="Test a payout (send to a phone)">
            <p className="text-sm text-text-secondary">
              Sent from the SasPay Cameroon balance. Requires this server&apos;s IP to be whitelisted in the SasPay dashboard,
              otherwise SasPay answers <code>ip_not_whitelisted</code>.
            </p>
            <TestForm kind="payout" disabled={!canTest} />
            {!canTest && <SuperAdminOnlyHint />}
          </Section>

          <Section title="Check a transaction">
            <div className="grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
              <Field label="Kind" htmlFor="sp-lookup-kind">
                <select
                  id="sp-lookup-kind"
                  className="h-11 rounded-md border border-border bg-surface px-3 text-sm"
                  value={lookupKind}
                  onChange={(e) => setLookupKind(e.target.value as "collection" | "payout")}
                >
                  <option value="collection">Collection</option>
                  <option value="payout">Payout</option>
                </select>
              </Field>
              <Field label="SasPay transaction id" htmlFor="sp-lookup-id">
                <Input id="sp-lookup-id" value={lookupId} onChange={(e) => setLookupId(e.target.value)} />
              </Field>
              <Button variant="outline" disabled={!lookupId.trim()} onClick={async () => setLookup(await checkStatus(lookupKind, lookupId.trim()))}>
                Verify
              </Button>
            </div>
            <ResultBox result={lookup} />
          </Section>

          <Section title="Recent Cameroon transactions">
            {overview?.transactionsError && <p className="text-sm text-error">{overview.transactionsError}</p>}
            {overview?.transactions && overview.transactions.length === 0 && <p className="text-sm text-text-light">None yet.</p>}
            {overview?.transactions && overview.transactions.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[40rem] text-left text-sm">
                  <thead className="text-xs text-text-light">
                    <tr><th className="py-1 pr-3">When</th><th className="pr-3">Type</th><th className="pr-3">Network</th><th className="pr-3">Number</th><th className="pr-3">Charged</th><th className="pr-3">Net</th><th>Status</th></tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {overview.transactions.map((tx) => (
                      <tr key={tx.id}>
                        <td className="py-1.5 pr-3 tnum">{tx.createdAt ? new Date(tx.createdAt).toLocaleString("fr-FR", { timeZone: "Africa/Douala" }) : ""}</td>
                        <td className="pr-3">{tx.type || tx.direction}</td>
                        <td className="pr-3">{tx.network}</td>
                        <td className="pr-3 tnum">{tx.msisdn ?? "—"}</td>
                        <td className="pr-3 tnum">{Number.isFinite(tx.charged) ? formatMoney(tx.charged) : "—"}</td>
                        <td className="pr-3 tnum">{Number.isFinite(tx.net) ? formatMoney(tx.net) : "—"}</td>
                        <td><Badge tone={tx.status === "SUCCESS" ? "success" : tx.status === "FAILED" ? "error" : "warning"}>{tx.status}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title="Webhook deliveries">
            <p className="text-xs text-text-light">What SasPay sent to {props.webhookUrl} and what this site answered (200 = handled, 401 = signature refused).</p>
            {overview?.webhooksError && <p className="text-sm text-error">{overview.webhooksError}</p>}
            {overview?.webhooks && overview.webhooks.length === 0 && <p className="text-sm text-text-light">No delivery yet.</p>}
            {overview?.webhooks && overview.webhooks.length > 0 && (
              <ul className="divide-y divide-border text-sm">
                {overview.webhooks.map((w) => (
                  <li key={w.id} className="flex flex-wrap items-center gap-2 py-1.5">
                    <span className="tnum text-text-light">{w.createdAt ? new Date(w.createdAt).toLocaleString("fr-FR", { timeZone: "Africa/Douala" }) : ""}</span>
                    <span className="font-medium">{w.event}</span>
                    <Badge tone={w.status.toUpperCase() === "SUCCESS" || w.status.toUpperCase() === "DELIVERED" ? "success" : w.status.toUpperCase() === "FAILED" ? "error" : "warning"}>{w.status || "—"}</Badge>
                    {w.responseCode !== null && <span className="tnum text-text-secondary">HTTP {w.responseCode}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
