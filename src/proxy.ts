import { NextResponse, type NextRequest } from "next/server";
import { isPublicPage } from "@/lib/seo-config";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Root proxy — refreshes the Supabase session and does the cheap redirect.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHAT THIS LAYER IS AND IS NOT FOR
 *
 *  It runs at the edge, before the page, and knows one thing: is there a
 *  verified session. That makes it the right place to bounce an anonymous
 *  visitor off /m before rendering anything, and to keep a signed-in user off
 *  /login.
 *
 *  It is NOT authorization. It cannot see `profiles.status`, the platform
 *  role, or the per-branch capability — those need the database. Every
 *  protected area re-checks server-side in its own layout, and a Server Action
 *  reached directly never passes through here at all.
 * ─────────────────────────────────────────────────────────────────────────
 */

/**
 * Areas that require a session. Prefix match.
 *
 * `/browse` and `/cart` are deliberately absent. §14.3 marks browse as
 * customer-only, but §2 is emphatic that GUESTS HAVE A CART which merges on
 * sign-in — "forcing registration before someone can see a total is the single
 * biggest drop-off point in food ordering". A guest who cannot reach the page
 * with the add-to-cart button has no way to build one. Checkout is where the
 * account becomes necessary, and that is protected.
 */
const PROTECTED = [
  "/messages",
  "/account",
  "/orders",
  "/checkout",
  "/reservations",
  "/favorites",
  "/addresses",
  "/loyalty",
  "/reviews",
  "/profile",
  "/settings",
  "/m",
  "/a",
];

/** Signed-in users have no business here. */
const AUTH_ONLY = ["/login", "/register", "/forgot-password"];

function matches(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function proxy(request: NextRequest) {
  request.headers.delete("x-resto-public-locale");
  if (isPublicPage(request.nextUrl.pathname)) {
    request.headers.set("x-resto-public-locale", request.nextUrl.searchParams.get("lang") === "en" ? "en" : "fr");
  }
  const { supabaseResponse, user } = await updateSession(request);
  const publicLocale = request.headers.get("x-resto-public-locale");
  if (publicLocale) supabaseResponse.cookies.set("restolink-locale", publicLocale, { path: "/", sameSite: "lax", maxAge: 31536000 });
  const { pathname, search } = request.nextUrl;

  // /a/health is a machine endpoint for uptime monitoring — it must answer
  // without a session, or the monitor reports the site down whenever it is up.
  if (pathname === "/a/health") return supabaseResponse;

  if (!user && matches(pathname, PROTECTED)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    // Carry the destination so sign-in returns them where they were going,
    // rather than dumping everyone on the same dashboard.
    url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  if (user && matches(pathname, AUTH_ONLY)) {
    const url = request.nextUrl.clone();
    url.pathname = "/account";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Everything except:
     *   _next/static, _next/image  — build output, no session needed
     *   favicon / images / fonts   — static assets
     *   robots.txt, sitemap.xml    — crawled anonymously
     *   .apk                       — the Android download, fetched anonymously
     *
     * Excluding assets matters: this runs per request, and each run is a
     * network call to the auth server. Matching every .svg would triple the
     * request count on the homepage for nothing.
     *
     * ───────────────────────────────────────────────────────────────────────
     *  sw.js AND THE MANIFEST ARE EXCLUDED FOR A SECOND, SHARPER REASON.
     *
     *  `.js` is not in the extension list above, so the service worker script
     *  was matching — every registration and every update check spent a round
     *  trip verifying a session it does not have and does not need. Worse, it
     *  put the worker's availability behind the auth host's: a slow or failing
     *  verification delayed or broke the response, and a service worker that
     *  fails to register fails SILENTLY. Push then stops arriving with nothing
     *  anywhere saying why, which is the exact class of fault being chased.
     *
     *  Neither file can carry a session or act on one. Excluding them makes
     *  installing the app and refreshing the worker independent of auth.
     * ───────────────────────────────────────────────────────────────────────
     */
    "/((?!_next/static|_next/image|\\.well-known/|favicon.ico|robots.txt|sitemap.xml|sw\\.js$|manifest\\.webmanifest$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?|apk)$).*)",
  ],
};
