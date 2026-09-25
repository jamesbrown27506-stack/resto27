/**
 * "Is this the address they already saved?" — asked twice, with one answer.
 *
 * The checkout asks it to decide whether "Enregistrer cette adresse" starts
 * ticked; placeOrder asks it again, server-side, before inserting, so a
 * customer who orders to the same flat every Friday does not end up with
 * twelve copies of it in their address book.
 *
 * Only the street line and the quartier decide identity. The landmark is
 * deliberately ignored: it drifts ("en face de la pharmacie" one week, the
 * same plus a map link the next) without the place moving, and a second
 * entry for the same door is exactly the clutter this exists to prevent.
 *
 * Comparison is forgiving the way people type on phones — case, accents,
 * punctuation and repeated spaces do not make a new address.
 */
export interface AddressIdentity {
  addressLine: string | null | undefined;
  quartier: string | null | undefined;
}

export function normaliseAddressPart(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function isSameAddress(a: AddressIdentity, b: AddressIdentity): boolean {
  const lineA = normaliseAddressPart(a.addressLine);
  if (!lineA) return false;
  return (
    lineA === normaliseAddressPart(b.addressLine) &&
    normaliseAddressPart(a.quartier) === normaliseAddressPart(b.quartier)
  );
}
