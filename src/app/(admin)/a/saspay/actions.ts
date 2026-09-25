"use server";

import { randomUUID } from "node:crypto";
import { requireRole, superAdminOrError } from "@/lib/auth/session";
import { writeAudit } from "@/lib/data/platform-actions";
import { normalisePhone } from "@/lib/payments/camerpay/client";
import { cameroonNetwork, SASPAY_MAX_XAF, SASPAY_MIN_XAF } from "@/lib/payments/saspay/cameroon";
import {
  saspayCameroonBalance,
  saspayCameroonRates,
  saspayPing,
  saspayRecentTransactions,
  saspayWebhookLogs,
  startSaspayPayment,
  startSaspayPayout,
  verifySaspayPayment,
  verifySaspayPayout,
} from "@/lib/payments/saspay/client";

/**
 * SasPay console (/a/saspay) — the counterpart of the CamerPay console.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  Reads (connection, rates, balance, recent transactions, webhook
 *  deliveries) are open to every admin. The two TESTS move real money on a
 *  live key — a collection charges the number typed in, a payout sends
 *  from the platform's SasPay balance — so, like the CamerPay console's,
 *  they are super-admin only and audited.
 *
 *  Tests talk to SasPay directly and write NOTHING to payment_attempts or
 *  refunds: a test payment is not an order, and must never settle one. It
 *  still appears in SasPay's own transaction list below.
 * ─────────────────────────────────────────────────────────────────────────
 */

export interface ConsoleResult {
  ok: boolean;
  label: string;
  detail: string;
  /** SasPay transaction id, for the status check that follows a test. */
  id?: string;
  status?: "success" | "failed" | "pending";
  checkoutUrl?: string | null;
  payload?: unknown;
}

function checkInput(phone: string, amount: number): { phone: string } | { error: string } {
  const normalised = normalisePhone(phone);
  if (!normalised) return { error: "Enter a Cameroon mobile number (9 digits starting with 6)." };
  if (!cameroonNetwork(normalised)) return { error: "Only MTN (67x, 68x, 650–654) and Orange (69x, 655–659) numbers are supported." };
  if (!Number.isInteger(amount) || amount < SASPAY_MIN_XAF || amount > SASPAY_MAX_XAF) {
    return { error: `Amount must be a whole number between ${SASPAY_MIN_XAF} and ${SASPAY_MAX_XAF.toLocaleString("fr-CM")} FCFA.` };
  }
  return { phone: normalised };
}

export async function consoleOverview() {
  await requireRole("admin");
  const [ping, rates, balance, transactions, webhooks] = await Promise.all([
    saspayPing(),
    saspayCameroonRates().catch((e) => ({ ok: false as const, error: { code: "error", message: String(e), status: 0 } })),
    saspayCameroonBalance().catch((e) => ({ ok: false as const, error: { code: "error", message: String(e), status: 0 } })),
    saspayRecentTransactions(20).catch((e) => ({ ok: false as const, error: { code: "error", message: String(e), status: 0 } })),
    saspayWebhookLogs(15).catch((e) => ({ ok: false as const, error: { code: "error", message: String(e), status: 0 } })),
  ]);
  const errorOf = (r: { ok: boolean; error?: { code: string; message: string } }) =>
    r.ok ? null : `${r.error?.code}: ${r.error?.message}`;
  return {
    ping,
    rates: rates.ok ? rates.data : null,
    ratesError: errorOf(rates),
    balance: balance.ok ? balance.data : null,
    balanceError: errorOf(balance),
    transactions: transactions.ok ? transactions.data : null,
    transactionsError: errorOf(transactions),
    webhooks: webhooks.ok ? webhooks.data : null,
    webhooksError: errorOf(webhooks),
  };
}

