import type { NextConfig } from "next";

/**
 * Every upload is served from the Supabase CDN, and next/image refuses any
 * host that is not allow-listed — so without this, every logo, dish photo and
 * avatar renders as a 400 the moment uploads move off the local disk.
 *
 * Derived from the environment rather than hardcoded: the project ref is part
 * of the hostname, so a pinned literal would break the day this is pointed at
 * a different Supabase project (staging, or a restore).
 */
const supabaseHostname = (() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    // A malformed URL is a deployment misconfiguration, not a reason to fail
    // the build — the Supabase client will report it far more clearly.
    return null;
  }
})();

/**
 * Content-Security-Policy for the whole app.
 *
 * The three concessions, each deliberate:
 *  · `'unsafe-inline'` for script — the first-visit theme probe in layout.tsx
 *    must run before hydration and is therefore an inline tag. Next.js also
 *    inlines RSC flight data. This is the standard trade-off for a theme
 *    script; everything else still has to come from our origin.
 *  · `'unsafe-eval'` — needed by Turbopack in development; the production
 *    bundle does not require it, but a config that breaks `next dev` is worse
 *    than a CSP that is slightly looser in prod.
 *  · `connect-src` is widened to the Supabase project (REST + Realtime
 *    websocket); `img-src` and `media-src` to the Supabase storage bucket.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY `media-src` IS SPELLED OUT RATHER THAN LEFT TO `default-src`.
 *
 *  It was left to `default-src 'self'`, and that silently broke the custom
 *  notification sound the day the feature shipped. The six built-in sounds
 *  are same-origin files in public/sounds, so they satisfied `'self'` and
 *  everything looked fine; an UPLOADED sound is served from the Supabase
 *  CDN, and `Audio.play()` rejected with nothing to say for itself — the
 *  file was stored perfectly, publicly readable, correct bytes and correct
 *  content type, and the browser would still not touch it.
 *
 *  `img-src` had already been widened for exactly this reason. Audio needed
 *  the same widening and did not get it, because no audio had ever come from
 *  off-origin before.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Everything else is locked down: no frames, no plugin objects, no external
 * fonts/scripts, base-uri and form-action pinned to self.
 */
function contentSecurityPolicy(production: boolean): string {
  // The REST/CDN origin, and the websocket origin Realtime dials. Only
  // `connect-src` has any use for the wss:// form.
  const https = supabaseHostname ? ` https://${supabaseHostname}` : "";
  const sockets = supabaseHostname ? ` wss://${supabaseHostname}` : "";
  const upgrade = production ? " upgrade-insecure-requests;" : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://www.gstatic.com`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https://images.unsplash.com${https} https://*.google-analytics.com https://*.googletagmanager.com`,
    // The notification sound: the built-ins from our own origin, an uploaded
    // one from the storage bucket.
    `media-src 'self' data: blob:${https}`,
    "font-src 'self' data:",
    `connect-src 'self' https://firebaseinstallations.googleapis.com https://firebase.googleapis.com https://fcm.googleapis.com https://fcmregistrations.googleapis.com https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com${https}${sockets}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    upgrade,
  ]
    .filter(Boolean)
    .join("; ");
}

const nextConfig: NextConfig = {
  reactCompiler: true,
  async redirects() {
    return ["www.resto237.online", "resto237.vercel.app", "resto237-emmanuel-legrands-projects.vercel.app"].map(host => ({
      source: "/:path*", has: [{ type: "host" as const, value: host }], destination: "https://resto237.online/:path*", permanent: true,
    }));
  },

  /**
   * Security headers on every response, including /sw.js and other public
   * assets. The CSP above is the centrepiece; the rest are the cheap ones.
   */
  async headers() {
    return [
      {
        // A service worker controls how background notifications are handled.
        // It must always be revalidated; a week-old CDN copy can otherwise
        // keep the exact mobile bug we already deployed a fix for.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        // The sideloaded Android build. The explicit type is what makes Android
        // offer "Install" instead of an unknown-file prompt; revalidation means
        // a new release replaces the old file on the CDN at once.
        source: "/downloads/:file*.apk",
        headers: [
          { key: "Content-Type", value: "application/vnd.android.package-archive" },
          { key: "Content-Disposition", value: 'attachment; filename="Resto237.apk"' },
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Clickjacking: even with frame-ancestors 'none' in the CSP, this
          // covers the legacy browsers that ignore it.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value: contentSecurityPolicy(process.env.NODE_ENV === "production"),
          },
        ],
      },
    ];
  },

  images: {
    remotePatterns: [
      // Marketing photos shipped as DEFAULTS for the landing page. An
      // administrator replaces them from /a/appearance, at which point the
      // images come from the bucket below instead.
      { protocol: "https", hostname: "images.unsplash.com" },

      ...(supabaseHostname
        ? [{ protocol: "https" as const, hostname: supabaseHostname, pathname: "/storage/v1/object/public/**" }]
        : []),
    ],
  },

  experimental: {
    serverActions: {
      /**
       * ─────────────────────────────────────────────────────────────────────
       *  THIS IS NOT A LIMIT, IT IS A CEILING ABOVE ONE.
       *
       *  Every image in this app is uploaded through a Server Action, and
       *  Server Actions cap their request body at 1 MB by default. Meanwhile
       *  `lib/uploads.ts` accepts up to 2 MB and the picker tells the user so.
       *  The result was a dish photo between 1 and 2 MB being rejected by the
       *  framework before a single line of our code ran — "Body exceeded 1 MB
       *  limit", with the dish silently not saved.
       *
       *  4 MB, not 2, because the multipart envelope carries the rest of the
       *  form alongside the file and a 2 MB image does not make a 2 MB body.
       *
       *  THE REAL LIMIT IS STILL 2 MB AND STILL ENFORCED TWICE: once in the
       *  browser by ImageUpload as a courtesy, and once on the server by
       *  saveUpload, which also sniffs the magic bytes. This number only stops
       *  the framework from refusing a request our own rules would have
       *  accepted.
       * ─────────────────────────────────────────────────────────────────────
       */
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
