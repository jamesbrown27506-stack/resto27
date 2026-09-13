"use client";

import { useState, useTransition } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  Copy,
  KeyRound,
  Link2,
  Play,
  RefreshCw,
  ScrollText,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, Panel } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import {
  probeBalance,
  probeConfirm,
  probeCollection,
  probeIdentify,
  probeLogin,
  probePayout,
  probeRaw,
  probeReport,
  submitRegistration,
  submitValidation,
  registerCallback,
  type ProbeResult,
} from "./actions";
import { TransactionWatcher } from "./transaction-watcher";
import { cn } from "@/lib/utils";
import { computeWithdrawalFee } from "@/lib/payments/withdrawal-fee";

function ResultLine({ result }: { result: ProbeResult }) {
  return (
    <div
      className={cn(
        "mt-3 rounded-md border p-3 text-sm",
        result.ok ? "border-success/30 bg-success-light" : "border-error/30 bg-error-light",
      )}
    >
      {/* The label, not just the message. Several panels can fail with copy
          that reads alike — "Impossible d'identifier le numéro" could come
          from the identify probe or from registration rejecting the number,
          and those are different problems. */}
      <p className={cn("flex items-start gap-2 font-medium", result.ok ? "text-success" : "text-error")}>
        {result.ok ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
        ) : (
          <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
        )}
        <span>
          <span className="opacity-70">{result.label}: </span>
          <span>{result.detail}</span>
        </span>
      </p>
      {result.payload != null && (
        <pre className="mt-2 max-h-48 overflow-auto rounded bg-surface p-2 font-mono text-[11px] text-text-secondary">
          {JSON.stringify(result.payload, null, 2)}
        </pre>
      )}

      {result.request != null && <SupportReport result={result} />}
    </div>
  );
}

/**
 * The exchange, formatted for a support thread.
 *
 * When CamerPay answers 502 the first thing support asks is "show me the
 * request you sent" — and reconstructing it from memory is how the wrong
 * thing gets debugged. This is the real one, captured as it went out, with
 * the token and any password replaced by a visible «redacted» marker so it
 * can be pasted into a chat without leaking a credential.
 */
function SupportReport({ result }: { result: ProbeResult }) {
  const [copied, setCopied] = useState(false);

  const report = JSON.stringify(
    { request: result.request, response: result.response ?? result.payload },
    null,
    2,
  );

  return (
    <details className="mt-3 rounded-md border border-border bg-surface">
      <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-text-secondary">
        <span>Request &amp; response — for CamerPay support</span>
      </summary>

      <div className="border-t border-border p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              navigator.clipboard.writeText(report).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
          >
            <Copy className="size-3.5" aria-hidden />
            <span>{copied ? "Copied" : "Copy for support"}</span>
          </Button>
          <span className="text-xs text-text-light">
            Token and password are replaced by «redacted».
          </span>
        </div>

        <pre className="max-h-80 overflow-auto rounded bg-surface-2 p-2 font-mono text-[11px] break-all whitespace-pre-wrap text-text-secondary">
          {report}
        </pre>
      </div>
    </details>
  );
}

/**
 * Starting points for the raw console — a real payload for every call, so the
 * job is replacing 6XXXXXXXX with a number rather than writing JSON by hand.
 *
 * Placeholders are deliberately obvious (`6XXXXXXXX`, `MOT_DE_PASSE_FORT`).
 * A preset carrying a plausible REAL-looking number is one mis-click away from
 * charging somebody.
 */
