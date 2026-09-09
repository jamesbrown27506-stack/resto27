import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Inter, Playfair_Display } from "next/font/google";
import { cookies } from "next/headers";
import { THEME_COOKIE, themeScript } from "@/components/theme/theme-provider";
import { LocaleProvider } from "@/lib/i18n/locale-provider";
import { getLocale } from "@/lib/i18n/locale-server";
import { getBranding } from "@/lib/branding";
import { getCartConfig } from "@/lib/orders/cart-config";
import { ToastProvider } from "@/components/ui/toast";
import { CartProvider } from "@/components/cart/cart-provider";
import { PwaPrompts } from "@/components/notifications/pwa-prompts";
import { FirebaseInit } from "@/components/firebase/firebase-init";
import { PushSync } from "@/components/notifications/push-sync";
import { SkipLink } from "@/components/layout/skip-link";
import { NavigationProgress } from "@/components/layout/navigation-progress";
import { TranslationSafeBoundary } from "@/components/layout/translation-safe";
import "./globals.css";

/**
 * Fonts are self-hosted at build time by next/font.
 *
 * The PHP version loaded these from fonts.googleapis.com with two preconnects
 * — a render-blocking third-party request on every page, plus a visible swap
 * when the webfont finally arrived. Self-hosting removes both, and matters
 * disproportionately on the mobile connections most diners are using.
 */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  display: "swap",
});

