/**
 * Is this a real browser push-service endpoint?
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  ONLY THE VENDORS' PUSH SERVICES (security review 2026-10-05).
 *
 *  Every saved endpoint is POSTed to by our server on each notification the
 *  owner of the subscription can trigger (an order, a chat message, a table
 *  event). "Any https URL" let anyone — an anonymous QR-table guest included
 *  — point that POST at a host and path of their choosing and use the
 *  platform as a request reflector. Browsers only ever hand out endpoints on
 *  these services, so nothing legitimate is refused.
 * ─────────────────────────────────────────────────────────────────────────
 */
const PUSH_HOSTS: readonly string[] = [
  // Chrome, Edge (Chromium), Opera, Brave, Samsung Internet, Android WebView.
  "fcm.googleapis.com",
  "android.googleapis.com",
  // Firefox.
  "push.services.mozilla.com",
  // Safari 16+ (macOS / iOS web push).
  "push.apple.com",
  // Legacy Edge / Windows.
  "notify.windows.com",
];

export function isPushServiceEndpoint(endpoint: string): boolean {
  if (endpoint.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  if (url.port && url.port !== "443") return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}
