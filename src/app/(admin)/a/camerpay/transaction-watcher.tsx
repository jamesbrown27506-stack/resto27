"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { checkTransaction, type TransactionStatus } from "./actions";
import type { TransactionHint } from "@/lib/payments/camerpay/client";
import { cn } from "@/lib/utils";

/**
 * Watch one transaction until CamerPay gives a final answer.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  ONE SELF-DRIVING LOOP. NOTHING FOR REACT TO CANCEL.
 *
 *  This component has now been broken twice by the same family of bug:
 *
 *   1. `hint` (an object literal at the call site) sat in a dependency list,
 *      so every parent render rebuilt the callback, re-ran the effect, and
 *      the cleanup cancelled the timer before it could fire.
 *   2. The poll ran inside `startTransition(async () => …)`, and the state
 *      updates queued after the `await` were swallowed with the transition —
 *      the panel showed a fetched result while the counter swore no check
 *      had ever run.
 *
 *  Both were the scheduling being spread across reactive machinery — a
 *  useCallback feeding a useEffect feeding a timer, each hop something React
 *  may legitimately rebuild, cancel, or defer. So the loop is now ONE effect
 *  whose dependencies are primitives, driving itself with its own local
 *  counter and its own setTimeout chain. React can interrupt it at exactly
 *  one point — unmount — and that is the one point where stopping is correct.
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  The callback and this poll are two halves of one mechanism: the callback
 *  is fast but can be lost; the poll always arrives. Both end at the same
 *  verification against CamerPay, so no status is believed rather than
 *  checked.
 */