/**
 * Metadata is GENERATED, not a constant, because the platform name, tagline
 * and favicon come from /a/settings.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY favicon.ico MOVED OUT OF app/
 *
 *  Next gives FILE-BASED metadata higher priority than config-based metadata.
 *  While `src/app/favicon.ico` existed it silently overrode whatever `icons`
 *  said here — so uploading a favicon in the admin panel changed a database
 *  row, changed the settings page, and changed nothing in the browser tab.
 *
 *  The default now lives at `public/favicon.ico`, which is an ordinary static
 *  file with no special standing, and `icons` below is the only thing
 *  deciding what a tab shows.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBranding();

  return {
    metadataBase: new URL("https://resto237.online"),
    verification: process.env.GOOGLE_SITE_VERIFICATION ? { google: process.env.GOOGLE_SITE_VERIFICATION } : undefined,
    title: {
      default: `${brand.tagline} | ${brand.name}`,
      template: `%s | ${brand.name}`,
    },
    description:
      "Commandez vos plats préférés en livraison ou à emporter et réservez votre table dans les meilleurs restaurants de Douala.",
    robots: { index: true, follow: true, "max-image-preview": "large" },
    openGraph: { type: "website", siteName: brand.name, locale: "fr_CM" },
    twitter: { card: "summary_large_image" },
    // Uploaded files get server-generated UUID names, so a new favicon is a
    // new URL — no cache-busting query string needed, and no stale tab icon.
    icons: { icon: brand.faviconUrl ?? "/favicon.ico" },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F4ED" },
    { media: "(prefers-color-scheme: dark)", color: "#131410" },
  ],
};

/**
 * Reading cookies here makes every route dynamic.
 *
 * That is the price of server-rendering the language and the theme, and it is
 * worth paying: the alternative is what we had — the server guessing French +
 * light, the client correcting it during hydration, and React tearing down and
 * rebuilding the tree every single page load. Nearly every page in this app
 * already reads a session anyway, so the number of genuinely static routes we
 * give up is close to zero.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [locale, cookieStore, cartConfig, brand] = await Promise.all([
    getLocale(),
    cookies(),
    // The service charge and loyalty rates are settings, not constants. Read
    // here so the basket renders the right total on its first paint instead of
    // showing 5 % and correcting itself once a client fetch lands.
    getCartConfig(),
    // The install banner greets the visitor by the platform's own name.
    getBranding(),
  ]);

  const stored = cookieStore.get(THEME_COOKIE)?.value;
  const theme = stored === "dark" ? "dark" : "light";

  return (
    <html
      lang={locale}
      data-theme={theme}
      suppressHydrationWarning
      className={`${inter.variable} ${playfair.variable}`}
    >
      <head>
        {/*
          The ONLY remaining pre-paint script, and it ships on every page via
          next/script's `beforeInteractive` strategy: injected into the
          initial HTML <head> and executed synchronously during parsing —
          before paint, before hydration, and never as part of the React tree
          (which is what avoids React 19's "scripts inside React components
          are never executed" warning, the reason a plain <script> element
          cannot do this job).

          On a first visit there is no theme cookie, so it reads the OS
          preference, applies it before the first paint (no white flash) and
          writes the cookie — after which the server renders `data-theme`
          itself. On later visits it re-reads that cookie and re-applies the
          attribute the server already rendered; a no-op, but idempotent, and
          the script keeps the first paint safe even if the cookie ever fails
          to reach the server.

          The locale needs no equivalent: Accept-Language arrives with the
          request, so the server already knows the answer.
        */}
        <Script
          id="theme-probe"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: themeScript }}
        />
        {/*
          PWA plumbing — the manifest is what makes the site installable, and
          iOS Safari's Web Push (16.4+) only delivers to sites installed to
          the home screen. /manifest.webmanifest is a generated route (app/
          manifest.ts) that serves the app icon the administrator uploaded in
          /a/settings → Branding, falling back to public/app-icon-*.png
          (generated by scripts/generate-app-icon.mjs). The apple-touch-icon
          and home-screen title follow the same branding, so a rebranded
          platform rebrands its installed app too.

          The <link rel="manifest"> itself is NOT written here: because
          app/manifest.ts exists, Next emits that tag on every page by itself.
          Adding it manually as well shipped the element twice in every
          document — harmless to browsers, but duplicated bytes site-wide and
          the sort of thing that reads as a mistake in an audit.
        */}
        {/*
          Speculation Rules — prefetch the next document before it is asked for.

          `<Link>` already prefetches within the app, but that only covers
          client-side navigations. These rules cover full document loads, which
          is what a visitor arriving from a search result actually performs.

          `prefetch`, not `prerender`, and `moderate` eagerness (fires on
          hover): prerendering fully executes the destination, which on this
          site would run analytics and cart state for pages nobody chose to
          open. The exclusion list is the point — a prefetched /logout or
          /checkout is a request with consequences, so anything that mutates
          state or belongs to a signed-in area is left out.
        */}
        <script
          type="speculationrules"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              prefetch: [
                {
                  where: {
                    and: [
                      { href_matches: "/*" },
                      {
                        not: {
                          href_matches: [
                            "/a/*", "/m/*", "/api/*",
                            "/cart", "/cart/*", "/checkout", "/checkout/*",
                            "/account", "/account/*", "/orders", "/orders/*",
                            "/settings/*", "/profile/*", "/addresses/*",
                            "/loyalty/*", "/favorites/*",
                            "/login", "/logout", "/register/*",
                          ],
                        },
                      },
                    ],
                  },
                  eagerness: "moderate",
                },
              ],
            }),
          }}
        />
        <link rel="apple-touch-icon" href={brand.iconUrl ?? "/app-icon-180.png"} />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content={brand.name} />
      </head>
      {/*
        suppressHydrationWarning on <body> as well as <html>.

        Browser extensions inject attributes onto <body> before React
        hydrates — ColorZilla adds `cz-shortcut-listen`, Grammarly adds
        `data-gr-ext-installed`, and password managers add their own. React
        compares the DOM against the server HTML, sees an attribute it never
        rendered, and reports a hydration mismatch that is not our bug and that
        we cannot prevent from the application side. Suppressing it here is the
        documented remedy; it only silences attribute diffs on this one
        element, not anywhere else in the tree.
      */}
      <body suppressHydrationWarning className="min-h-dvh bg-bg text-text">
        {/*
          Outermost so it covers every page, INCLUDING the skip link — that was
          a gap in the first version: SkipLink is a client component rendering
          translated text, so it could crash outside the boundary meant to
          protect it.

          Browser auto-translation rewrites text nodes out from under React,
          and without this the next re-render blanks the whole app. See the
          component for the detail.
        */}
        <TranslationSafeBoundary>
          {/* Outside SkipLink would be a bug: SkipLink is the first thing that
              renders translated text, and it is what the mismatch surfaced on. */}
          <LocaleProvider initial={locale}>
            {/*
              Above everything, and outside the toast/cart providers, because it
              must acknowledge a tap on ANY link on ANY page — including the
              ones that navigate away from a provider's subtree.
            */}
            <NavigationProgress />
            <SkipLink />
            <ToastProvider>
              {/*
                The cart lives at the root, not inside (customer), because GUESTS
                HAVE A CART (§2) — someone must be able to fill a basket from the
                public pages and keep it through sign-in.
              */}
              <CartProvider config={cartConfig}>{children}</CartProvider>
              {/*
                The install / notification banners: mounted once, for every
                page. They check the install state and the notification
                permission on load, and a dismissed banner stays quiet for
                one hour before asking again.
              */}
              <PwaPrompts brandName={brand.name} />
              {/*
                Push self-repair. Renders nothing; it re-registers the service
                worker and re-stores this browser's subscription on every app
                open, which is what stops push from silently dying until
                somebody toggles the switch off and on again. See push-sync.
              */}
              <PushSync />
              <FirebaseInit />
            </ToastProvider>
          </LocaleProvider>
        </TranslationSafeBoundary>
      </body>
    </html>
  );
}
