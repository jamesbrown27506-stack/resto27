import "server-only";
import { headers } from "next/headers";

/**
 * The canonical base URL, for links that leave the application.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  ONE SWITCH: APP_MODE = test | live
 *
 *    test → links point at APP_URL_TEST (or, if that is blank, at whatever
 *           host the request came in on — so any port or tunnel just works)
 *    live → links point at APP_URL_LIVE, and NOTHING ELSE
 *
 *  IN LIVE MODE THE REQUEST IS NEVER TRUSTED. That is a security boundary,
 *  not a preference. The Host header is attacker-controlled: a request
 *  carrying `Host: evil.example` that triggers a password reset would produce
 *  an email containing a REAL token pointed at the attacker's domain — sent
 *  by you, correctly signed, indistinguishable from the genuine article. That
 *  is host-header injection, and building the base URL from the request IS
 *  the vulnerability.
 *
 *  Test mode may derive from the request because there is no attacker on
 *  localhost, and requiring configuration to run the app locally is friction
 *  that buys nothing.
 * ─────────────────────────────────────────────────────────────────────────
 */

export type AppMode = "test" | "live";

/**
 * The mode.
 *
 * When APP_MODE is unset it is inferred: a production build is live, anything
 * else is test. Inferring rather than defaulting to `test` matters — a
 * deployed site that quietly ran in test mode would email localhost links to
 * real customers and never warn anybody.
 */
export function appMode(): AppMode {
  const raw = process.env.APP_MODE?.trim().toLowerCase();
  if (raw === "live" || raw === "production") return "live";
  if (raw === "test" || raw === "development") return "test";
  return process.env.NODE_ENV === "production" ? "live" : "test";
}

function normalise(value: string): string {
  const withScheme = value.startsWith("http") ? value : `https://${value}`;
  // Trailing slashes produce "https://site.cm//login" once a path is appended.
  return withScheme.replace(/\/+$/, "");
}

/** Derived from the request. Correct in test, never used in live. */
async function fromRequest(): Promise<string | null> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return null;

  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function siteUrl(): Promise<string> {
  if (appMode() === "live") {
    const configured =
      process.env.APP_URL_LIVE ||
      // Kept for the older single-value setups, and for Vercel, which injects
      // these automatically — so a preview deploy is correct untouched.
      process.env.APP_URL ||
      process.env.VERCEL_PROJECT_PRODUCTION_URL ||
      process.env.VERCEL_URL;

    if (configured) return normalise(configured);

    /**
     * Live with no URL. Fall back to the request rather than throwing — a
     * wrong link is recoverable, a 500 on /forgot-password is not — but say so
     * loudly, because this is exactly the unsafe condition described above.
     */
    console.error(
      "[site-url] APP_MODE=live but APP_URL_LIVE is not set. Falling back to the request Host, " +
        "which is attacker-controlled. Set APP_URL_LIVE to your real domain.",
    );
    return (await fromRequest()) ?? "http://localhost:3000";
  }

  return normalise(
    process.env.APP_URL_TEST || process.env.APP_URL || (await fromRequest()) || "http://localhost:3000",
  );
}

/** `siteUrl()` with a path appended, guaranteed single-slashed. */
export async function absoluteUrl(path: string): Promise<string> {
  const base = await siteUrl();
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
