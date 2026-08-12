/**
 * Hero illustrations.
 *
 * Inline SVG rather than photography, for three reasons:
 *
 *  1. There is no real photography yet (frontend.md §8, question 3). Stock food
 *     photos are the fastest way to look like a template.
 *  2. Zero network requests. The hero image is the LCP element, and three of
 *     them in a rotating carousel is the entire first-paint budget on a mobile
 *     connection — which is most of this audience.
 *  3. They read the design tokens, so they follow light/dark automatically. A
 *     photograph does not.
 *
 * Swap these for `next/image` when real photos exist; the surrounding layout
 * does not change.
 */

type ArtProps = { className?: string };

/** Soft organic frame, echoing the blob shape from the PHP hero. */
function Blob({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 400 400"
      role="presentation"
      className="size-full"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <clipPath id="hero-blob">
          <path d="M200 12c62 0 118 26 152 76s40 116 22 176-70 108-134 122-140-6-182-56S8 200 26 140 138 12 200 12Z" />
        </clipPath>
        <linearGradient id="hero-wash" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--primary-light)" />
          <stop offset="55%" stopColor="var(--surface-2)" />
          <stop offset="100%" stopColor="var(--primary-light)" />
        </linearGradient>
      </defs>

      <g clipPath="url(#hero-blob)">
        <rect width="400" height="400" fill="url(#hero-wash)" />
        {children}
      </g>

      <path
        d="M200 12c62 0 118 26 152 76s40 116 22 176-70 108-134 122-140-6-182-56S8 200 26 140 138 12 200 12Z"
        fill="none"
        stroke="var(--border)"
        strokeWidth="2"
      />
    </svg>
  );
}

/* ── 1. Order — a bowl of food, seen from above ────────────────────────── */

export function OrderArt({ className }: ArtProps) {
  return (
    <div className={className}>
      <Blob>
        {/* Table surface */}
        <circle cx="200" cy="210" r="150" fill="var(--surface)" opacity="0.55" />

        {/* Bowl */}
        <circle cx="200" cy="205" r="118" fill="var(--surface)" stroke="var(--border)" strokeWidth="3" />
        <circle cx="200" cy="205" r="98" fill="var(--primary-light)" />

        {/* Rice / base */}
        <circle cx="200" cy="205" r="86" fill="var(--surface-2)" />

        {/* Plantain slices — the DG signature */}
        {[
          [168, 168, -18],
          [214, 160, 12],
          [246, 196, 34],
          [232, 244, -8],
          [180, 254, 22],
          [148, 214, 8],
        ].map(([x, y, r], i) => (
          <g key={i} transform={`translate(${x} ${y}) rotate(${r})`}>
            <ellipse rx="26" ry="17" fill="var(--accent)" />
            <ellipse rx="18" ry="10" fill="var(--accent-hover)" opacity="0.45" />
          </g>
        ))}

        {/* Greens */}
        {[
          [196, 206, 0],
          [166, 190, 40],
          [228, 220, -30],
        ].map(([x, y, r], i) => (
          <g key={i} transform={`translate(${x} ${y}) rotate(${r})`}>
            <path d="M0 0c14-10 30-8 40 4-14 10-30 8-40-4Z" fill="var(--primary)" opacity="0.85" />
          </g>
        ))}

        {/* Pepper accents */}
        {[
          [186, 236],
          [222, 178],
          [154, 234],
        ].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="7" fill="var(--error)" opacity="0.75" />
        ))}

        {/* Steam */}
        {[150, 200, 250].map((x, i) => (
          <path
            key={x}
            d={`M${x} 96c10-14-10-22 0-36`}
            fill="none"
            stroke="var(--text-light)"
            strokeWidth="4"
            strokeLinecap="round"
            opacity={0.35 - i * 0.07}
          />
        ))}
      </Blob>
    </div>
  );
}

/* ── 2. Book — a laid table for two ────────────────────────────────────── */