const PRESETS: {
  label: string;
  service: string;
  action: string;
  data: string;
  authenticated: boolean;
  /** True when the call needs the PROVISIONAL token, not the session one. */
  needsToken?: boolean;
}[] = [
  {
    label: "inscription",
    service: "authentification",
    action: "inscription",
    data: '{ "numero": "6XXXXXXXX", "parrain": "6YYYYYYYY", "pass": "MOT_DE_PASSE_FORT" }',
    authenticated: false,
  },
  {
    label: "inscription (no sponsor)",
    service: "authentification",
    action: "inscription",
    data: '{ "numero": "6XXXXXXXX", "pass": "MOT_DE_PASSE_FORT" }',
    authenticated: false,
  },
  {
    label: "validation",
    service: "authentification",
    action: "validation",
    data: '{ "code": "1234" }',
    authenticated: false,
    needsToken: true,
  },
  {
    label: "login",
    service: "authentification",
    action: "login",
    data: '{ "numero": "6XXXXXXXX", "pass": "MOT_DE_PASSE_FORT" }',
    authenticated: false,
  },
  { label: "balance", service: "account", action: "balance", data: "", authenticated: true },
  {
    label: "identifier",
    service: "transaction",
    action: "identifier",
    data: '{ "numero": "6XXXXXXXX" }',
    authenticated: true,
  },
  {
    label: "retrait (charge)",
    service: "transaction",
    action: "retrait",
    data: '{ "numeroClient": "6XXXXXXXX", "montant": 500 }',
    authenticated: true,
  },
  {
    label: "change_callback",
    service: "account",
    action: "change_callback",
    data: '{ "callbackURL": "https://your-domain.cm/api/webhooks/camerpay" }',
    authenticated: true,
  },
  { label: "change_token", service: "account", action: "change_token", data: "", authenticated: true },
  {
    label: "rapport",
    service: "rapport",
    action: "transaction",
    data: '{ "limit": 10 }',
    authenticated: true,
  },
];

/** One transaction started from this console. */
interface RecentTx {
  replyTo: string;
  kind: "collect" | "payout";
  phone: string;
  amount: number;
  /** Formatted when it happened — reading a clock during render is impure. */
  at: string;
  /** The same instant, machine-readable, for matching the report row. */
  startedAt: string;
  /** Report counter before the call — the reliable way to find our row. */
  afterId?: number;
}

