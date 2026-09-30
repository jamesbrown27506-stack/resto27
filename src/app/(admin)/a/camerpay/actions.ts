"use server";

import { requireRole } from "@/lib/auth/session";
import { SUPER_ADMIN_ONLY_ERROR } from "@/lib/auth/super-admin-rules";
import { MIN_AMOUNT_XAF } from "@/lib/payments/camerpay/client";
import { computeWithdrawalFee } from "@/lib/payments/withdrawal-fee";
import { getWithdrawalFeeConfig } from "@/lib/data/settings";
import { createAdminClient } from "@/lib/supabase/server";
import {
  acceptedTransactionId,
  confirmTransaction,
  getBalance,
  identifyNumber,
  listNotifications,
  latestTransactionId,
  listTransactions,
  login,
  maskToken,
  normalisePhone,
  rawCall,
  recordAcceptedRequest,
  registerAccount,
  requestCollection,
  recordWithdrawalFee,
  sendPayout,
  setCallbackUrl,
  validateAccount,
  type CamerPayService,
  type TransactionHint,
} from "@/lib/payments/camerpay/client";
import {
  dialInstructionFromRefusal,
  findPaymentInstruction,
  type CamerPayNotificationEntry,
  type PaymentInstruction,
} from "@/lib/payments/camerpay/notification";

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
  /** Report counter as it stood BEFORE the call — see TransactionHint.afterId. */
  afterId?: number;
  /** Correlation key used by the automatic transaction watcher. */
  trackingId?: string;
  /** Captured before the provider request, for report-row matching. */
  startedAt?: string;
  /** Notification counter before the request, preventing stale Orange codes. */
  notificationAfterId?: number;
  payload?: unknown;
  /**
   * The exact request that was sent, secrets redacted — for pasting into a
   * CamerPay support thread. Present on any probe that reached the API.
   */
  request?: unknown;
  /** The raw response body, so support sees both halves of the exchange. */
  response?: unknown;
  /**
   * Present on a payout when the tax is enabled: the gross the
   * recipient is owed, the withheld fee, and the net actually sent.
   */
  fee?: { gross: number; fee: number; net: number };
  /**
   * Orange refused to push a prompt: the customer must dial this code first.
   * The watcher shows it and keeps asking CamerPay until it is paid.
   */
  dial?: PaymentInstruction;
}

/**
 * ─────────────────────────────────────────────────────────────────────────
 *  THE CONSOLE'S WRITE HALF IS SUPER-ADMIN ONLY.
 *
 *  Charging a number, paying one out, sending a raw API call, registering or
 *  validating the gateway account, repointing the callback URL and revealing
 *  the session token all move money or hand over a live credential. Those
 *  refuse a simple admin here, on the server. The read-only probes (balance,
 *  identify, confirm, reports, the transaction watcher) stay open: they are
 *  how any admin answers "did this customer's payment go through?".
 * ─────────────────────────────────────────────────────────────────────────
 */
function refusedToSimpleAdmin(label: string): ProbeResult {
  return { ok: false, label, detail: SUPER_ADMIN_ONLY_ERROR };
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
  /** Overrides the session token — needed for `validation`. */
  token?: string;
}): Promise<ProbeResult> {
  const admin = await requireRole("admin");
  if (!admin.isSuperAdmin) return refusedToSimpleAdmin("Raw call");

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
      { authenticated: input.authenticated, token: input.token },
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
      request: response.request,
      response: { ...response, request: undefined },
    };
  } catch (error) {
    return fail("Raw call", error);
  }
}

/* ── Watching a transaction settle ─────────────────────────────────────── */

export interface TransactionStatus {
  status: "success" | "failed" | "pending";
  detail: string;
  amount?: number;
  raw?: unknown;
  instruction?: PaymentInstruction;
  /** An Orange ask was ACCEPTED this time — stop asking, the report decides now. */
  claimed?: boolean;
}

