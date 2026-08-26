import { describe, expect, it } from "vitest";
import { config } from "./proxy";

/**
 * The matcher decides which requests reach the auth guard AT ALL.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  A ROUTE THAT SLIPS OUT OF THIS PATTERN IS UNGUARDED, SILENTLY.
 *
 *  Nothing else in the codebase notices: `proxy()` simply never runs for it,
 *  the page renders, and a signed-out visitor sees a screen that was supposed
 *  to redirect. There is no type to check and no error to log — which is why
 *  the one piece of this file that is easy to get wrong deserves a test.
 *
 *  It IS easy to get wrong. Adding `sw.js` to the exclusion list as `sw\.js`
 *  looks right and is not: in a TypeScript string literal `\.` collapses to
 *  a bare `.`, so the dot stays a wildcard and `/swXjs` is excluded too. The
 *  existing entries use `\\.` for exactly that reason, and the assertions
 *  below are what would have caught the mistake.
 *
 *  The regex is read from the exported `config` rather than retyped, so this
 *  tests the pattern Next actually compiles — a copy would drift from it and
 *  pass while production was wrong.
 * ─────────────────────────────────────────────────────────────────────────
 */

const patterns = config.matcher.map((p) => new RegExp(`^${p}$`));

/** True when a request for this path reaches `proxy()`. */
function isProxied(pathname: string): boolean {
  return patterns.some((re) => re.test(pathname));
}

describe("the auth guard still sees every route it guards", () => {
  // These are the PROTECTED prefixes in proxy.ts. A path here that stops being
  // proxied is a page a signed-out visitor can reach.
  it.each([
    "/orders",
    "/orders/abc-123",
    "/reviews",
    "/profile",
    "/settings",
    "/m",
    "/m/orders",
    "/m/orders/abc-123",
    "/a",
    "/a/settings",
  ])("guards %s", (path) => {
    expect(isProxied(path)).toBe(true);
  });

  it.each(["/login", "/register", "/forgot-password"])(
    "still sees %s, so a signed-in user is bounced away from it",
    (path) => {
      expect(isProxied(path)).toBe(true);
    },
  );

  it.each(["/", "/restaurants", "/restaurants/white-house", "/cart", "/api/push/sync"])(
    "still runs for %s, which needs its session refreshed even though it is public",
    (path) => {
      expect(isProxied(path)).toBe(true);
    },
  );
});

describe("things that must NOT cost an auth round trip", () => {
  it("skips the service worker", () => {
    // Registration and every update check went through the auth host, so a
    // slow or failing verification delayed — or broke — a file that carries no
    // session and cannot act on one. A worker that fails to register fails
    // silently, and push then stops with nothing saying why.
    expect(isProxied("/sw.js")).toBe(false);
  });

  it("skips the manifest", () => {
    expect(isProxied("/manifest.webmanifest")).toBe(false);
  });

  it.each([
    "/robots.txt",
    "/sitemap.xml",
    "/favicon.ico",
    "/logo.png",
    "/hero.jpg",
    "/icon.svg",
    "/font.woff2",
    "/_next/static/chunks/main.js",
    "/_next/image",
  ])("skips %s", (path) => {
    expect(isProxied(path)).toBe(false);
  });
});

describe("the exclusions are anchored, not prefixes", () => {
  // The bug this file exists to prevent: an unescaped dot or a missing `$`
  // quietly widens an exclusion into neighbouring paths.
  it.each(["/sw.json", "/swxjs", "/manifest.webmanifest.txt", "/a/sw.js", "/m/manifest.webmanifest"])(
    "still proxies %s",
    (path) => {
      expect(isProxied(path)).toBe(true);
    },
  );
});