/**
 * The first check is immediate — a mobile-money prompt is often answered
 * before the operator has looked up, and a countdown before anything happens
 * is what makes a working poller feel broken. Then tight while the PIN prompt
 * is plausibly on screen, stretching out once the customer has wandered off.
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
   * What we know about the request. Needed in practice: CamerPay's report
   * does not echo the tracking id, so a row is found by number, amount,
   * direction and the report counter as it stood before we asked.
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
   *  THE REACT COMPILER IS OPTED OUT OF THIS COMPONENT, WITH EVIDENCE.
   *
   *  A live session rendered "No response after 11 checks" — a branch that
   *  only exists when `attempts` has reached 11 — beside "check 0 / 11" and a
   *  `last` timestamp frozen at the FIRST check. The same state cannot be 11
   *  and 0 in one frame: the compiled output was reusing stale memo blocks
   *  for part of the tree while re-evaluating its siblings.
   *
   *  On most screens a stale label is cosmetic. This panel is the instrument
   *  someone reads to decide whether money moved, and an instrument that can
   *  disagree with itself is worse than none — it had us debugging a working
   *  poller for an afternoon. Memoisation buys nothing here worth that.
   * ─────────────────────────────────────────────────────────────────────────
   */
  "use no memo";

  // Primitives, never the object — `hint` is a literal at the call site and
  // changes identity every parent render. Primitives compare by value, so the
  // loop below restarts only when the transaction itself changes.
  const phone = hint?.phone;
  const amount = hint?.amount;
  const direction = hint?.direction;
  const startedAt = hint?.startedAt;
  const afterId = hint?.afterId;

  const [result, setResult] = useState<TransactionStatus | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(true);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  /** One line per completed check — the panel's own flight recorder. */
  const [history, setHistory] = useState<{ n: number; at: string; status: string }[]>([]);

  /** Set on a terminal answer, readable by BOTH the loop and a manual check. */
  const doneRef = useRef(false);

  /** Latest callback without it being a reason to restart the loop. */
  const onSettledRef = useRef(onSettled);
  useEffect(() => {
    onSettledRef.current = onSettled;
  }, [onSettled]);

  const settled = result?.status === "success" || result?.status === "failed";
  const exhausted = attempts >= MAX_ATTEMPTS && !settled;

  useEffect(() => {
    if (!auto) return;

    let cancelled = false;
    let timer = 0;
    // The loop's own counter. Local, so no render cycle sits between one tick
    // and the scheduling of the next; the state copy exists only for display.
    let attempt = 0;

    doneRef.current = false;

    const tick = async () => {
      if (cancelled || doneRef.current) return;

      setBusy(true);
      let next: TransactionStatus | null = null;
      try {
        next = await checkTransaction(replyTo, { phone, amount, direction, startedAt, afterId });
      } catch {
        // A failed CHECK is not a failed PAYMENT. The attempt still counts,
        // so the schedule keeps moving instead of freezing on a blip.
      }
      if (cancelled) return;

      attempt += 1;
      const stamp = new Date().toLocaleTimeString();
      setAttempts(attempt);
      setBusy(false);
      setCheckedAt(stamp);
      setHistory((h) => [...h.slice(-14), { n: attempt, at: stamp, status: next?.status ?? "error" }]);

      if (next) {
        setResult(next);
        if (next.status !== "pending") {
          doneRef.current = true;
          onSettledRef.current?.(next);
          return;
        }
      }

      if (attempt >= MAX_ATTEMPTS) return;
      timer = window.setTimeout(() => void tick(), delayFor(attempt));
    };

    // Deferred one macrotask so no setState fires synchronously inside the
    // effect body — and the very first check still lands near-immediately.
    timer = window.setTimeout(() => void tick(), 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [auto, replyTo, phone, amount, direction, startedAt, afterId]);

  /**
   * Manual check — plain async, no transition, nothing shared with the loop
   * except the terminal flag. Every payment console has this button, because
   * an operator watching a customer's face needs the answer now, not at the
   * next tick.
   */
  async function checkNow() {
    setBusy(true);
    try {
      const next = await checkTransaction(replyTo, {
        phone,
        amount,
        direction,
        startedAt,
        afterId,
      });
      setResult(next);
      const stamp = new Date().toLocaleTimeString();
      setCheckedAt(stamp);
      setHistory((h) => [...h.slice(-14), { n: h.length + 1, at: stamp, status: `${next.status} (manual)` }]);
      if (next.status !== "pending") {
        doneRef.current = true;
        setAuto(false);
        onSettledRef.current?.(next);
      }
    } finally {
      setAttempts((n) => n + 1);
      setBusy(false);
    }
  }

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
            <span>tracking {replyTo}</span>
            <span>
              {" "}
              · check {attempts}/{MAX_ATTEMPTS}
            </span>
            {checkedAt && <span> · last {checkedAt}</span>}
            {afterId !== undefined && <span> · after #{afterId}</span>}
            {/* v4 — so a screenshot of this panel says which watcher it is.
                Chasing a fixed bug through a stale deploy cost an afternoon. */}
            <span> · v4</span>
          </p>

          {/* Appended, never rewritten: each check leaves its own line, so the
              sequence the server actually answered is on screen — the record
              that settles "did it ever say success" without a debugger. */}
          {history.length > 0 && (
            <ul className="mt-1 font-mono text-[11px] leading-relaxed opacity-75">
              {history.map((h) => (
                <li key={`${h.n}-${h.at}`}>
                  <span>#{h.n}</span>
                  <span> {h.at} </span>
                  <span>{h.status}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Without these there is nothing to match a report row on, and the
              check can only ever say pending. Saying so beats looking busy. */}
          {amount === undefined && (
            <p className="mt-1 text-xs font-semibold opacity-90">
              <span>
                No amount was captured for this transaction, so its report row cannot be matched.
              </span>
            </p>
          )}

          {exhausted && (
            <p className="mt-1 text-xs opacity-90">
              <span>
                No answer after {MAX_ATTEMPTS} checks. That does not mean it failed — check again,
                or look at the transaction report. A debited customer with no result here is exactly
                what the reconciler is for.
              </span>
            </p>
          )}

          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" loading={busy} onClick={() => void checkNow()}>
              <RefreshCw className="size-3.5" aria-hidden />
              <span>Check now</span>
            </Button>

            {!settled && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  // Resuming restarts the schedule from the top — the effect
                  // re-runs on `auto` and its local counter starts at zero.
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
