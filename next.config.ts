import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,

  images: {
    remotePatterns: [
      // Marketing photos on the landing page and hero (ephemeral until real
      // restaurant photography exists). Only the homepage references this
      // host — customer and manager uploads live in Supabase Storage.
      { protocol: "https", hostname: "images.unsplash.com" },
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
