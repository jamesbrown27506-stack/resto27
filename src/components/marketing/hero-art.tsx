/**
 * Hero visuals.
 *
 * Real photography from Unsplash, clipped to the organic blob shape the PHP
 * hero used — the frame is the design signature, the content is now a photo.
 *
 * These are remote (marketing placeholder until real restaurant photography
 * exists; images.unsplash.com is allow-listed in next.config.ts). The blob
 * clip keeps the hero's zero-effort relationship with light/dark: the photo
 * carries its own palette and the surrounding UI stays token-driven.
 */

import Image from "next/image";

type ArtProps = { className?: string };

/** Stretch the organic frame from the PHP hero into a CSS clip — it draws
 *  faster than an SVG clipPath on mobile and supports the same path syntax. */
const BLOB_PATH =
  "M200 12c62 0 118 26 152 76s40 116 22 176-70 108-134 122-140-6-182-56S8 200 26 140 138 12 200 12Z";

function Photo({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const frameClass = ["relative", className].filter(Boolean).join(" ");
  return (
    <div className={frameClass} style={{ clipPath: `path("${BLOB_PATH}")` }}>
      <Image
        src={src}
        alt={alt}
        fill
        sizes="(min-width: 1024px) 28rem, 100vw"
        className="object-cover"
      />
      {/* Echo the old stroke — the clip eats the border's corners too. */}
      <div aria-hidden className="absolute inset-0 border-2" style={{ borderColor: "var(--border)" }} />
    </div>
  );
}

/* ── 1. Order — food, the actual product ────────────────────────────────── */

export function OrderArt({ className }: ArtProps) {
  return (
    <Photo
      className={className}
      src="https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=1200&q=80"
      alt="Un plat coloré servi dans un restaurant de Douala"
    />
  );
}

/* ── 2. Book — a laid table for two ────────────────────────────────────── */

export function BookArt({ className }: ArtProps) {
  return (
    <Photo
      className={className}
      src="https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=1200&q=80"
      alt="Une table dressée pour un dîner à deux"
    />
  );
}

/* ── 3. Explore — the city ─────────────────────────────────────────────── */

export function ExploreArt({ className }: ArtProps) {
  return (
    <Photo
      className={className}
      src="https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?auto=format&fit=crop&w=1200&q=80"
      alt="Vue nocturne d'une ville animée"
    />
  );
}