"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { CheckCircle2, Clock, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { checkTransaction, type TransactionStatus } from "./actions";
import type { TransactionHint } from "@/lib/payments/camerpay/client";
import { cn } from "@/lib/utils";

/**
 * Watch one transaction until CamerPay gives a final answer.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  BOTH ROUTES, BECAUSE NEITHER IS SUFFICIENT ALONE.
 *
 *  The callback is fast but can be lost — delivered to a URL that was briefly
 *  down, or never sent at all. Polling always arrives but wastes calls if it
 *  is the only mechanism. So this polls, the callback settles things sooner
 *  when it works, and both end at the same verification against CamerPay.
 *
 *  It stops on its own. A poller with no ceiling is a poller that is still
 *  running tomorrow against a transaction nobody remembers, and on a provider
 *  with rate limits that is how the account gets throttled.
 * ─────────────────────────────────────────────────────────────────────────
 */

/**
 * Backing off rather than a fixed interval.
 *
 * A mobile-money prompt is usually answered within about thirty seconds, so
 * the early checks are close together where the answer probably is. After
 * that the customer is distracted or gone and hammering the API buys nothing.
 */
const SCHEDULE_MS = [3_000, 3_000, 4_000, 5_000, 6_000, 8_000, 10_000, 15_000, 20_000, 30_000];

/** Roughly two minutes of automatic watching. */
const MAX_ATTEMPTS = SCHEDULE_MS.length;

function delayFor(attempt: number): number {
  return SCHEDULE_MS[Math.min(attempt, SCHEDULE_MS.length - 1)];
}

export function TransactionWatcher({
  replyTo,
  /**
   * What we know about the request. REQUIRED in practice: CamerPay's report
   * does not echo the tracking id, so without the number, amount and
   * direction there is nothing to match a row on.
   */
  hint,
  /** Called once, when a terminal answer arrives. */
  onSettled,
}: {
  replyTo: string;
  hint?: TransactionHint;
  onSettled?: (status: TransactionStatus) => void;
}) {
  const [result, setResult] = useState<TransactionStatus | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [auto, setAuto] = useState(true);
  const [checking, startTransition] = useTransition();

  const settled = result?.status === "success" || result?.status === "failed";
  const exhausted = attempts >= MAX_ATTEMPTS;

  const check = useCallback(() => {
    startTransition(async () => {
      const next = await checkTransaction(replyTo, hint ?? {});
      setResult(next);
      setAttempts((n) => n + 1);
      if (next.status !== "pending") {
        setAuto(false);
        onSettled?.(next);
      }
    });
  }, [replyTo, hint, onSettled]);

  useEffect(() => {
    if (!auto || settled || exhausted) return;

    /**
     * setState happens inside the timer callback, never in the effect body —
     * the React Compiler rejects the latter, and scheduling rather than firing
     * immediately is also what makes the first check land after a delay
     * instead of racing the 202 that created this transaction.
     */
    const timer = window.setTimeout(check, delayFor(attempts));
    return () => window.clearTimeout(timer);
  }, [auto, settled, exhausted, attempts, check]);

  const tone = settled
    ? result?.status === "success"
      ? "border-success/40 bg-success-light text-success"
      : "border-error/40 bg-error-light text-error"
    : "border-warning/40 bg-warning-light text-warning";

  return (
    <div className={cn("mt-3 rounded-md border-2 p-3", tone)}>
      <div className="flex items-start gap-2">
        {settled ? (
          result?.status === "success" ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
          ) : (
            <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          )
        ) : (
          <Clock className={cn("mt-0.5 size-4 shrink-0", checking && "animate-spin")} aria-hidden />
        )}

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {settled ? (
              <span>{result?.status === "success" ? "Settled" : "Failed"}</span>
            ) : exhausted ? (
              <span>Stopped watching</span>
            ) : (
              <span>Waiting for CamerPay…</span>
            )}
          </p>

          <p className="mt-0.5 text-xs opacity-90">
            <span>
              {result?.detail ??
                "The customer approves on their handset. This checks every few seconds until CamerPay answers."}
            </span>
          </p>

          <p className="mt-1 font-mono text-[11px] break-all opacity-75">
            <span>replyTo {replyTo}</span>
            <span> · check {attempts}/{MAX_ATTEMPTS}</span>
          </p>

          {exhausted && !settled && (
            <p className="mt-1 text-xs opacity-90">
              <span>
                No answer after {MAX_ATTEMPTS} checks. That does not mean it failed — check again,
                or look at the transaction report. A debited customer with no result here is exactly
                what the reconciler is for.
              </span>
            </p>
          )}

          <div className="mt-2 flex flex-wrap gap-2">
            {/* Manual check, always available — every payment console has one,
                and an operator watching a customer's face needs an answer now
                rather than at the next tick. */}
            <Button variant="outline" size="sm" loading={checking} onClick={check}>
              <RefreshCw className="size-3.5" aria-hidden />
              <span>Check now</span>
            </Button>

            {!settled && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (!auto) setAttempts(0);
                  setAuto((on) => !on);
                }}
              >
                <span>{auto ? "Pause auto-check" : "Resume auto-check"}</span>
              </Button>
            )}
          </div>
        </div>
      </div>

      {result?.raw != null && (
        <pre className="mt-2 max-h-40 overflow-auto rounded bg-surface p-2 font-mono text-[11px] whitespace-pre-wrap text-text-secondary">
          {JSON.stringify(result.raw, null, 2)}
        </pre>
      )}
    </div>
  );
}