export function BookArt({ className }: ArtProps) {
  return (
    <div className={className}>
      <Blob>
        {/* Tablecloth */}
        <rect x="40" y="120" width="320" height="220" rx="26" fill="var(--surface)" />
        <rect
          x="40"
          y="120"
          width="320"
          height="220"
          rx="26"
          fill="none"
          stroke="var(--border)"
          strokeWidth="2"
        />

        {/* Two place settings */}
        {[124, 276].map((cx) => (
          <g key={cx}>
            <circle cx={cx} cy="222" r="52" fill="var(--surface-2)" stroke="var(--border)" strokeWidth="2" />
            <circle cx={cx} cy="222" r="34" fill="var(--primary-light)" />
            {/* Fork */}
            <g stroke="var(--text-light)" strokeWidth="3" strokeLinecap="round">
              <line x1={cx - 74} y1="200" x2={cx - 74} y2="246" />
              <line x1={cx - 80} y1="200" x2={cx - 80} y2="214" />
              <line x1={cx - 68} y1="200" x2={cx - 68} y2="214" />
            </g>
            {/* Knife */}
            <line
              x1={cx + 74}
              y1="200"
              x2={cx + 74}
              y2="246"
              stroke="var(--text-light)"
              strokeWidth="4"
              strokeLinecap="round"
            />
          </g>
        ))}

        {/* Centrepiece: a small vase */}
        <g transform="translate(200 150)">
          <path d="M-14 34h28l-6-30h-16z" fill="var(--accent)" />
          <circle cx="0" cy="-8" r="12" fill="var(--primary)" />
          <circle cx="-14" cy="2" r="9" fill="var(--primary)" opacity="0.75" />
          <circle cx="14" cy="2" r="9" fill="var(--primary)" opacity="0.75" />
        </g>

        {/* Two chairs, hinted */}
        {[124, 276].map((cx) => (
          <rect
            key={cx}
            x={cx - 40}
            y="300"
            width="80"
            height="58"
            rx="16"
            fill="var(--primary)"
            opacity="0.18"
          />
        ))}
      </Blob>
    </div>
  );
}

/* ── 3. Explore — a neighbourhood map with pins ────────────────────────── */

export function ExploreArt({ className }: ArtProps) {
  return (
    <div className={className}>
      <Blob>
        {/* Streets */}
        <g stroke="var(--border)" strokeWidth="10" strokeLinecap="round">
          <line x1="20" y1="150" x2="380" y2="120" />
          <line x1="20" y1="270" x2="380" y2="292" />
          <line x1="120" y1="10" x2="96" y2="390" />
          <line x1="272" y1="10" x2="298" y2="390" />
        </g>

        {/* Blocks */}
        {[
          [40, 40, 62, 92],
          [150, 30, 96, 80],
          [318, 46, 60, 68],
          [40, 180, 58, 74],
          [152, 170, 92, 92],
          [322, 168, 56, 100],
          [46, 310, 52, 62],
          [156, 306, 90, 70],
          [326, 316, 56, 58],
        ].map(([x, y, w, h], i) => (
          <rect
            key={i}
            x={x}
            y={y}
            width={w}
            height={h}
            rx="10"
            fill="var(--surface)"
            opacity={i % 2 === 0 ? 0.9 : 0.62}
          />
        ))}

        {/* Pins */}
        {[
          [198, 132, "var(--primary)"],
          [96, 236, "var(--accent)"],
          [300, 214, "var(--primary)"],
          [196, 330, "var(--accent)"],
        ].map(([x, y, fill], i) => (
          <g key={i} transform={`translate(${x} ${y})`}>
            <ellipse cx="0" cy="6" rx="14" ry="5" fill="var(--text)" opacity="0.12" />
            <path
              d="M0 4c-9-12-16-19-16-28a16 16 0 1 1 32 0c0 9-7 16-16 28Z"
              fill={fill as string}
            />
            <circle cx="0" cy="-24" r="6" fill="var(--surface)" />
          </g>
        ))}

        {/* Search ring over the busiest pin */}
        <circle
          cx="198"
          cy="112"
          r="52"
          fill="none"
          stroke="var(--primary)"
          strokeWidth="3"
          strokeDasharray="8 10"
          opacity="0.6"
        />
      </Blob>
    </div>
  );
}
