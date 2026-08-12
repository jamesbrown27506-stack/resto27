"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
 * The FIRST check is immediate — a prompt is often answered before the operator
 * has looked up, and a three-second countdown before anything happens is what
 * makes a working poller feel broken.
 *
 * A mobile-money prompt is usually answered within about thirty seconds, so
 * the early checks are close together where the answer probably is. After
 * that the customer is distracted or gone and hammering the API buys nothing.
 */
const SCHEDULE_MS = [0, 3_000, 3_000, 4_000, 5_000, 6_000, 8_000, 10_000, 15_000, 20_000, 30_000];

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
  /**
   * ─────────────────────────────────────────────────────────────────────────
   *  DESTRUCTURED TO PRIMITIVES, AND THAT IS THE WHOLE FIX.
   *
   *  `hint` is written at the call site as an object literal, so it has a new
   *  identity on every parent render. With the object itself in the dependency
   *  list, `check` was rebuilt each time, the effect re-ran, and its cleanup
   *  cancelled the pending timer — which was then rescheduled from zero. The
   *  counter sat at "check 0 / 10" because no check ever actually fired.
   *
   *  Primitives compare by value, so the identity churn stops here.
   * ─────────────────────────────────────────────────────────────────────────
   */
  const hintPhone = hint?.phone;
  const hintAmount = hint?.amount;
  const hintDirection = hint?.direction;
  const hintStartedAt = hint?.startedAt;
  const hintAfterId = hint?.afterId;

  const [result, setResult] = useState<TransactionStatus | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [auto, setAuto] = useState(true);
  const [busy, setBusy] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  /** Guards against setting state after the panel has gone. */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const settled = result?.status === "success" || result?.status === "failed";
  const exhausted = attempts >= MAX_ATTEMPTS;

  /**
   * ─────────────────────────────────────────────────────────────────────────
   *  NO useTransition, DELIBERATELY.
   *
   *  This polled inside `startTransition(async () => …)`. React treats work
   *  after an `await` in an async transition as outside that transition, and
   *  the counter never left "check 0 / 10" while the transaction it watched
   *  had visibly settled — the one number that would have shown the poll was
   *  dead was itself the thing that was broken.
   *
   *  A plain async function with its own `busy` flag has none of that
   *  subtlety. A progress indicator that cannot be trusted is worse than
   *  none: it reads as "still working" when nothing is working at all.
   * ─────────────────────────────────────────────────────────────────────────
   */
  const check = useCallback(async () => {
    setBusy(true);
    try {
      const next = await checkTransaction(replyTo, {
        phone: hintPhone,
        amount: hintAmount,
        direction: hintDirection,
        startedAt: hintStartedAt,
        afterId: hintAfterId,
      });
      if (!alive.current) return;

      setResult(next);
      setCheckedAt(new Date().toLocaleTimeString());
      if (next.status !== "pending") {
        setAuto(false);
        onSettled?.(next);
      }
    } catch {
      // A failed check is not a failed payment. The attempt still counts so
      // the schedule keeps moving.
    } finally {
      if (alive.current) {
        // In `finally`, so the counter advances even when the request threw.
        // A stuck counter is exactly the symptom that hid the last bug.
        setAttempts((n) => n + 1);
        setBusy(false);
      }
    }
  }, [replyTo, hintPhone, hintAmount, hintDirection, hintStartedAt, hintAfterId, onSettled]);

  useEffect(() => {
    if (!auto || settled || exhausted || busy) return;

    /**
     * setState happens inside the timer callback, never in the effect body —
     * the React Compiler rejects the latter, and scheduling rather than firing
     * immediately is also what makes the first check land after a delay
     * instead of racing the 202 that created this transaction.
     */
    const timer = window.setTimeout(() => void check(), delayFor(attempts));
    return () => window.clearTimeout(timer);
  }, [auto, settled, exhausted, busy, attempts, check]);

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
          <Clock className={cn("mt-0.5 size-4 shrink-0", busy && "animate-spin")} aria-hidden />
        )}

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {settled ? (
              <span>{result?.status === "success" ? "Settled" : "Not confirmed"}</span>
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
            <span>
              {" "}
              · check {attempts}/{MAX_ATTEMPTS}
            </span>
            {checkedAt && <span> · last {checkedAt}</span>}
            {hintAfterId !== undefined && <span> · after #{hintAfterId}</span>}
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
            <Button variant="outline" size="sm" loading={busy} onClick={() => void check()}>
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
