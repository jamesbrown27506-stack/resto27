/**
 * The one test for "may we send a freshly signed-in person here?".
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  `next` TRAVELS THROUGH URLS, FORMS AND EMAILS — ALL ATTACKER-WRITABLE.
 *
 *  It starts as `?next=/checkout` written by the proxy, rides a hidden form
 *  field through sign-in or sign-up, and on sign-up is baked into the
 *  confirmation link Supabase emails. Any of those can be forged, and a
 *  forged `next=https://evil.example` would hand a just-authenticated user to
 *  a phishing page on our own domain's say-so.
 *
 *  Only a same-site PATH is honoured:
 *    - it must start with a single "/";
 *    - "//evil.example" is protocol-relative, not a path;
 *    - "/\evil.example" is normalised to "//evil.example" by browsers, so a
 *      backslash anywhere is refused rather than reasoned about;
 *    - control characters (a smuggled newline in a header) are refused.
 *
 *  Plain module (no "use server") so the sign-in action, the sign-up action
 *  and the auth pages all share one rule, and it can be unit tested.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function safeNextPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const next = value.trim();
  if (!next || next.length > 512) return null;
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  if (next.includes("\\")) return null;
  if (/[\u0000-\u001f\u007f]/.test(next)) return null;
  return next;
}

/** `/login` or `/register`, carrying `next` along when there is a safe one. */
export function withNext(path: string, next: string | null | undefined): string {
  const safe = safeNextPath(next);
  return safe ? `${path}?next=${encodeURIComponent(safe)}` : path;
}
