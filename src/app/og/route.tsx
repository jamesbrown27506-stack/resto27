import { ImageResponse } from "next/og";
import { getBranding } from "@/lib/branding";

/**
 * The share card, at the size share cards are actually rendered at.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY THIS EXISTS.
 *
 *  `publicMetadata` fell back to `/app-icon-512.png` for any page without its
 *  own image — which is every page except restaurant and dish pages. That file
 *  is a 512×512 app icon, while the same metadata declares
 *  `twitter:card: summary_large_image`, a format that expects roughly 1200×630.
 *  So the homepage, /pricing, /contact, /about and every discovery page shared
 *  as a small square logo letterboxed into a wide frame, or were rejected
 *  outright by platforms that enforce a minimum width.
 *
 *  Generating it rather than shipping a PNG keeps it correct when an
 *  administrator changes the brand name in settings: the card follows the
 *  brand instead of being a binary someone has to remember to re-export.
 * ─────────────────────────────────────────────────────────────────────────
 */

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Cached hard: this changes only when branding does. */
export const revalidate = 86400;

export async function GET() {
  const brand = await getBranding();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 80,
          background: "linear-gradient(135deg, #1b3a2f 0%, #2f5d4a 55%, #c2703d 100%)",
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: 9,
              background: "#e8a06a",
              display: "flex",
            }}
          />
          <div style={{ fontSize: 30, letterSpacing: 6, textTransform: "uppercase", opacity: 0.85 }}>
            Douala, Cameroun
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 88, fontWeight: 700, lineHeight: 1.05 }}>{brand.name}</div>
          <div style={{ marginTop: 24, fontSize: 40, lineHeight: 1.25, opacity: 0.9, maxWidth: 900 }}>
            {brand.tagline}
          </div>
        </div>

        <div style={{ display: "flex", fontSize: 28, opacity: 0.75 }}>
          resto237.online
        </div>
      </div>
    ),
    size,
  );
}
