/**
 * Is this an iPhone, iPad or iPod — the devices where a `tel:` link cannot
 * carry `*` or `#`?
 *
 * iOS refuses to dial (or strips) USSD characters from a tel: URL, so the
 * Orange Money step "*150*…#" opened the Phone app with a mangled number,
 * or nothing at all. On those devices the payment screen offers "Copier le
 * code" only, and says to paste it into the keypad.
 *
 * iPadOS 13+ reports itself as "Macintosh" — the touch-point count is what
 * tells an iPad from a real Mac. Pure, so it can be tested without a DOM.
 */
export function isAppleMobile(userAgent: string, platform = "", maxTouchPoints = 0): boolean {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true;
  return /Mac/i.test(platform || userAgent) && maxTouchPoints > 1;
}
