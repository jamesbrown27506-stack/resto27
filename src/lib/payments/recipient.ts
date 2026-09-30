import "server-only";

import { identifyNumber, normalisePhone } from "@/lib/payments/camerpay/client";
import { cleanRecipientName, sameRecipient } from "@/lib/payments/recipient-name";

/**
 * WHO IS ABOUT TO RECEIVE THIS MONEY — asked of the operator before it leaves.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  A Mobile Money transfer cannot be recalled, and a wallet number is nine
 *  digits typed by hand: one wrong digit sends a restaurant's takings, or the
 *  platform's balance, to a stranger who owes nobody an answer.
 *
 *  So every withdrawal a person starts — a restaurant taking its money out,
 *  an admin paying from a console — goes through two steps:
 *
 *    1. LOOK UP   identifyRecipient(): CamerPay's `IDENTIFIE` returns the name
 *                 registered on the number. The sender is shown it.
 *    2. SEND      the action that moves the money takes the name the sender
 *                 was shown and calls requireConfirmedRecipient(), which asks
 *                 CamerPay AGAIN and only passes if the two agree.
 *
 *  Step 2 is the security; step 1 alone would be a courtesy. A Server Action
 *  is a POST endpoint: a stale page, a script, or a number edited after the
 *  look-up would all reach the send without the screen that showed the name.
 *  Asking again at send time means the money only goes to the person whose
 *  name was actually read.
 *
 *  The look-up is CamerPay's whichever gateway sends the payout — it is a
 *  question about the phone number, not about the transfer.
 *
 *  NO ANSWER IS NOT A YES. A number CamerPay cannot identify, or a look-up
 *  that fails, blocks the withdrawal. It is always safe to refuse: nothing
 *  has moved, and the sender can try again.
 * ─────────────────────────────────────────────────────────────────────────
 */

export type RecipientLookup =
  | { ok: true; phone: string; name: string }
  | {
      ok: false;
      /** badPhone: not a number. notIdentified: CamerPay knows no such wallet. unavailable: could not ask. */
      reason: "badPhone" | "notIdentified" | "unavailable";
      detail?: string;
    };

export async function identifyRecipient(rawPhone: string): Promise<RecipientLookup> {
  const phone = normalisePhone(rawPhone ?? "");
  if (!phone) return { ok: false, reason: "badPhone" };

  let response;
  try {
    response = await identifyNumber(phone);
  } catch (error) {
    console.error("[recipient:identify]", error instanceof Error ? error.message : error);
    return { ok: false, reason: "unavailable" };
  }

  const name = cleanRecipientName(response.data?.nomClient);
  if (response.etat === true && name) return { ok: true, phone, name };

  // A gateway error, or an acceptance with no name in it (the deferred shape
  // the docs describe), is "could not ask" — not "this number has no owner".
  if (response.httpStatus >= 500 || typeof response.etat !== "boolean" || response.etat === true) {
    return { ok: false, reason: "unavailable", detail: response.message };
  }
  return { ok: false, reason: "notIdentified", detail: response.message };
}

export type RecipientGate =
  | { ok: true; phone: string; name: string }
  | {
      ok: false;
      /** notConfirmed: the sender never saw a name. changed: the name is no longer the one they saw. */
      reason: "badPhone" | "notIdentified" | "unavailable" | "notConfirmed" | "changed";
      /** The name the account carries NOW, when it could be read. */
      name?: string;
      detail?: string;
    };

/** A failed check, in English — the admin area's language. Restaurants get theirs from the dictionary. */
export function recipientRefusalInEnglish(gate: Extract<RecipientGate, { ok: false }>): string {
  switch (gate.reason) {
    case "badPhone":
      return "That is not a valid number. CamerPay wants 9 digits starting with 6, no +237.";
    case "notIdentified":
      return `This number could not be identified${gate.detail ? ` (${gate.detail})` : ""}. Check that it is an active Mobile Money account. Nothing was sent.`;
    case "notConfirmed":
      return "Check who receives the money first: the account holder has to be looked up and confirmed before a payout is sent.";
    case "changed":
      return `This number's account is in the name of ${gate.name ?? "someone else"}, not the person you confirmed. Check again before sending. Nothing was sent.`;
    default:
      return `The account holder could not be checked right now${gate.detail ? ` (${gate.detail})` : ""}. Nothing was sent — try again in a moment.`;
  }
}

/**
 * The gate every human-started payout passes before money moves: the account
 * holder is looked up again, and must be the one the sender confirmed.
 */
export async function requireConfirmedRecipient(
  rawPhone: string,
  confirmedName: string | null | undefined,
): Promise<RecipientGate> {
  if (!cleanRecipientName(confirmedName)) return { ok: false, reason: "notConfirmed" };

  const lookup = await identifyRecipient(rawPhone);
  if (!lookup.ok) return lookup;
  if (!sameRecipient(confirmedName, lookup.name)) return { ok: false, reason: "changed", name: lookup.name };
  return lookup;
}
