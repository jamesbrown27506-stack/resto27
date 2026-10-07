import type { NextConfig } from "next";
import release from "./src/lib/app-release.json";
import { contentSecurityPolicy } from "./src/lib/security/csp";

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

const nextConfig: NextConfig = {
  reactCompiler: true,
  /*
    Every other host sends people to the canonical domain — EXCEPT the cron
    routes. The scheduler (pg_cron + pg_net, migration 0045) calls
    /api/cron/* with a bearer secret at whatever host it was scheduled
    against; following a redirect to another host drops the Authorization
    header, so every sweep answered 401. That silently stopped order
    reminders and every other background job from the day this redirect
    shipped until the exemption.
  */
  async redirects() {
    const hosts = ["www.resto237.online", "resto237.vercel.app", "resto237-emmanuel-legrands-projects.vercel.app"].map(host => ({
      source: "/:path((?!api/cron/).*)", has: [{ type: "host" as const, value: host }], destination: "https://resto237.online/:path", permanent: true,
    }));
    // The APK is published under its version (resto237-1.4.apk); the old
    // unversioned link keeps working and always means "the latest". A
    // temporary redirect, because its target changes with every release.
    const latestApk = release.android.url !== "/downloads/resto237.apk"
      ? [{ source: "/downloads/resto237.apk", destination: release.android.url, permanent: false }]
      : [];
    return [...hosts, ...latestApk];
  },

  /**
   * Security headers on every response, including /sw.js and other public
   * assets. Page CSP nonces are supplied by the request proxy.
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
          { key: "Content-Security-Policy", value: contentSecurityPolicy({ production: process.env.NODE_ENV === "production", supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL }) },
        ],
      },
      {
        // The sideloaded Android build. The explicit type is what makes Android
        // offer "Install" instead of an unknown-file prompt; revalidation means
        // a new release replaces the old file on the CDN at once.
        source: "/downloads/:file*.apk",
        headers: [
          { key: "Content-Type", value: "application/vnd.android.package-archive" },
          // No fixed filename: the browser keeps the versioned name from the
          // URL (resto237-1.4.apk) instead of piling up "Resto237 (1).apk".
          { key: "Content-Disposition", value: "attachment" },
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
          // geolocation=(self), not (): the checkout's "Ajouter ma position au
          // repère" button now works in phone browsers too (it was app-only),
          // and `()` disables navigator.geolocation for our own pages as well.
          // Third-party frames stay blocked.
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },

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
