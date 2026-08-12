"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, KeyRound, Loader2, Play, ShieldAlert, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, Panel } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import {
  probeBalance,
  probeConfirm,
  probeDeposit,
  probeIdentify,
  probeLogin,
  probeReport,
  registerCallback,
  type ProbeResult,
} from "./actions";
import { cn } from "@/lib/utils";

function ResultLine({ result }: { result: ProbeResult }) {
  return (
    <div
      className={cn(
        "mt-3 rounded-md border p-3 text-sm",
        result.ok ? "border-success/30 bg-success-light" : "border-error/30 bg-error-light",
      )}
    >
      <p className={cn("flex items-start gap-2 font-medium", result.ok ? "text-success" : "text-error")}>
        {result.ok ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
        ) : (
          <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
        )}
        <span>{result.detail}</span>
      </p>
      {result.payload != null && (
        <pre className="mt-2 max-h-48 overflow-auto rounded bg-surface p-2 font-mono text-[11px] text-text-secondary">
          {JSON.stringify(result.payload, null, 2)}
        </pre>
      )}
    </div>
  );
}

/** Probes that take no input, so they can be dispatched by key. */
const SIMPLE_PROBES = {
  login: probeLogin,
  balance: probeBalance,
  transactions: () => probeReport("transaction"),
  notifications: () => probeReport("notification"),
} satisfies Record<string, () => Promise<ProbeResult>>;