/**
 * One poll. Cheap, idempotent, and safe to call as often as you like.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  POLLING IS NOT A WORKAROUND FOR THE CALLBACK — IT IS THE OTHER HALF.
 *
 *  A callback is fast but unreliable: it can be lost, delayed, or delivered
 *  to a URL that was briefly down. When one goes missing the customer has
 *  been debited while the invoice still reads unpaid, and nothing else in the
 *  system will ever notice.
 *
 *  So the callback tells us to look EARLY, and this tells us what is TRUE.
 *  Both routes end at `confirmTransaction`, which asks CamerPay directly —
 *  there is no path where a status is believed rather than verified.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function checkTransaction(
  replyTo: string,
  hint: TransactionHint = {},
  includeInstruction = true,
  /**
   * Send the same `retrait` again. Only the watcher of an Orange collection
   * that was refused with a code to dial asks for this: CamerPay looks for the
   * customer's withdrawal only when asked, so asking again IS the check.
   */
  claim = false,
): Promise<TransactionStatus> {
  const admin = await requireRole("admin");

  const trimmed = replyTo.trim();
  if (!trimmed) return { status: "pending", detail: "No transaction reference to check." };

  try {
    let result = await confirmTransaction(trimmed, hint);
    let instruction: PaymentInstruction | undefined;

    // A repeated ask is a charge request, so it is a super admin's like the
    // first one. It never settles anything by itself: an acceptance is handed
    // to the report, exactly as for a pushed prompt.
    if (
      claim &&
      admin.isSuperAdmin &&
      result.status === "pending" &&
      hint.direction === "collect" &&
      hint.phone &&
      hint.amount !== undefined
    ) {
      const again = await requestCollection(hint.phone, hint.amount);
      const dial = again.etat ? null : dialInstructionFromRefusal(again.message, hint.amount);

      if (dial) {
        return {
          status: "pending",
          instruction: dial,
          detail: "Not dialled yet. Orange debits nothing until the customer dials the code below.",
          raw: { httpStatus: again.httpStatus, message: again.message },
        };
      }

      if (again.etat) {
        const trackingId = acceptedTransactionId(again) ?? trimmed;
        await recordAcceptedRequest({
          replyTo: trackingId,
          direction: "collect",
          phone: hint.phone,
          amount: hint.amount,
          afterId: hint.afterId ?? null,
          startedAt: hint.startedAt,
        });
        result = await confirmTransaction(trackingId, hint);
        const answer = `CamerPay accepted the request after the dial (HTTP ${again.httpStatus}${again.message ? `: ${again.message}` : ""}).`;
        return {
          status: result.status,
          amount: result.amount,
          claimed: true,
          // The acceptance itself is shown: its exact shape is what tells us
          // how CamerPay reports a customer-initiated payment.
          raw: { accepted: { httpStatus: again.httpStatus, message: again.message, data: again.data, id: again.id }, report: result.raw ?? null },
          detail:
            result.status === "success"
              ? `Settled${result.amount ? ` — ${result.amount} FCFA` : ""}. ${answer}`
              : `${answer} Waiting for the report to show the money.`,
        };
      }

      return {
        status: "pending",
        detail: `CamerPay answered: ${again.message ?? `HTTP ${again.httpStatus}`}`,
        raw: { httpStatus: again.httpStatus, message: again.message },
      };
    }

    if (
      includeInstruction &&
      result.status === "pending" &&
      hint.direction === "collect" &&
      hint.phone &&
      hint.amount !== undefined
    ) {
      try {
        const notifications = await listNotifications({ limit: 25 });
        if (notifications.etat && Array.isArray(notifications.data)) {
          instruction =
            findPaymentInstruction(notifications.data as CamerPayNotificationEntry[], {
              phone: hint.phone,
              amount: hint.amount,
              afterNotificationId: hint.notificationAfterId,
            }) ?? undefined;
        }
      } catch (error) {
        console.warn("[camerpay] notification check failed", error);
      }
    }

    return {
      status: result.status,
      amount: result.amount,
      raw: result.raw ?? result.searched,
      instruction,
      detail:
        hint.direction === "payout"
          ? result.status === "success"
            ? `Delivered${result.amount ? ` — ${result.amount} FCFA` : ""}. The money is in the recipient's wallet.`
            : result.status === "failed"
              ? "The operator rejected this payout — nothing reached the wallet."
              : "Sent to CamerPay, not yet confirmed by the operator. Nothing to do on the recipient's phone."
          : result.status === "success"
            ? `Settled${result.amount ? ` — ${result.amount} FCFA` : ""}.`
            : result.status === "failed"
              ? "Not confirmed — the PIN was never entered, so no money moved."
              : "Waiting for CamerPay. The customer has to confirm on the handset.",
    };
  } catch (error) {
    // A network blip must not read as "failed" — that is the one status that
    // would have us tell a customer their payment did not go through when it
    // may well have.
    return {
      status: "pending",
      detail: error instanceof Error ? error.message : "Could not reach CamerPay.",
    };
  }
}

