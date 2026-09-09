import { ImageResponse } from "next/og";
import { getBranding } from "@/lib/branding";
import { PUBLIC_SITE_URL } from "@/lib/seo-config";

/**
 * The favicon, re-served at a sane size from our own origin.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY THIS EXISTS.
 *
 *  Google was showing the generic globe next to resto237.online. The cause
 *  was not what it looks like from the outside: the site DOES declare
 *  `<link rel="icon">`, and it points at the image an administrator uploaded
 *  in /a/settings, which lives in Supabase storage.
 *
 *  Cross-origin is fine — Google's own documentation says so explicitly
 *  ("The URL doesn't need to be hosted on your site... could be hosted on a
 *  content delivery network"). The problem is the file. The uploaded image
 *  was 1254x1254 and 847 KB, because it is the same asset used for the PWA
 *  icon and the header wordmark. That is three orders of magnitude past what
 *  a 48x48 favicon slot needs, and it is fetched by every browser tab on
 *  every page as well as by the crawler.
 *
 *  So this route renders whatever the administrator chose down to 192px and
 *  serves it as PNG from resto237.online. 192 rather than 48: Google
 *  downscales to 48 itself and recommends supplying something larger, and the
 *  same URL is reused by browser tabs on high-density screens.
 *
 *  WHY A ROUTE AND NOT `app/icon.tsx`.
 *
 *  Next gives FILE-BASED metadata higher priority than the `icons` config —
 *  the comment above generateMetadata in app/layout.tsx records what happened
 *  last time that was forgotten, when a stray app/favicon.ico silently
 *  overrode the admin setting and made the branding screen look broken. An
 *  `app/icon.tsx` would do exactly that again. A plain route referenced BY
 *  the metadata keeps the administrator in control.
 *
 *  PNG, not WebP. Google's favicon formats are BMP, GIF, ICO, PNG, JPEG, PPM
 *  and TIFF — WebP is not among them, which is also why this does not simply
 *  point at /_next/image, whose output format follows the Accept header.
 * ─────────────────────────────────────────────────────────────────────────
 */

export const size = { width: 192, height: 192 };
export const contentType = "image/png";

/** Branding changes rarely, and a stale tab icon is not a correctness bug. */
export const revalidate = 86400;

export async function GET() {
  const brand = await getBranding();
  const source = brand.faviconUrl ?? brand.iconUrl ?? brand.logoUrl;

  // No uploaded branding: hand back the static icon rather than rendering an
  // empty square, which would look like the platform has no identity at all.
  if (!source) {
    return Response.redirect(new URL("/app-icon-192.png", PUBLIC_SITE_URL), 307);
  }

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          alignItems: "center",
          justifyContent: "center",
          // The uploaded mark is rarely square and often transparent. A solid
          // ground keeps it legible against both a light and a dark tab strip,
          // which a transparent PNG cannot promise.
          background: "#ffffff",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={source}
          alt=""
          width={192}
          height={192}
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
        />
      </div>
    ),
    size,
  );
}
