import { cn } from "@/lib/utils";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
}

/**
 * A restaurant's logo as a small white tile — or its initials when it has not
 * uploaded one, so a card never shows an empty corner where the brand goes.
 *
 * Decorative (`alt=""`): every caller prints the restaurant's name beside it.
 */
export function RestaurantLogo({
  name,
  logoUrl,
  className,
}: {
  name: string;
  logoUrl: string | null;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg border border-white/70 bg-white shadow-md",
        className,
      )}
    >
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" loading="lazy" className="size-full object-contain p-1" />
      ) : (
        <span aria-hidden className="font-display text-sm font-bold text-primary">
          {initials(name)}
        </span>
      )}
    </span>
  );
}