export function CamerPayConsole({ suggestedCallback }: { suggestedCallback: string }) {
  const [pending, startTransition] = useTransition();
  const [results, setResults] = useState<Record<string, ProbeResult>>({});
  const [running, setRunning] = useState<string | null>(null);

  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("500");
  const [replyTo, setReplyTo] = useState("");
  const [callback, setCallback] = useState(suggestedCallback);

  function run(key: string, fn: () => Promise<ProbeResult>) {
    setRunning(key);
    startTransition(async () => {
      const result = await fn();
      setResults((prev) => ({ ...prev, [key]: result }));
      setRunning(null);
    });
  }

  /**
   * Rendered as a call, not as <Action />.
   *
   * Declaring a component inside another component gives it a new identity on
   * every render, so React unmounts and remounts its whole subtree — losing
   * focus and any local state. Calling it inlines the JSX instead.
   */
  const action = (id: keyof typeof SIMPLE_PROBES, label: string) => (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      loading={running === id}
      onClick={() => run(id, SIMPLE_PROBES[id])}
    >
      <Play className="size-3.5" aria-hidden />
      <span>{label}</span>
    </Button>
  );

  const amountValue = Number(amount);
  const amountValid = Number.isInteger(amountValue) && amountValue >= 500 && amountValue <= 500_000;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      {/* ── The warning that matters most ────────────────────────────── */}
      <Card className="border-error/30 bg-error-light">
        <CardBody className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-error" aria-hidden />
          <div className="text-sm text-error">
            <p className="font-bold">CamerPay has no sandbox, and no signed callbacks.</p>
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 opacity-90">
              <li>
                Every deposit below moves <strong>real money</strong> from a real wallet. Minimum
                500 FCFA.
              </li>
              <li>
                Callbacks arrive <strong>unsigned</strong>. Anyone who learns the URL can post a
                fake success, so nothing is ever credited from a callback alone — we always confirm
                back to CamerPay first.
              </li>
              <li>
                HTTP 202 means <strong>accepted</strong>, not paid. The customer still approves on
                their handset.
              </li>
            </ul>
          </div>
        </CardBody>
      </Card>

      {/* ── 1. Authentication ────────────────────────────────────────── */}
      <Panel title="1 · Authentication" description="Log in and read the account balance.">
        <CardBody>
          <p className="text-sm text-text-secondary">
            Credentials come from <code className="font-mono text-xs">CAMERPAY_ACCOUNT_NUMBER</code>{" "}
            and <code className="font-mono text-xs">CAMERPAY_PASSWORD</code> in{" "}
            <code className="font-mono text-xs">.env.local</code>. The token is held server-side
            only and is masked everywhere it is displayed.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {action("login", "Log in")}
            {action("balance", "Check balance")}
          </div>
          {results.login && <ResultLine result={results.login} />}
          {results.balance && <ResultLine result={results.balance} />}
        </CardBody>
      </Panel>

      {/* ── 2. Callback registration ─────────────────────────────────── */}
      <Panel
        title="2 · Callback URL"
        description="Where CamerPay posts transaction outcomes."
      >
        <CardBody>
          <Field
            label="HTTPS callback URL"
            htmlFor="cp-callback"
            hint="Must be HTTPS. localhost will not work — use a tunnel such as ngrok while developing."
          >
            <Input
              id="cp-callback"
              value={callback}
              onChange={(e) => setCallback(e.target.value)}
              placeholder="https://your-domain.cm/api/webhooks/camerpay"
            />
          </Field>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            disabled={pending || !callback.startsWith("https://")}
            loading={running === "callback"}
            onClick={() => run("callback", () => registerCallback(callback))}
          >
            <KeyRound className="size-3.5" aria-hidden />
            <span>Register with CamerPay</span>
          </Button>
          {results.callback && <ResultLine result={results.callback} />}
        </CardBody>
      </Panel>

      {/* ── 3. Identify ──────────────────────────────────────────────── */}
      <Panel title="3 · Identify a number" description="Free. Confirms the operator before charging.">
        <CardBody>
          <Field
            label="Customer phone"
            htmlFor="cp-phone"
            hint="9 digits starting with 6. +237 and spaces are stripped automatically."
          >
            <Input
              id="cp-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="677889900"
              inputMode="tel"
            />
          </Field>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            disabled={pending || phone.trim().length < 9}
            loading={running === "identify"}
            onClick={() => run("identify", () => probeIdentify(phone))}
          >
            <Play className="size-3.5" aria-hidden />
            <span>Identify</span>
          </Button>
          {results.identify && <ResultLine result={results.identify} />}
        </CardBody>
      </Panel>

      {/* ── 4. Deposit ───────────────────────────────────────────────── */}
      <Panel
        title="4 · Request a deposit"
        description="A real collection. The number above is charged."
      >
        <CardBody>
          <div className="flex items-start gap-2.5 rounded-md border border-warning/30 bg-warning-light p-3 text-sm text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              This debits the wallet for real. Use the smallest amount that proves the flow — 500
              FCFA.
            </span>
          </div>

          <Field
            label="Amount"
            htmlFor="cp-amount"
            className="mt-4"
            hint="Between 500 and 500 000 FCFA. Whole francs — XAF has no decimals."
            error={amount !== "" && !amountValid ? "Outside CamerPay's accepted range." : undefined}
          >
            <Input
              id="cp-amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="numeric"
              suffix="FCFA"
            />
          </Field>

          <Button
            variant="danger"
            size="sm"
            className="mt-4"
            disabled={pending || !amountValid || phone.trim().length < 9}
            loading={running === "deposit"}
            onClick={() => run("deposit", () => probeDeposit(phone, amountValue))}
          >
            <Play className="size-3.5" aria-hidden />
            <span>Charge {amount} FCFA for real</span>
          </Button>
          {results.deposit && <ResultLine result={results.deposit} />}
        </CardBody>
      </Panel>

      {/* ── 5. Confirm ───────────────────────────────────────────────── */}
      <Panel
        title="5 · Confirm an outcome"
        description="The only thing that proves a payment settled."
      >
        <CardBody>
          <p className="text-sm text-text-secondary">
            Because callbacks are unsigned, this is the trust anchor: it asks CamerPay directly what
            happened to a <code className="font-mono text-xs">replyTo</code>. The reconciler uses
            exactly this call to sweep payments whose callback never arrived.
          </p>
          <Field label="replyTo" htmlFor="cp-replyto" className="mt-4">
            <Input
              id="cp-replyto"
              value={replyTo}
              onChange={(e) => setReplyTo(e.target.value)}
              placeholder="Paste the replyTo returned by step 4"
            />
          </Field>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            disabled={pending || !replyTo.trim()}
            loading={running === "confirm"}
            onClick={() => run("confirm", () => probeConfirm(replyTo))}
          >
            <Play className="size-3.5" aria-hidden />
            <span>Ask CamerPay</span>
          </Button>
          {results.confirm && <ResultLine result={results.confirm} />}
        </CardBody>
      </Panel>

      {/* ── 6. Reports ───────────────────────────────────────────────── */}
      <Panel title="6 · Reports" description="Raw transaction and notification history.">
        <CardBody>
          <div className="flex flex-wrap gap-2">
            {action("transactions", "Transactions")}
            {action("notifications", "Notifications")}
          </div>
          {results.transactions && <ResultLine result={results.transactions} />}
          {results.notifications && <ResultLine result={results.notifications} />}
        </CardBody>
      </Panel>

      {pending && (
        <p
          role="status"
          className="flex items-center gap-2 text-sm font-medium text-primary"
          aria-live="polite"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Calling CamerPay…
        </p>
      )}

      <Card className="bg-surface-2">
        <CardBody>
          <p className="text-[11px] font-bold tracking-[0.08em] text-text-light uppercase">
            Account creation
          </p>
          <p className="mt-2 text-sm leading-relaxed text-text-secondary">
            CamerPay exposes <code className="font-mono text-xs">authentification/inscription</code>{" "}
            and <code className="font-mono text-xs">validation</code> for opening an account
            programmatically. It is deliberately not wired here: creating the merchant account is a
            one-time commercial step involving identity documents, and putting a button on it in an
            admin panel invites someone to create a second account nobody is tracking. Do it on
            CamerPay&apos;s own site, then paste the credentials into{" "}
            <code className="font-mono text-xs">.env.local</code>.
          </p>
          <Badge tone="neutral" className="mt-3">
            Intentionally out of scope
          </Badge>
        </CardBody>
      </Card>
    </div>
  );
}
