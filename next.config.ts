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

const nextConfig: NextConfig = {
  reactCompiler: true,

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