export async function testCollection(phone: string, amount: number): Promise<ConsoleResult> {
  const gate = await superAdminOrError();
  if (!gate.ok) return { ok: false, label: "Refused", detail: gate.error };
  const checked = checkInput(phone, amount);
  if ("error" in checked) return { ok: false, label: "Invalid input", detail: checked.error };

  try {
    const result = await startSaspayPayment({
      phone: checked.phone,
      amount,
      idempotencyKey: `console-${randomUUID()}`,
      description: "Resto237 admin test",
      customer: { firstName: "Test", lastName: "Resto237", email: gate.admin.email },
      metadata: { console: true, admin: gate.admin.email },
    });
    await writeAudit(gate.admin, {
      action: "saspay.test_collection",
      entityType: "payment",
      summary: `SasPay test collection of ${amount} FCFA from ${checked.phone}`,
      metadata: { ok: result.ok, id: result.ok ? result.data.id : undefined },
    });
    if (!result.ok) {
      return { ok: false, label: `Refused (HTTP ${result.error.status})`, detail: `${result.error.code}: ${result.error.message}`, payload: result.error };
    }
    return {
      ok: true,
      label: result.data.checkoutUrl ? "Payment page returned" : "Prompt pushed to the phone",
      detail: result.data.checkoutUrl
        ? "This operator settles on a hosted page: open it to pay, then check the status."
        : result.data.instructions ?? "Approve the prompt on the phone, then check the status.",
      id: result.data.id,
      status: result.data.status,
      checkoutUrl: result.data.checkoutUrl,
      payload: result.data,
    };
  } catch (error) {
    return { ok: false, label: "Unreachable", detail: error instanceof Error ? error.message : String(error) };
  }
}

export async function testPayout(phone: string, amount: number): Promise<ConsoleResult> {
  const gate = await superAdminOrError();
  if (!gate.ok) return { ok: false, label: "Refused", detail: gate.error };
  const checked = checkInput(phone, amount);
  if ("error" in checked) return { ok: false, label: "Invalid input", detail: checked.error };

  try {
    const result = await startSaspayPayout({
      phone: checked.phone,
      amount,
      idempotencyKey: `console-payout-${randomUUID()}`,
      description: "Resto237 admin test payout",
    });
    await writeAudit(gate.admin, {
      action: "saspay.test_payout",
      entityType: "payment",
      summary: `SasPay test payout of ${amount} FCFA to ${checked.phone}`,
      metadata: { ok: result.ok, id: result.ok ? result.data.id : undefined },
    });
    if (!result.ok) {
      const hint =
        result.error.code === "ip_not_whitelisted"
          ? " — whitelist this server's outgoing IP in the SasPay dashboard (Vercel needs Static IPs for that)."
          : "";
      return { ok: false, label: `Refused (HTTP ${result.error.status})`, detail: `${result.error.code}: ${result.error.message}${hint}`, payload: result.error };
    }
    return {
      ok: true,
      label: "Payout accepted",
      detail: "Check the status in a few seconds.",
      id: result.data.id,
      status: result.data.status,
      payload: result.data,
    };
  } catch (error) {
    return { ok: false, label: "Unreachable", detail: error instanceof Error ? error.message : String(error) };
  }
}

export async function checkStatus(kind: "collection" | "payout", id: string): Promise<ConsoleResult> {
  await requireRole("admin");
  if (!/^[A-Za-z0-9-]{6,80}$/.test(id)) return { ok: false, label: "Invalid id", detail: "Paste a SasPay transaction id." };
  try {
    const result = kind === "collection" ? await verifySaspayPayment(id) : await verifySaspayPayout(id);
    if (!result.ok) {
      return { ok: false, label: `HTTP ${result.error.status}`, detail: `${result.error.code}: ${result.error.message}` };
    }
    const v = result.data;
    return {
      ok: true,
      label: v.verdict === "success" ? "SUCCESS" : v.verdict === "failed" ? "FAILED" : "PENDING",
      detail: `Requested ${Number.isFinite(v.requested) ? v.requested : "?"} FCFA${v.msisdn ? ` · ${v.msisdn}` : ""}`,
      id: v.id,
      status: v.verdict,
      payload: v.raw,
    };
  } catch (error) {
    return { ok: false, label: "Unreachable", detail: error instanceof Error ? error.message : String(error) };
  }
}