/** The five jobs this console does, in the order you do them. */
const SECTIONS = [
  { id: "auth", label: "Authentication", icon: KeyRound },
  { id: "setup", label: "Setup", icon: Link2 },
  { id: "collect", label: "Collect from a client", icon: ArrowDownToLine },
  { id: "withdraw", label: "Withdraw to a wallet", icon: ArrowUpFromLine },
  { id: "tools", label: "Reports & raw calls", icon: ScrollText },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

/** Probes that take no input, so they can be dispatched by key. */
const SIMPLE_PROBES = {
  login: probeLogin,
  balance: probeBalance,
  transactions: () => probeReport("transaction"),
  notifications: () => probeReport("notification"),
} satisfies Record<string, () => Promise<ProbeResult>>;

export function CamerPayConsole({
  suggestedCallback,
  build,
  withdrawalFee,
}: {
  suggestedCallback: string;
  build: string;
  /** The withdrawal-fee dial (migration 0020), read by the server page. */
  withdrawalFee: { enabled: boolean; percent: number };
}) {
  const [section, setSection] = useState<SectionId>("auth");
  const [pending, startTransition] = useTransition();
  const [results, setResults] = useState<Record<string, ProbeResult>>({});
  const [running, setRunning] = useState<string | null>(null);

  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("500");
  const [replyTo, setReplyTo] = useState("");
  const [watching, setWatching] = useState<RecentTx | null>(null);
  const [payoutPhone, setPayoutPhone] = useState("");
  const [payoutAmount, setPayoutAmount] = useState("500");
  const [watchingPayout, setWatchingPayout] = useState<RecentTx | null>(null);

  /**
   * Everything charged or sent from this console, newest first.
   *
   * Session-scoped and deliberately so: it is a worktop for the person testing
   * right now, not an audit trail. The durable record is CamerPay's own report
   * and payment_webhook_events — this exists so a replyTo never has to be
   * copied out of a result box by hand.
   */
  const [recent, setRecent] = useState<RecentTx[]>([]);
  const [callback, setCallback] = useState(suggestedCallback);

  const [suNumero, setSuNumero] = useState("");
  const [suParrain, setSuParrain] = useState("");
  const [suPass, setSuPass] = useState("");
  const [suToken, setSuToken] = useState("");
  const [suCode, setSuCode] = useState("");
  const [issuedToken, setIssuedToken] = useState("");
  const [revealedToken, setRevealedToken] = useState("");

  const [rawService, setRawService] = useState("authentification");
  const [rawAction, setRawAction] = useState("inscription");
  const [rawData, setRawData] = useState("");
  const [rawAuthed, setRawAuthed] = useState(false);
  const [rawToken, setRawToken] = useState("");
  const [rawNeedsToken, setRawNeedsToken] = useState(false);

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

  /** Newest first, capped — a testing worktop, not a ledger. */
  function remember(tx: RecentTx) {
    setRecent((current) => [tx, ...current.filter((t) => t.replyTo !== tx.replyTo)].slice(0, 8));
  }

  /** Bring an earlier transaction back under the watcher. */
  function reopen(tx: RecentTx) {
    setReplyTo(tx.replyTo);
    setSection(tx.kind === "payout" ? "withdraw" : "collect");
    if (tx.kind === "payout") setWatchingPayout(tx);
    else setWatching(tx);
  }

  /** Login, but asking for the token in full so it can be copied. */
  const revealLogin = () =>
    run("reveal", async () => {
      const result = await probeLogin(true);
      if (result.provisionalToken) setRevealedToken(result.provisionalToken);
      return result;
    });

  const payoutValue = Number(payoutAmount);

  // The withdrawal fee is a dial in settings (migration 0020). The console
  // computes the same math the server action enforces at send time — the one
  // shared function (withdrawal-fee.ts) feeds both, so the numbers on screen
  // are the numbers that will move. Fee = gross × %, rounded to whole francs;
  // the recipient gets the net.
  const feeEnabled = withdrawalFee.enabled && withdrawalFee.percent > 0;
  const { fee: payoutFee, net: payoutNet } = computeWithdrawalFee(
    payoutValue,
    feeEnabled ? withdrawalFee.percent : 0,
  );
  const payoutValid =
    Number.isInteger(payoutValue) &&
    payoutValue >= 500 &&
    payoutValue <= 500_000 &&
    // With a fee, the SENT amount must still clear CamerPay's minimum — the
    // server refuses exactly this case, so the button must refuse it first.
    payoutNet >= 500;

  const amountValue = Number(amount);
  const amountValid = Number.isInteger(amountValue) && amountValue >= 500 && amountValue <= 500_000;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      {/* Which commit is actually serving this page. */}
      <p className="font-mono text-[11px] text-text-light">
        <span>build {build}</span>
      </p>

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
      {/*
        Appears only once something has been sent, and disappears with the
        session. A permanently visible empty "no recent transactions" box is
        furniture; a list that shows up the moment it has something to say is
        an answer.
      */}
      {recent.length > 0 && (
        <Card className="border-primary/30">
          <CardBody>
            <p className="text-[11px] font-bold tracking-[0.08em] text-text-light uppercase">
              This session
            </p>

            <ul className="mt-3 flex flex-col divide-y divide-border">
              {recent.map((tx) => (
                <li
                  key={tx.replyTo}
                  className="flex flex-col gap-2 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-4"
                >
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
                      tx.kind === "collect"
                        ? "bg-success-light text-success"
                        : "bg-warning-light text-warning",
                    )}
                  >
                    {tx.kind === "collect" ? (
                      <ArrowDownToLine className="size-3.5" aria-hidden />
                    ) : (
                      <ArrowUpFromLine className="size-3.5" aria-hidden />
                    )}
                    <span>{tx.kind === "collect" ? "In" : "Out"}</span>
                  </span>

                  <span className="tnum min-w-0 flex-1 text-sm">
                    <span className="font-semibold">{tx.amount.toLocaleString("fr-CM")} FCFA</span>
                    <span className="text-text-secondary"> · {tx.phone}</span>
                    <span className="block font-mono text-[11px] break-all text-text-light">
                      {tx.replyTo}
                    </span>
                  </span>

                  <span className="tnum shrink-0 text-xs text-text-light">{tx.at}</span>

                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => reopen(tx)}
                  >
                    <RefreshCw className="size-3.5" aria-hidden />
                    <span>Check</span>
                  </Button>
                </li>
              ))}
            </ul>

            <p className="mt-3 text-xs text-text-light">
              <span>
                The newest is already filled into &ldquo;Check a transaction&rdquo; and is being
                watched automatically. Press Check on any older one to bring it back.
              </span>
            </p>
          </CardBody>
        </Card>
      )}

      {/* ── Sections ─────────────────────────────────────────────────────
          The page was ten panels in one column, and "Pay money out" sat
          between account creation and the raw console where nobody found it.
          Tabs put each job — prove who you are, point the callback, take
          money, send money, look at history — behind its own heading. Same
          pattern as /a/settings, on purpose: two control rooms that behave
          alike take half the learning. */}
      <div
        role="tablist"
        aria-label="CamerPay sections"
        className="no-scrollbar -mb-2 flex gap-1 overflow-x-auto border-b border-border"
      >
        {SECTIONS.map((tab) => {
          const isActive = tab.id === section;
          return (
            <button
              key={tab.id}
              role="tab"
              type="button"
              aria-selected={isActive}
              onClick={() => setSection(tab.id)}
              className={cn(
                "-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition-colors",
                isActive
                  ? "border-primary text-primary"
                  : "border-transparent text-text-secondary hover:text-text",
              )}
            >
              <tab.icon className="size-4" aria-hidden />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {section === "auth" && (
        <>

      <Panel title="Prove the credentials" description="Log in and read the balance. Start here — everything else needs a session.">
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

            <Field
              label="Sponsor number"
              htmlFor="su-parrain"
              hint="Optional. The existing CamerPay account referring this one — leave empty if you have none."
            >
              <Input
                id="su-parrain"
                value={suParrain}
                onChange={(e) => setSuParrain(e.target.value)}
                placeholder="6YYYYYYYY (optional)"
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
            disabled={pending || !suNumero.trim() || suPass.length < 6}
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
                  run("validate", async () => {
                    const result = await submitValidation({
                      code: suCode,
                      provisionalToken: suToken,
                    });
                    if (result.provisionalToken) setIssuedToken(result.provisionalToken);
                    return result;
                  })
                }
              >
                <Play className="size-4" aria-hidden />
                <span>2 · Confirm the code</span>
              </Button>

              {results.validate && <ResultLine result={results.validate} />}

              {/*
                Shown in full, once, on purpose. It is a live credential — but
                an account whose token you cannot read is an account you cannot
                use, and this console is admin-only.
              */}
              {issuedToken && (
                <div className="rounded-md border-2 border-success/40 bg-success-light p-3">
                  <p className="text-xs font-bold tracking-[0.08em] text-success uppercase">
                    Your authorisation token
                  </p>
                  <pre className="mt-2 overflow-auto rounded bg-surface p-2 font-mono text-xs break-all whitespace-pre-wrap">
                    {issuedToken}
                  </pre>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigator.clipboard.writeText(issuedToken)}
                    >
                      <Copy className="size-3.5" aria-hidden />
                      <span>Copy token</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        navigator.clipboard.writeText(`CAMERPAY_TOKEN=${issuedToken}`)
                      }
                    >
                      <Copy className="size-3.5" aria-hidden />
                      <span>Copy as env line</span>
                    </Button>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-success/90">
                    <span>
                      Set it as <code className="font-mono">CAMERPAY_TOKEN</code> in Vercel and in{" "}
                      <code className="font-mono">.env.local</code>, then redeploy. No account
                      number or password is needed when a token is set.
                    </span>
                  </p>
                </div>
              )}
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

      <Panel
        title="Get your token"
        description="Only needed if you want to set CAMERPAY_TOKEN. Login already works without it."
      >
        <CardBody className="flex flex-col gap-3">
          <p className="text-sm leading-relaxed text-text-secondary">
            <span>
              While <code className="font-mono text-xs">CAMERPAY_ACCOUNT_NUMBER</code> and{" "}
              <code className="font-mono text-xs">CAMERPAY_PASSWORD</code> are set, the app fetches
              a session itself and <strong className="text-text">no token variable is required</strong>.
              Reveal one only if you would rather deploy with a token and no password.
            </span>
          </p>

          <Button
            variant="outline"
            className="self-start"
            disabled={pending}
            loading={running === "reveal"}
            onClick={revealLogin}
          >
            <KeyRound className="size-4" aria-hidden />
            <span>Reveal my token</span>
          </Button>

          {results.reveal && <ResultLine result={results.reveal} />}

          {revealedToken && (
            <div className="rounded-md border-2 border-warning/40 bg-warning-light p-3">
              <p className="text-xs font-bold tracking-[0.08em] text-warning uppercase">
                Live credential — do not screenshot
              </p>
              <pre className="mt-2 overflow-auto rounded bg-surface p-2 font-mono text-xs break-all whitespace-pre-wrap">
                {revealedToken}
              </pre>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigator.clipboard.writeText(revealedToken)}
                >
                  <Copy className="size-3.5" aria-hidden />
                  <span>Copy token</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    navigator.clipboard.writeText(`CAMERPAY_TOKEN=${revealedToken}`)
                  }
                >
                  <Copy className="size-3.5" aria-hidden />
                  <span>Copy as env line</span>
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setRevealedToken("")}>
                  <span>Hide</span>
                </Button>
              </div>
            </div>
          )}
        </CardBody>
      </Panel>

        </>
      )}

      {section === "setup" && (
        <>

      <Panel
        title="Where CamerPay calls back"
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

        </>
      )}

      {section === "collect" && (
        <>

      <Panel title="Identify a number" description="Free. Confirms the operator before charging.">
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

      <Panel
        title="Charge a client"
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
            onClick={() =>
              run("collect", async () => {
                const result = await probeCollection(phone, amountValue);
                // Verification starts on its own the moment a charge is
                // accepted — the operator should never have to remember to
                // go and ask whether it worked.
                const id = result.trackingId;
                if (result.ok && id) {
                  const now = new Date();
                  const tx: RecentTx = {
                    replyTo: id,
                    kind: "collect",
                    phone,
                    amount: amountValue,
                    at: now.toLocaleTimeString(),
                    startedAt: result.startedAt ?? now.toISOString(),
                    afterId: result.afterId,
                  };
                  setWatching(tx);
                  // Prefilled, so "check this one" never means retyping a
                  // tracking id off the screen above it.
                  setReplyTo(id);
                  remember(tx);
                }
                return result;
              })
            }
          >
            <Play className="size-3.5" aria-hidden />
            <span>Charge {amount} FCFA for real</span>
          </Button>
          {results.collect && <ResultLine result={results.collect} />}
          {watching && (
            <TransactionWatcher
              key={watching.replyTo}
              replyTo={watching.replyTo}
              hint={{
                phone: watching.phone,
                amount: watching.amount,
                direction: watching.kind,
                startedAt: watching.startedAt,
                afterId: watching.afterId,
              }}
            />
          )}
        </CardBody>
      </Panel>

      <Panel
        title="Check a transaction"
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
            onClick={() => {
              // A one-shot answer AND the watcher, because the usual reason
              // to paste a replyTo in here is that it was pending last time.
              const known = recent.find((t) => t.replyTo === replyTo.trim());
              if (known) setWatching(known);
              run("confirm", () =>
                probeConfirm(
                  replyTo,
                  known
                    ? {
                        phone: known.phone,
                        amount: known.amount,
                        direction: known.kind,
                        startedAt: known.startedAt,
                        afterId: known.afterId,
                      }
                    : // Fall back to whatever is typed into the charge fields —
                      // without a number and an amount there is nothing to
                      // match a row on.
                      { phone, amount: amountValue, direction: "collect" },
                ),
              );
            }}
          >
            <Play className="size-3.5" aria-hidden />
            <span>Ask CamerPay</span>
          </Button>
          {results.confirm && <ResultLine result={results.confirm} />}
        </CardBody>
      </Panel>

        </>
      )}

      {section === "withdraw" && (
        <>

      <Panel
        title="Withdraw to a wallet"
        description="`depot` — the opposite direction. Money leaves YOUR balance."
      >
        <CardBody className="flex flex-col gap-4">
          <div className="rounded-md border-2 border-error/30 bg-error-light p-3 text-sm text-error">
            <p className="font-bold">This spends your balance.</p>
            <p className="mt-1 opacity-90">
              <span>
                Collections (<code className="font-mono text-xs">retrait</code>) pull money IN from
                a customer. This sends it back OUT — a refund, a payout to a restaurant, or moving
                your own money to your own wallet. Same 500&ndash;500 000 FCFA limits, same absence
                of a sandbox.
              </span>
            </p>
          </div>

          {feeEnabled && (
            <div className="rounded-md border border-warning/30 bg-warning-light p-3 text-sm text-warning">
              <span>
                <strong>Withdrawal fee: {withdrawalFee.percent}%.</strong> Withheld from the amount
                below — the recipient receives the net, the fee stays in the platform balance.
                Pay-ins (<code className="font-mono text-xs">retrait</code>) are always free.
              </span>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Destination number" htmlFor="po-phone" required hint="9 digits, starts with 6.">
              <Input
                id="po-phone"
                value={payoutPhone}
                onChange={(e) => setPayoutPhone(e.target.value)}
                placeholder="6XXXXXXXX"
                inputMode="numeric"
              />
            </Field>

            <Field
              label="Amount the recipient is owed (FCFA)"
              htmlFor="po-amount"
              required
              hint={`500 minimum, 500 000 maximum.${feeEnabled ? " The fee is withheld from this." : ""}`}
            >
              <Input
                id="po-amount"
                type="number"
                min={500}
                max={500000}
                step={1}
                inputMode="numeric"
                value={payoutAmount}
                onChange={(e) => setPayoutAmount(e.target.value)}
              />
            </Field>
          </div>

          {feeEnabled && Number.isFinite(payoutValue) && payoutValue > 0 && (
            <div className="rounded-md border border-border bg-surface-2 p-3 text-sm">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-text-secondary">Recipient is owed (gross)</span>
                <span className="tnum font-semibold">{payoutValue.toLocaleString("fr-CM")} FCFA</span>
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-4">
                <span className="text-text-secondary">Platform fee ({withdrawalFee.percent}%)</span>
                <span className="tnum font-semibold text-text-light">
                  − {payoutFee.toLocaleString("fr-CM")} FCFA
                </span>
              </div>
              <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-border pt-2">
                <span className="font-semibold">Recipient receives</span>
                <span
                  className={cn(
                    "tnum font-semibold",
                    payoutNet >= 500 ? "text-success" : "text-error",
                  )}
                >
                  {payoutNet.toLocaleString("fr-CM")} FCFA
                </span>
              </div>
              {payoutNet > 0 && payoutNet < 500 && (
                <p className="mt-2 text-xs text-error">
                  Below CamerPay&apos;s 500 FCFA minimum after the fee — raise the amount.
                </p>
              )}
            </div>
          )}

          <Button
            variant="danger"
            className="self-start"
            disabled={pending || !payoutPhone.trim() || !payoutValid}
            loading={running === "payout"}
            onClick={() =>
              run("payout", async () => {
                const result = await probePayout(payoutPhone, payoutValue);
                const id = (result.payload as { replyTo?: string } | undefined)?.replyTo;
                if (result.ok && id) {
                  const now = new Date();
                  const tx: RecentTx = {
                    replyTo: id,
                    kind: "payout",
                    phone: payoutPhone,
                    // The NET is what left the balance — and what the watcher
                    // needs to match the row in CamerPay's report.
                    amount: result.fee?.net ?? payoutValue,
                    at: now.toLocaleTimeString(),
                    startedAt: now.toISOString(),
                    afterId: result.afterId,
                  };
                  setWatchingPayout(tx);
                  setReplyTo(id);
                  remember(tx);
                }
                return result;
              })
            }
          >
            <Play className="size-4" aria-hidden />
            <span>
              Send {payoutValid ? payoutNet.toLocaleString("fr-CM") : "…"} FCFA
              {feeEnabled && payoutValid ? ` (${payoutFee.toLocaleString("fr-CM")} fee)` : ""}
            </span>
          </Button>

          {results.payout && <ResultLine result={results.payout} />}
          {watchingPayout && (
            <TransactionWatcher
              key={watchingPayout.replyTo}
              replyTo={watchingPayout.replyTo}
              hint={{
                phone: watchingPayout.phone,
                amount: watchingPayout.amount,
                direction: watchingPayout.kind,
                startedAt: watchingPayout.startedAt,
                afterId: watchingPayout.afterId,
              }}
            />
          )}
        </CardBody>
      </Panel>

        </>
      )}

      {section === "tools" && (
        <>

      <Panel title="History" description="Raw transaction and notification history.">
        <CardBody>
          <div className="flex flex-wrap gap-2">
            {action("transactions", "Transactions")}
            {action("notifications", "Notifications")}
          </div>
          {results.transactions && <ResultLine result={results.transactions} />}
          {results.notifications && <ResultLine result={results.notifications} />}
        </CardBody>
      </Panel>

      <Panel
        title="Send any call by hand"
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
                  setRawNeedsToken(Boolean(preset.needsToken));
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

          <Field
            label="Token override"
            htmlFor="raw-token"
            hint="For validation, paste the provisional token from inscription. Leave empty to use the logged-in session."
          >
            <Input
              id="raw-token"
              value={rawToken}
              onChange={(e) => setRawToken(e.target.value)}
              placeholder={rawNeedsToken ? "TOKEN_PROVISOIRE — required for this action" : "(optional)"}
              className={rawNeedsToken && !rawToken.trim() ? "border-warning" : undefined}
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
                  token: rawToken,
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

        </>
      )}


    </div>
  );
}