/* ── Paying money OUT ──────────────────────────────────────────────────── */

/**
 * Send money from the CamerPay balance to a wallet — `depot`.
 *
 * THE OPPOSITE DIRECTION FROM probeCollection, and the reason those two names
 * no longer contain the word "deposit" on both sides. This spends the balance
 * that collections built up: refunds, payouts to a restaurant, withdrawing to
 * your own number.
 *
 * WITHDRAWAL FEE (migration 0020): the `amount` argument is the GROSS — what
 * the recipient is owed. When the fee is enabled, this action withholds
 * `percent` of it and sends the net; the withheld francs stay in the platform
 * balance, which is the revenue. The console only displays the math — this is
 * where it is actually enforced, so a stale or edited client can never bypass
 * the fee.
 */
export async function probePayout(phone: string, amount: number): Promise<ProbeResult> {
  const admin = await requireRole("admin");
  if (!admin.isSuperAdmin) return refusedToSimpleAdmin("Payout");
  try {
    // The fee is read on the server, at send time — never trusted from the
    // client. It may have been switched on or off since the page loaded.
    const feeConfig = await getWithdrawalFeeConfig();
    // `gross` never moves — the fee and the net are what the config changes.
    const gross = amount;
    let fee = 0;
    let net = amount;
    if (feeConfig.enabled && feeConfig.percent > 0) {
      // Whole francs — XAF has no decimals. The net check below refuses any
      // case where the fee eats the whole payout.
      ({ fee, net } = computeWithdrawalFee(gross, feeConfig.percent));

      if (fee >= gross) {
        return {
          ok: false,
          label: "Payout",
          detail: `The ${feeConfig.percent}% tax (${fee} FCFA) is the whole amount — nothing would reach the recipient.`,
        };
      }
      if (net < MIN_AMOUNT_XAF) {
        return {
          ok: false,
          label: "Payout",
          detail: `After the ${feeConfig.percent}% fee (${fee} FCFA), the recipient would get ${net} FCFA — below CamerPay's ${MIN_AMOUNT_XAF} FCFA minimum. Raise the amount.`,
        };
      }
    }

    const afterId = await latestTransactionId();
    const notificationAfterId = await latestNotificationId();
    const startedAt = new Date().toISOString();
    const response = await sendPayout(phone, net);

    if (response.httpStatus === 202 || response.etat) {
      /**
       * THE TRACKING ID IS NOT ALWAYS IN `data.replyTo`.
       *
       * Acceptances now often come back HTTP 200 with `data: null` and the id
       * at the top level. Reading only `data.replyTo` left this payout with no
       * id at all: no ledger row, no fee record, and — what the operator saw —
       * no watcher, so money left the balance and the screen never said
       * whether it arrived. Same extraction as the collection side.
       */
      const trackingId = acceptedTransactionId(response);
      const replyTo = trackingId ?? "(none returned)";
      console.info(
        "[camerpay] payout requested",
        replyTo,
        "gross",
        gross,
        fee > 0 ? `fee ${fee}` : "no fee",
        "net",
        net,
        "by",
        admin.email,
      );

      // The ledger is what lets a later check — and above all the webhook,
      // which receives a callback carrying only this replyTo — find the row
      // in the report by number/amount/direction. The report never echoes it.
      // The NET is recorded: that is the amount the CamerPay report shows for
      // this transaction, so the reconciler can match the row.
      if (trackingId) {
        await recordAcceptedRequest({
          replyTo: trackingId,
          direction: "payout",
          phone,
          amount: net,
          afterId: afterId ?? null,
          startedAt,
        });

        // The withheld fee is the platform's revenue — one row per payout,
        // whatever ends up on the dashboard. Best-effort like the rest of the
        // bookkeeping: the fee is withheld regardless, this only records it.
        if (fee > 0) {
          await recordWithdrawalFee({
            replyTo: trackingId,
            phone,
            gross,
            fee,
            net,
          });
        }
      }

      return {
        ok: true,
        label: "Payout",
        detail:
          fee > 0
            ? `Accepted (HTTP ${response.httpStatus}). replyTo ${replyTo} — ${net.toLocaleString("fr-CM")} FCFA sent (${fee.toLocaleString("fr-CM")} FCFA tax withheld). Money is on its way OUT of your balance.`
            : `Accepted (HTTP ${response.httpStatus}). replyTo ${replyTo} — money is on its way OUT of your balance. Watch it settle below.`,
        payload: { trackingId, replyTo: response.data?.replyTo, requestId: response.id, message: response.message },
        request: response.request,
        afterId: afterId ?? undefined,
        trackingId: trackingId ?? undefined,
        startedAt,
        notificationAfterId,
        fee: fee > 0 ? { gross, fee, net } : undefined,
      };
    }

    return {
      ok: false,
      label: "Payout",
      detail: response.message ?? `Refused with HTTP ${response.httpStatus}`,
      payload: response.data,
      request: response.request,
      response: { ...response, request: undefined },
    };
  } catch (error) {
    return fail("Payout", error);
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
  parrain?: string;
  pass: string;
}): Promise<RegistrationResult> {
  const admin = await requireRole("admin");
  if (!admin.isSuperAdmin) return refusedToSimpleAdmin("Registration");
  try {
    const response = await registerAccount(input);

    if (!response.etat || !response.token) {
      return {
        ok: false,
        label: "Inscription",
        detail: response.message ?? `Refused with HTTP ${response.httpStatus}`,
        payload: response.data,
        request: response.request,
        response: { ...response, request: undefined },
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
      request: response.request,
      // Deliberately not the whole response — it holds the provisional token,
      // which is a live credential and is already carried in its own field.
      payload: { code: response.data?.code },
    };
  } catch (error) {
    return fail("Inscription", error);
  }
}

/**
 * Step 2 — confirm the code against the provisional token.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE TOKEN IT RETURNS IS THE WHOLE POINT, AND THIS USED TO DISCARD IT.
 *
 *  CamerPay answers "Inscription réussie. Veuillez vous connecter avec votre
 *  token d'autorisation" — and the token is on the response. Returning only
 *  `response.data` dropped it, leaving an account that had been created
 *  successfully and no way to authenticate to it.
 *
 *  It is shown in full, once, deliberately. It is a live credential and this
 *  console is admin-only; the alternative is an account you cannot use.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function submitValidation(input: {
  code: string;
  provisionalToken: string;
}): Promise<RegistrationResult> {
  const admin = await requireRole("admin");
  if (!admin.isSuperAdmin) return refusedToSimpleAdmin("Validation");
  try {
    const response = await validateAccount(input);

    if (!response.etat) {
      return {
        ok: false,
        label: "Validation",
        detail: response.message ?? `Refused with HTTP ${response.httpStatus}`,
        payload: response.data,
        request: response.request,
        response: { ...response, request: undefined },
      };
    }

    console.info("[camerpay] account validated by", admin.email);

    /**
     * The authorisation token can arrive at the root or inside `data`
     * depending on the action, so both are checked. Its ABSENCE is reported
     * rather than glossed over — an account with no token is not usable, and
     * saying "validated" while leaving that out is how someone spends an hour
     * looking for a value that was never sent.
     */
    const issued =
      response.token ??
      (response.data as { token?: string } | undefined)?.token ??
      null;

    return {
      ok: true,
      label: "Validation",
      detail: issued
        ? `${response.message ?? "Account validated."} Copy the token below into CAMERPAY_TOKEN, then redeploy.`
        : `${response.message ?? "Account validated."} No token was returned here — run Login below with your number and password to fetch one, or ask support to issue one.`,
      provisionalToken: issued ?? undefined,
      payload: response.data,
      request: response.request,
      response: { ...response, request: undefined },
    };
  } catch (error) {
    return fail("Validation", error);
  }
}

