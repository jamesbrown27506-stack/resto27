import Image from "next/image";
import { cn } from "@/lib/utils";

const SIZES = {
  xs: "size-6 text-[10px]",
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-14 text-base",
  xl: "size-20 text-xl",
} as const;

/** First letter of the first two words: "Marie Ngo" → "MN". */
function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Deterministic tint from the name, so the same person is the same colour on
 * every screen. Six hues drawn from the palette rather than a random hash into
 * full HSL, which produces colours that fight the brand.
 */
const TINTS = [
  "bg-primary-light text-primary",
  "bg-accent/20 text-accent-hover",
  "bg-info-light text-info",
  "bg-success-light text-success",
  "bg-warning-light text-warning",
  "bg-surface-2 text-text-secondary",
];

function tintFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return TINTS[Math.abs(hash) % TINTS.length];
}

export function Avatar({
  name,
  src,
  size = "md",
  className,
}: {
  name: string;
  src?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const dimension = { xs: 24, sm: 32, md: 40, lg: 56, xl: 80 }[size];

  if (src) {
    return (
      <Image
        src={src}
        alt=""
        width={dimension}
        height={dimension}
        className={cn("shrink-0 rounded-full object-cover", SIZES[size], className)}
      />
    );
  }

  return (
    <span
      // aria-hidden: the name is always rendered next to the avatar, and an
      // announced "MN" adds noise without adding information.
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-bold select-none",
        SIZES[size],
        tintFor(name),
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
