"use server";

import { requireRole } from "@/lib/auth/session";
import {
  confirmTransaction,
  getBalance,
  identifyNumber,
  listNotifications,
  listTransactions,
  login,
  maskToken,
  normalisePhone,
  requestDeposit,
  setCallbackUrl,
} from "@/lib/payments/camerpay/client";

/**
 * CamerPay console actions.
 *
 * Every one re-checks the admin role. A Server Action is a POST endpoint with
 * a generated URL — it does not pass through the layout that "guards" the
 * page, and these move real money.
 *
 * THERE IS NO SANDBOX. Every deposit here debits a real wallet, minimum
 * 500 FCFA. The UI says so; this file is where it would actually happen.
 */

export interface ProbeResult {
  ok: boolean;
  label: string;
  detail: string;
  payload?: unknown;
}

function fail(label: string, error: unknown): ProbeResult {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[camerpay:${label}]`, message);
  return { ok: false, label, detail: message };
}

export async function probeLogin(): Promise<ProbeResult> {
  await requireRole("admin");
  try {
    const token = await login();
    // Masked. A token in a log or a screenshot is a live credential.
    return { ok: true, label: "Login", detail: `Authenticated. Token ${maskToken(token)}` };
  } catch (error) {
    return fail("Login", error);
  }
}

export async function probeBalance(): Promise<ProbeResult> {
  await requireRole("admin");
  try {
    const response = await getBalance();
    if (!response.etat) {
      return { ok: false, label: "Balance", detail: response.message ?? `HTTP ${response.httpStatus}` };
    }
    const credit = response.data?.credit;
    return {
      ok: true,
      label: "Balance",
      detail: credit !== undefined ? `${credit.toLocaleString("fr-CM")} FCFA available` : "Retrieved.",
      payload: response.data,
    };
  } catch (error) {
    return fail("Balance", error);
  }
}

export async function probeIdentify(phone: string): Promise<ProbeResult> {
  await requireRole("admin");
  try {
    const normalised = normalisePhone(phone);
    if (!normalised) {
      return {
        ok: false,
        label: "Identify",
        detail: `"${phone}" is not a valid number. CamerPay wants 9 digits starting with 6, no +237.`,
      };
    }
    const response = await identifyNumber(normalised);
    return {
      ok: response.etat,
      label: "Identify",
      detail: response.message ?? (response.etat ? "Number identified." : "Not identified."),
      payload: response.data,
    };
  } catch (error) {
    return fail("Identify", error);
  }
}

export async function registerCallback(url: string): Promise<ProbeResult> {
  await requireRole("admin");
  try {
    const response = await setCallbackUrl(url.trim());
    return {
      ok: response.etat,
      label: "Callback URL",
      detail: response.etat ? `Registered ${url}` : (response.message ?? "Rejected."),
    };
  } catch (error) {
    return fail("Callback URL", error);
  }
}

/**
 * Start a real collection.
 *
 * Returns the `replyTo` on HTTP 202. That is an ACCEPTANCE, not a payment —
 * the customer still approves on their handset, and the outcome arrives later.
 * Nothing anywhere may treat a 202 as settled.
 */
export async function probeDeposit(phone: string, amount: number): Promise<ProbeResult> {
  const admin = await requireRole("admin");
  try {
    const response = await requestDeposit(phone, amount);

    if (response.httpStatus === 202 || response.etat) {
      const replyTo = response.data?.replyTo ?? "(none returned)";
      console.info("[camerpay] deposit requested", replyTo, "by", admin.email);
      return {
        ok: true,
        label: "Deposit",
        detail: `Accepted (HTTP ${response.httpStatus}). replyTo ${replyTo} — the customer must now approve on their handset. This is NOT a completed payment.`,
        payload: response.data,
      };
    }

    return {
      ok: false,
      label: "Deposit",
      detail: response.message ?? `Refused with HTTP ${response.httpStatus}`,
      payload: response.data,
    };
  } catch (error) {
    return fail("Deposit", error);
  }
}

/** Ask CamerPay what actually happened to one transaction. */
export async function probeConfirm(replyTo: string): Promise<ProbeResult> {
  await requireRole("admin");
  try {
    const result = await confirmTransaction(replyTo.trim());
    return {
      ok: result.status === "success",
      label: "Confirm",
      detail:
        result.status === "success"
          ? `CamerPay reports SUCCESS${result.amount ? ` for ${result.amount} FCFA` : ""}.`
          : result.status === "failed"
            ? "CamerPay reports FAILED."
            : "Still pending — CamerPay has no final result for this replyTo yet.",
      payload: result.raw,
    };
  } catch (error) {
    return fail("Confirm", error);
  }
}

export async function probeReport(kind: "transaction" | "notification"): Promise<ProbeResult> {
  await requireRole("admin");
  try {
    const response =
      kind === "transaction" ? await listTransactions({ limit: 10 }) : await listNotifications({ limit: 10 });

    const count = Array.isArray(response.data) ? response.data.length : 0;
    return {
      ok: response.etat,
      label: kind === "transaction" ? "Transaction report" : "Notification report",
      detail: response.etat ? `${count} record(s) returned.` : (response.message ?? "Failed."),
      payload: response.data,
    };
  } catch (error) {
    return fail(kind, error);
  }
}
