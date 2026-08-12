"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, KeyRound, Loader2, Play, ShieldAlert, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, Panel } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import {
  probeBalance,
  probeConfirm,
  probeCollection,
  probeIdentify,
  probeLogin,
  probeRaw,
  probeReport,
  submitRegistration,
  submitValidation,
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

/**
 * Starting points for the raw console.
 *
 * The DATA shapes for `login` and `token` come straight from the docs. The two
 * registration calls are left EMPTY on purpose — the docs do not publish their
 * fields, and a plausible-looking guess sitting in the box would be mistaken
 * for documentation.
 */
const PRESETS = [
  { label: "inscription", service: "authentification", action: "inscription", data: "", authenticated: false },
  { label: "validation", service: "authentification", action: "validation", data: "", authenticated: false },
  {
    label: "login",
    service: "authentification",
    action: "login",
    data: '{ "numero": "6XXXXXXXX", "pass": "your-password" }',
    authenticated: false,
  },
  { label: "balance", service: "account", action: "balance", data: "", authenticated: true },
  { label: "rotate token", service: "account", action: "change_token", data: "", authenticated: true },
];

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

  const [suNumero, setSuNumero] = useState("");
  const [suParrain, setSuParrain] = useState("");
  const [suPass, setSuPass] = useState("");
  const [suToken, setSuToken] = useState("");
  const [suCode, setSuCode] = useState("");

  const [rawService, setRawService] = useState("authentification");
  const [rawAction, setRawAction] = useState("inscription");
  const [rawData, setRawData] = useState("");
  const [rawAuthed, setRawAuthed] = useState(false);

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
                Every charge below moves <strong>real money</strong> out of a real wallet. Minimum
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

      {/* ── 4. Collection ────────────────────────────────────────────── */}
      <Panel
        title="4 · Charge a number"
        description="A real collection — `retrait`. Money leaves the wallet above and lands in your CamerPay balance."
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
            loading={running === "collect"}
            onClick={() => run("collect", () => probeCollection(phone, amountValue))}
          >
            <Play className="size-3.5" aria-hidden />
            <span>Charge {amount} FCFA for real</span>
          </Button>
          {results.collect && <ResultLine result={results.collect} />}
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

      {/* ── Open an account ──────────────────────────────────────────── */}
      <Panel
        title="Open a CamerPay account"
        description="inscription, then validation. The order is not optional."
      >
        <CardBody className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="New account number" htmlFor="su-numero" required hint="9 digits, starts with 6, no +237.">
              <Input
                id="su-numero"
                value={suNumero}
                onChange={(e) => setSuNumero(e.target.value)}
                placeholder="6XXXXXXXX"
                inputMode="numeric"
              />
            </Field>

            <Field label="Sponsor number" htmlFor="su-parrain" required hint="The existing CamerPay account referring this one.">
              <Input
                id="su-parrain"
                value={suParrain}
                onChange={(e) => setSuParrain(e.target.value)}
                placeholder="6YYYYYYYY"
                inputMode="numeric"
              />
            </Field>
          </div>

          <Field
            label="Password"
            htmlFor="su-pass"
            required
            hint="You will paste this into CAMERPAY_PASSWORD. It is never logged."
          >
            <Input
              id="su-pass"
              type="password"
              value={suPass}
              onChange={(e) => setSuPass(e.target.value)}
              placeholder="A strong password"
            />
          </Field>

          <Button
            className="self-start"
            disabled={pending || !suNumero.trim() || !suParrain.trim() || suPass.length < 6}
            loading={running === "signup"}
            onClick={() =>
              run("signup", async () => {
                const result = await submitRegistration({
                  numero: suNumero,
                  parrain: suParrain,
                  pass: suPass,
                });
                // Carried straight into step 2 — the provisional token is a
                // credential and re-typing it from a screen invites a typo.
                if (result.provisionalToken) setSuToken(result.provisionalToken);
                if (result.code) setSuCode(result.code);
                return result;
              })
            }
          >
            <Play className="size-4" aria-hidden />
            <span>1 · Register</span>
          </Button>

          {results.signup && <ResultLine result={results.signup} />}

          {suToken && (
            <div className="flex flex-col gap-4 border-t border-border pt-4">
              <p className="text-sm text-text-secondary">
                <span>
                  Provisional token held. It is used automatically for the confirmation below and is
                  not shown — it is a live credential.
                </span>
              </p>

              <Field
                label="Confirmation code"
                htmlFor="su-code"
                required
                hint="Returned by the registration step, or sent to the number."
              >
                <Input
                  id="su-code"
                  value={suCode}
                  onChange={(e) => setSuCode(e.target.value)}
                  placeholder="1234"
                  inputMode="numeric"
                />
              </Field>

              <Button
                className="self-start"
                disabled={pending || !suCode.trim()}
                loading={running === "validate"}
                onClick={() =>
                  run("validate", () =>
                    submitValidation({ code: suCode, provisionalToken: suToken }),
                  )
                }
              >
                <Play className="size-4" aria-hidden />
                <span>2 · Confirm the code</span>
              </Button>

              {results.validate && <ResultLine result={results.validate} />}
            </div>
          )}

          <p className="rounded-md border border-border bg-surface-2 p-3 text-xs leading-relaxed text-text-secondary">
            <span>
              The confirmation step&apos;s payload is <strong className="text-text">inferred</strong>,
              not published: the docs say only &ldquo;valide le code re&ccedil;u avec le token
              provisoire&rdquo;. If it is refused, use the raw console below to send the exact shape
              CamerPay support gives you — no code change needed.
            </span>
          </p>
        </CardBody>
      </Panel>

      {/* ── Account creation & raw calls ─────────────────────────────── */}
      <Panel
        title="Open an account, or send any call by hand"
        description="For actions whose payload CamerPay does not publish."
      >
        <CardBody className="flex flex-col gap-4">
          <p className="text-sm leading-relaxed text-text-secondary">
            <span>
              The docs name <code className="font-mono text-xs">authentification/inscription</code>{" "}
              and <code className="font-mono text-xs">validation</code> — &ldquo;cr&eacute;e un compte
              puis valide le code re&ccedil;u avec le token provisoire&rdquo; — but they do{" "}
              <strong className="text-text">not publish the DATA fields</strong> either one takes.
              Rather than guess field names and get failures nothing can explain, type the payload
              here. Ask CamerPay support for the exact shape, paste it in, and send.
            </span>
          </p>

          <div className="flex flex-wrap gap-2">
            {PRESETS.map((preset) => (
              <Button
                key={preset.label}
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => {
                  setRawService(preset.service);
                  setRawAction(preset.action);
                  setRawData(preset.data);
                  setRawAuthed(preset.authenticated);
                }}
              >
                <span>{preset.label}</span>
              </Button>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Service" htmlFor="raw-service">
              <Select
                id="raw-service"
                value={rawService}
                onChange={(e) => setRawService(e.target.value)}
              >
                <option value="authentification">authentification</option>
                <option value="account">account</option>
                <option value="transaction">transaction</option>
                <option value="rapport">rapport</option>
              </Select>
            </Field>

            <Field label="Action" htmlFor="raw-action">
              <Input
                id="raw-action"
                value={rawAction}
                onChange={(e) => setRawAction(e.target.value)}
                placeholder="inscription"
              />
            </Field>
          </div>

          <Field
            label="DATA (JSON)"
            htmlFor="raw-data"
            hint="Sent as the DATA header, serialised. Leave empty to send none."
          >
            <Textarea
              id="raw-data"
              rows={4}
              className="font-mono text-xs"
              value={rawData}
              onChange={(e) => setRawData(e.target.value)}
              placeholder='{"numero":"6XXXXXXXX","pass":"..."}'
            />
          </Field>

          <Checkbox
            label="Send with a token (log in first)"
            checked={rawAuthed}
            onChange={(e) => setRawAuthed(e.target.checked)}
          />
          {!rawAuthed && (
            <p className="-mt-2 text-xs text-text-light">
              <span>
                Unauthenticated — correct for <code className="font-mono">inscription</code>, where
                there is no account to log in to yet.
              </span>
            </p>
          )}

          <Button
            className="self-start"
            disabled={pending || !rawAction.trim()}
            loading={running === "raw"}
            onClick={() =>
              run("raw", () =>
                probeRaw({
                  service: rawService,
                  action: rawAction,
                  dataJson: rawData,
                  authenticated: rawAuthed,
                }),
              )
            }
          >
            <Play className="size-4" aria-hidden />
            <span>Send</span>
          </Button>

          {results.raw && <ResultLine result={results.raw} />}
        </CardBody>
      </Panel>

    </div>
  );
}