/**
 * `reveal` exists because a masked token cannot be copied into an env var.
 *
 * Masking is right by default — this is the one screen where a live credential
 * would otherwise sit waiting to be screenshotted. But refusing ever to show it
 * makes the console unable to hand over the one value the deployment needs, so
 * the operator can ask for it deliberately.
 *
 * Worth knowing: if login works, CAMERPAY_TOKEN is not required at all. The
 * client fetches a session itself from the number and password already in the
 * environment.
 */
export async function probeLogin(reveal = false): Promise<RegistrationResult> {
  const admin = await requireRole("admin");
  // Masked login is a harmless health check; the REVEALED token is a live
  // credential for the platform's gateway account.
  if (reveal && !admin.isSuperAdmin) return refusedToSimpleAdmin("Login");
  try {
    const token = await login();
    return {
      ok: true,
      label: "Login",
      detail: reveal
        ? "Authenticated. Token below — CAMERPAY_TOKEN is optional while the number and password work."
        : `Authenticated. Token ${maskToken(token)}`,
      provisionalToken: reveal ? token : undefined,
    };
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
     * `IDENTIFIE` answers on the spot: etat true, "Le compte associé au numéro
     * … appartient à …" and `data.nomClient` (live, 2026-09-30).
     *
     * The deferred shape is still handled below — an acceptance carrying only
     * a `replyTo`, whose name arrives on the callback and is read back by
     * probeIdentifyResult — because that is what the docs describe and what
     * CamerPay may return under load.
     */
    const name = response.data?.nomClient?.trim();
    if (response.etat && name) {
      return {
        ok: true,
        label: "Identify",
        detail: response.message ?? `This number belongs to ${name}.`,
        payload: response.data,
        request: response.request,
      };
    }

    const replyTo = response.data?.replyTo?.trim();
    if (response.httpStatus === 202 || (response.etat && replyTo)) {
      return {
        ok: true,
        label: "Identify",
        detail: `Accepted (HTTP ${response.httpStatus})${replyTo ? `, replyTo ${replyTo}` : ""}. Waiting for the name on the callback…`,
        payload: response.data,
        request: response.request,
        trackingId: replyTo,
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
      request: response.request,
      response: { ...response, request: undefined },
    };
  } catch (error) {
    return fail("Identify", error);
  }
}

/**
 * The answer to an accepted `IDENTIFIE`, read from the callback it arrived on.
 *
 * The webhook stores every delivery verbatim in payment_webhook_events BEFORE
 * judging it, keyed by its replyTo — so the identification is already in the
 * database a second or two after the acceptance, and nothing new has to be
 * asked of CamerPay. `pending` means the callback has not arrived yet.
 */
export async function probeIdentifyResult(replyTo: string): Promise<ProbeResult & { pending?: boolean }> {
  await requireRole("admin");
  const needle = replyTo.trim();
  if (!needle) return { ok: false, label: "Identify", detail: "No replyTo to look up." };

  try {
    const { data, error } = await createAdminClient()
      .from("payment_webhook_events")
      .select("raw_body")
      .eq("provider", "camerpay")
      .eq("transaction_id", needle)
      .limit(1)
      .maybeSingle();

    if (error) return { ok: false, label: "Identify", detail: error.message };
    if (!data) {
      return {
        ok: true,
        pending: true,
        label: "Identify",
        detail: `Accepted, replyTo ${needle}. The callback with the name has not arrived yet.`,
      };
    }

    let body: {
      etat?: boolean;
      message?: string;
      data?: { etat?: boolean; message?: string; nomClient?: string; nom?: string; name?: string };
    } = {};
    try {
      body = JSON.parse(String(data.raw_body ?? "{}"));
    } catch {
      // Shown as an empty payload below; the message says what is known.
    }
    const identified = (body.etat ?? body.data?.etat) !== false;
    const name = body.data?.nomClient ?? body.data?.nom ?? body.data?.name;
    const message = body.data?.message ?? body.message;
    return {
      ok: identified,
      label: "Identify",
      detail: name
        ? `Identified: ${name}${message ? ` — ${message}` : ""}`
        : (message ?? (identified ? "Identified. See the callback below." : "Not identified.")),
      payload: body,
    };
  } catch (error) {
    return fail("Identify", error);
  }
}

export async function registerCallback(url: string): Promise<ProbeResult> {
  const admin = await requireRole("admin");
  // Repointing the callback redirects every payment notification.
  if (!admin.isSuperAdmin) return refusedToSimpleAdmin("Callback URL");
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
async function latestNotificationId(): Promise<number | undefined> {
  try {
    const response = await listNotifications({ limit: 100 });
    if (!Array.isArray(response.data)) return undefined;
    const ids = (response.data as CamerPayNotificationEntry[])
      .map((entry) => entry.id)
      .filter((id): id is number => typeof id === "number");
    return ids.length > 0 ? Math.max(...ids) : undefined;
  } catch {
    return undefined;
  }
}

export async function probeCollection(phone: string, amount: number): Promise<ProbeResult> {
  const admin = await requireRole("admin");
  if (!admin.isSuperAdmin) return refusedToSimpleAdmin("Collection");
  try {
    // Read the counter BEFORE charging. The row this creates is the first one
    // above it, which identifies it without trusting a timezone-less date.
    const afterId = await latestTransactionId();
    const notificationAfterId = await latestNotificationId();
    const startedAt = new Date().toISOString();
    const response = await requestCollection(phone, amount);

    if (response.etat) {
      const trackingId = acceptedTransactionId(response);
      if (!trackingId) {
        return {
          ok: false,
          label: "Collection",
          detail:
            "CamerPay accepted the request but returned no correlation id. Check the notification report before retrying.",
          request: response.request,
        };
      }
      console.info("[camerpay] collection requested", trackingId, "by", admin.email);

      // Ledger the acceptance under its replyTo, so the webhook — which
      // receives a callback carrying only this id — can find the report row
      // by number/amount/direction instead of a tracking id the report never
      // echoes. Without this row every callback would confirm as "pending".
      await recordAcceptedRequest({
        replyTo: trackingId,
        direction: "collect",
        phone,
        amount,
        afterId: afterId ?? null,
        startedAt,
      });

      return {
        ok: true,
        label: "Collection",
        detail: `Accepted (HTTP ${response.httpStatus}). Tracking ${trackingId} — this is pending, not a completed payment. Follow any Orange instruction in the notification report, then wait for confirmation.`,
        payload: {
          trackingId,
          replyTo: response.data?.replyTo,
          requestId: response.id,
          message: response.message,
          data: response.data,
        },
        request: response.request,
        afterId: afterId ?? undefined,
        trackingId,
        startedAt,
        notificationAfterId,
      };
    }

    /*
      ORANGE: NOT A REFUSAL, A CODE TO DIAL (2026-09).

      Orange no longer lets a merchant pull money at a distance. CamerPay
      answers etat:false / HTTP 404 with the code the customer must dial and
      the name Orange will show them. The watcher below shows both and sends
      this same request again every few seconds — it is accepted once the
      customer has dialled.
    */
    const dial = dialInstructionFromRefusal(response.message, amount);
    if (dial) {
      const trackingId = acceptedTransactionId(response) ?? `dial-${startedAt}`;
      console.info("[camerpay] collection needs a customer dial", trackingId, "by", admin.email);
      return {
        ok: true,
        label: "Collection",
        detail: `Orange: the customer starts this payment. They dial ${dial.code}${dial.merchantName ? ` and Orange shows "${dial.merchantName}"` : ""}. Nothing is debited until then — this is being watched below.`,
        payload: { trackingId, httpStatus: response.httpStatus, message: response.message },
        request: response.request,
        response: { ...response, request: undefined },
        afterId: afterId ?? undefined,
        trackingId,
        startedAt,
        notificationAfterId,
        dial,
      };
    }

    return {
      ok: false,
      label: "Collection",
      detail: response.message ?? `Refused with HTTP ${response.httpStatus}`,
      payload: response.data,
      request: response.request,
      response: { ...response, request: undefined },
    };
  } catch (error) {
    return fail("Collection", error);
  }
}

/** Ask CamerPay what actually happened to one transaction. */
export async function probeConfirm(
  replyTo: string,
  hint: TransactionHint = {},
): Promise<ProbeResult> {
  await requireRole("admin");
  try {
    const result = await confirmTransaction(replyTo.trim(), hint);
    return {
      ok: result.status === "success",
      label: "Confirm",
      detail:
        result.status === "success"
          ? `CamerPay confirms this settled${result.amount ? ` — ${result.amount} FCFA` : ""}.`
          : result.status === "failed"
            ? "CamerPay reports this transaction FAILED."
            : "Still pending. CamerPay's report does not echo the tracking id, so the row is found by number, amount and direction — supply those above if this keeps missing. The rows searched are below.",
      // On a miss this is the whole report, which is exactly what is needed to
      // see WHY nothing matched.
      payload: result.raw ?? result.searched,
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
