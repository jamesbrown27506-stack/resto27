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
  rawCall,
  registerAccount,
  requestCollection,
  setCallbackUrl,
  validateAccount,
  type CamerPayService,
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

/**
 * Send an arbitrary service/action with a hand-written DATA payload.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THIS EXISTS BECAUSE THE DOCS ARE INCOMPLETE.
 *
 *  doc.camerpay.net names `inscription` and `validation` under
 *  `authentification` — "Crée un compte puis valide le code reçu avec le token
 *  provisoire" — but does NOT publish the DATA fields either one takes.
 *
 *  Hardcoding a guess would produce a call that fails for a reason no log
 *  could explain, and on a payment provider that is the worst kind of bug. So
 *  the payload is typed in by hand: the moment CamerPay support tells you the
 *  field names, you can try them here without waiting for a deploy.
 *
 *  `inscription` runs UNAUTHENTICATED — there is no account to log in to yet.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function probeRaw(input: {
  service: string;
  action: string;
  dataJson: string;
  authenticated: boolean;
}): Promise<ProbeResult> {
  const admin = await requireRole("admin");

  const allowed: CamerPayService[] = ["authentification", "account", "transaction", "rapport"];
  if (!allowed.includes(input.service as CamerPayService)) {
    return { ok: false, label: "Raw call", detail: `Unknown service "${input.service}".` };
  }
  if (!input.action.trim()) {
    return { ok: false, label: "Raw call", detail: "An action is required." };
  }

  let data: unknown = undefined;
  const trimmed = input.dataJson.trim();
  if (trimmed) {
    try {
      data = JSON.parse(trimmed);
    } catch {
      return { ok: false, label: "Raw call", detail: "DATA is not valid JSON." };
    }
  }

  try {
    const response = await rawCall(
      input.service as CamerPayService,
      input.action.trim(),
      data,
      { authenticated: input.authenticated },
    );

    // Logged without the payload: a registration call carries a password, and
    // an audit line is not the place for it.
    console.info(
      "[camerpay:raw]",
      input.service,
      input.action,
      "->",
      response.httpStatus,
      "by",
      admin.email,
    );

    return {
      ok: response.etat === true || response.httpStatus === 202,
      label: `${input.service}/${input.action}`,
      detail: response.message ?? `HTTP ${response.httpStatus}`,
      // The whole response, token included — this console is admin-only and
      // seeing the provisional token is the entire point of `inscription`.
      payload: response,
    };
  } catch (error) {
    return fail("Raw call", error);
  }
}

/* ── Opening an account ────────────────────────────────────────────────── */

export interface RegistrationResult extends ProbeResult {
  /** Carried into the validation step so the operator never copies it by hand. */
  provisionalToken?: string;
  code?: string;
}

/**
 * Step 1 — create the account.
 *
 * The password is never logged and never returned. It goes into the request
 * and nowhere else; the operator typed it and will type it again into
 * CAMERPAY_PASSWORD.
 */
export async function submitRegistration(input: {
  numero: string;
  parrain: string;
  pass: string;
}): Promise<RegistrationResult> {
  const admin = await requireRole("admin");
  try {
    const response = await registerAccount(input);

    if (!response.etat || !response.token) {
      return {
        ok: false,
        label: "Inscription",
        detail: response.message ?? `Refused with HTTP ${response.httpStatus}`,
        payload: response.data,
      };
    }

    console.info("[camerpay] inscription accepted for", input.numero, "by", admin.email);

    return {
      ok: true,
      label: "Inscription",
      detail:
        response.message ??
        "Registration accepted. Confirm the code below to finish opening the account.",
      provisionalToken: response.token,
      code: response.data?.code,
      // Deliberately not the whole response — it holds the provisional token,
      // which is a live credential and is already carried in its own field.
      payload: { code: response.data?.code },
    };
  } catch (error) {
    return fail("Inscription", error);
  }
}

/** Step 2 — confirm the code against the provisional token. */
export async function submitValidation(input: {
  code: string;
  provisionalToken: string;
}): Promise<ProbeResult> {
  const admin = await requireRole("admin");
  try {
    const response = await validateAccount(input);

    if (!response.etat) {
      return {
        ok: false,
        label: "Validation",
        detail: response.message ?? `Refused with HTTP ${response.httpStatus}`,
        payload: response.data,
      };
    }

    console.info("[camerpay] account validated by", admin.email);

    return {
      ok: true,
      label: "Validation",
      detail:
        (response.message ?? "Account validated.") +
        " Put the account number and password into CAMERPAY_ACCOUNT_NUMBER and CAMERPAY_PASSWORD, then restart.",
      payload: response.data,
    };
  } catch (error) {
    return fail("Validation", error);
  }
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

    /**
     * `identifier` lives under the TRANSACTION service, and every transaction
     * call is asynchronous: HTTP 202 means accepted, and the identified name
     * arrives on the callback rather than in this response.
     *
     * Reading `etat` as the verdict — which this did — reports a perfectly
     * good acceptance as a failure, and sends you debugging a number that was
     * never the problem.
     */
    if (response.httpStatus === 202) {
      const replyTo = (response.data as { replyTo?: string } | undefined)?.replyTo;
      return {
        ok: true,
        label: "Identify",
        detail: `Accepted (HTTP 202)${replyTo ? `, replyTo ${replyTo}` : ""}. The identified name arrives on the callback, not here — use Confirm with that replyTo.`,
        payload: response.data,
      };
    }

    return {
      ok: response.etat,
      label: "Identify",
      detail:
        response.message ??
        (response.etat
          ? "Number identified."
          : "Not identified. CamerPay only detects Orange and MTN, and the number must have an active Mobile Money wallet."),
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
 * CHARGES the number — `retrait`, which pulls from the customer's wallet.
 * Not `depot`, which would pay them instead. There is no sandbox: this moves
 * real money, minimum 500 FCFA.
 *
 * Returns the `replyTo` on HTTP 202. That is an ACCEPTANCE, not a payment —
 * the customer still approves on their handset, and the outcome arrives later.
 * Nothing anywhere may treat a 202 as settled.
 */
export async function probeCollection(phone: string, amount: number): Promise<ProbeResult> {
  const admin = await requireRole("admin");
  try {
    const response = await requestCollection(phone, amount);

    if (response.httpStatus === 202 || response.etat) {
      const replyTo = response.data?.replyTo ?? "(none returned)";
      console.info("[camerpay] collection requested", replyTo, "by", admin.email);
      return {
        ok: true,
        label: "Collection",
        detail: `Accepted (HTTP ${response.httpStatus}). replyTo ${replyTo} — the customer must now approve on their handset. This is NOT a completed payment.`,
        payload: response.data,
      };
    }

    return {
      ok: false,
      label: "Collection",
      detail: response.message ?? `Refused with HTTP ${response.httpStatus}`,
      payload: response.data,
    };
  } catch (error) {
    return fail("Collection", error);
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
