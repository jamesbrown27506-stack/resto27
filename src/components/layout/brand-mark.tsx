import Link from "@/components/layout/public-link";
import { UtensilsCrossed } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The platform's name and logo, wherever it appears.
 *
 * A plain presentational component taking values as props rather than reading
 * settings itself — so it works in client shells (the header, the sidebars)
 * that cannot touch the database. The server component above each one passes
 * the branding down.
 *
 * When no logo has been uploaded it falls back to a wordmark with an icon,
 * which is deliberately not "nothing": a fresh install should look finished.
 */
export function BrandMark({
  name,
  logoUrl,
  href = "/",
  size = "md",
  tone = "brand",
  className,
  title,
}: {
  name: string;
  logoUrl: string | null;
  /** null renders a non-clickable mark — for the print ticket and invoices. */
  href?: string | null;
  size?: "sm" | "md";
  /**
   * `inherit` for surfaces that invert their own colours — the footer sits on
   * dark green. An explicit prop rather than a className override because two
   * competing Tailwind text-colour utilities are resolved by stylesheet order,
   * not by the order they appear in the attribute, so the override is a
   * coin toss.
   */
  tone?: "brand" | "inherit";
  className?: string;
  title?: string;
}) {
  /**
   * THE LOGO REPLACES THE ICON, NOT THE NAME.
   *
   * The first version swapped the whole mark for the uploaded image, so
   * setting a logo silently deleted the platform's name from every header.
   * That is only right for a logo that already contains the wordmark, and we
   * cannot know whether it does — an admin uploading a square emblem would
   * end up with an unnamed site.
   *
   * Keeping the name means the worst case is a small duplication the admin
   * can see and decide about, rather than a disappearance they have to
   * diagnose. `alt=""` because the name is right there in text: announcing it
   * twice is noise for a screen reader.
   */
  const content = (
    <>
      {logoUrl ? (
        /*
          A plain <img>, not next/image.
          The logo is uploaded to our own filesystem at an arbitrary path with
          unknown dimensions, so next/image would need width and height we do
          not have — and optimising a 20 KB logo saves nothing worth the
          configuration.
        */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt=""
          className={cn("w-auto shrink-0 object-contain", size === "sm" ? "h-6" : "h-7")}
        />
      ) : (
        <UtensilsCrossed
          className={cn(
            "shrink-0",
            size === "sm" ? "size-4" : "size-5",
            tone === "brand" ? "text-primary" : "opacity-80",
          )}
          aria-hidden
        />
      )}
      <span className="truncate">{name}</span>
    </>
  );

  const classes = cn(
    "flex min-w-0 shrink-0 items-center gap-2 font-display font-bold",
    size === "sm" ? "text-base" : "text-xl",
    tone === "brand" ? "text-text" : "text-current",
    className,
  );

  if (href === null) {
    return <span className={classes}>{content}</span>;
  }

  return (
    <Link href={href} title={title} className={cn(classes, "transition-opacity hover:opacity-80")}>
      {content}
    </Link>
  );
}
