/**
 * Phone number formatting for Cameroon.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY THIS EXISTS.
 *
 *  The footer and the contact page both built their `tel:` href inline with
 *  `phone.replace(/[^+\\d]/g, "")`. Inside a regex *literal* `\\d` is not the
 *  digit class — it is an escaped backslash followed by the letter `d`. So the
 *  character class read "anything that is not `+`, not `\`, and not `d`",
 *  which matched every digit and stripped them all. Every page on the site
 *  rendered `href="tel:"` with no number: the call button was visible, styled,
 *  and completely inert.
 *
 *  The number also lives in settings as bare national digits ("691098999"),
 *  so even a correct strip would have produced a `tel:` that only dials
 *  locally. Both concerns belong in one place rather than at each call site.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** Cameroon's calling code. Numbers are 9 national digits behind it. */
const CM_COUNTRY_CODE = "237";
const CM_NATIONAL_DIGITS = 9;

/**
 * An E.164 `tel:` href, or null when there is no usable number.
 *
 * Returns null rather than an empty string so callers can drop the link
 * entirely instead of rendering a dead one — which is the bug this replaces.
 */
export function telHref(phone: string | null | undefined): string | null {
  if (!phone) return null;

  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  // Already international, either as +237… or as a bare 237-prefixed number.
  if (trimmed.startsWith("+")) return `tel:+${digits}`;
  if (digits.length > CM_NATIONAL_DIGITS && digits.startsWith(CM_COUNTRY_CODE)) {
    return `tel:+${digits}`;
  }

  // National form: assume Cameroon, which is the only country served.
  if (digits.length === CM_NATIONAL_DIGITS) {
    return `tel:+${CM_COUNTRY_CODE}${digits}`;
  }

  // Something we do not recognise — dial exactly what was entered rather than
  // guessing a country code onto it.
  return `tel:+${digits}`;
}

/**
 * Display form: `+237 6 91 09 89 99`.
 *
 * Falls back to the administrator's own string whenever it does not look like
 * a Cameroon number, so an unusual entry is shown as typed rather than mangled.
 */
export function formatPhoneDisplay(phone: string | null | undefined): string {
  if (!phone) return "";

  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");

  const national =
    digits.length === CM_NATIONAL_DIGITS
      ? digits
      : digits.startsWith(CM_COUNTRY_CODE) && digits.length === CM_COUNTRY_CODE.length + CM_NATIONAL_DIGITS
        ? digits.slice(CM_COUNTRY_CODE.length)
        : null;

  if (!national) return trimmed;

  // 6 91 09 89 99 — the grouping Cameroonian numbers are written in.
  const groups = [national.slice(0, 1), national.slice(1, 3), national.slice(3, 5), national.slice(5, 7), national.slice(7, 9)];
  return `+${CM_COUNTRY_CODE} ${groups.join(" ")}`;
}
