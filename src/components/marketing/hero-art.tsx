/**
 * Hero visuals.
 *
 * The organic blob frame is the design signature carried over from the PHP
 * hero; the photograph inside it is now CHOSEN BY AN ADMINISTRATOR at
 * /a/appearance rather than compiled in. `lib/appearance.ts` supplies the
 * shipped defaults, so an untouched install still looks finished.
 *
 * The blob clip keeps the hero's zero-effort relationship with light and dark:
 * the photo carries its own palette and the surrounding UI stays token-driven.
 */

import Image from "next/image";

/** Stretch the organic frame from the PHP hero into a CSS clip — it draws
 *  faster than an SVG clipPath on mobile and supports the same path syntax. */
const BLOB_PATH =
  "M200 12c62 0 118 26 152 76s40 116 22 176-70 108-134 122-140-6-182-56S8 200 26 140 138 12 200 12Z";

export function HeroPhoto({
  src,
  alt,
  className,
}: {
  src: string;
  /** Describes the PHOTOGRAPH, so it is translated by the caller. */
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
        // The hero photograph is the largest thing above the fold on the
        // landing page, and it IS the Largest Contentful Paint. Letting it
        // lazy-load costs the metric the whole site is judged on.
        priority
      />
      {/* Echo the old stroke — the clip eats the border's corners too. */}
      <div aria-hidden className="absolute inset-0 border-2" style={{ borderColor: "var(--border)" }} />
    </div>
  );
}
