/**
 * The name on a Mobile Money account, as CamerPay's `IDENTIFIE` returns it —
 * and the comparison between the name a person was SHOWN and the name the
 * account carries when the money is actually sent. Pure, so it is tested.
 */

/** " EDOUARD  TAHALI " → "EDOUARD TAHALI". CamerPay pads its answers. */
export function cleanRecipientName(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, " ").trim();
}

function comparable(name: string | null | undefined): string {
  return cleanRecipientName(name)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase();
}

/**
 * Is this the account holder the sender confirmed?
 *
 * Spacing, case and accents are ignored — the operator's spelling of a name is
 * not stable to the character. An empty name on either side is never a match:
 * "nobody was shown a name" must not pass as "the name did not change".
 */
export function sameRecipient(shown: string | null | undefined, actual: string | null | undefined): boolean {
  const a = comparable(shown);
  const b = comparable(actual);
  return a !== "" && a === b;
}
