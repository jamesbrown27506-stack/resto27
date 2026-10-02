import Image from "next/image";
import { dishPriceLabel } from "@/lib/menu/custom-price";
import Link from "@/components/layout/public-link";
import { notFound, permanentRedirect } from "next/navigation";
import { fetchPublicRestaurantBySlug, fetchMenuSections } from "@/lib/data/public";
import { getLocale } from "@/lib/i18n/locale-server";
import { publicMetadata, jsonLdString } from "@/lib/seo";
import { absolutePublicUrl, discoverySlug, dishPath, dishSlug, isUsableDescription } from "@/lib/seo-config";
import { MenuOrderer } from "@/components/menu/menu-orderer";
import { formatMoney } from "@/lib/format/currency";
import { formatQuartier } from "@/lib/geo-cm";
import { fetchDiscoveryCatalog } from "@/lib/data/discovery";
import { ArrowRight, Star, Store } from "lucide-react";

type Props = { params: Promise<{ slug: string; dishId: string }> };
/**
 * Resolves `[dishId]` as a NAME SLUG first, then as a legacy UUID.
 *
 * Every dish URL used to be a bare UUID. Those are in Google's index and in
 * whatever links already exist, so they cannot simply stop working — a UUID
 * that still resolves is permanently redirected to its slug, which moves the
 * ranking signal across instead of dropping it. See `dishSlug`.
 */
async function content(params: Props["params"]) {
  const { slug, dishId } = await params;
  const restaurant = await fetchPublicRestaurantBySlug(slug);
  if (!restaurant) notFound();
  const sections = await fetchMenuSections(restaurant.id);

  const bySlug = sections
    .flatMap(section => section.items.map(item => ({ section, item })))
    .find(({ item }) => dishSlug(item.name, item.id) === dishId);

  if (!bySlug) {
    // Legacy UUID URL — send it to the slug, once and permanently.
    const legacy = sections.flatMap(section => section.items).find(item => item.id === dishId);
    if (legacy) permanentRedirect(dishPath(slug, legacy));
    notFound();
  }

  return {
    restaurant,
    dish: bySlug.item,
    section: bySlug.section,
    path: dishPath(slug, bySlug.item),
  };
}
export async function generateMetadata({ params }: Props) {
  const c = await content(params);
  const locale = await getLocale();
  const fr = locale === "fr";
  const place = [formatQuartier(c.restaurant.quartier), "Douala"].filter(Boolean).join(", ");
  /*
    The price goes in the title: "combien coûte le ndolé" and "<plat> prix"
    are how people search a dish, and the one dish site ranking in Douala
    ("Poulet DG 5000 — Mimosa · Douala") leads with it.
  */
  const price = c.dish.price > 0 ? dishPriceLabel(c.dish, (amount) => formatMoney(amount)) : null;
  const title = price
    ? `${c.dish.name} ${fr ? "à" : "for"} ${price} — ${c.restaurant.name}, Douala`
    : `${c.dish.name} — ${c.restaurant.name}, Douala`;
  // The partner's own words only when they are usable prose in this page's
  // language — the same gate as the restaurant page (see isUsableDescription).
  const description = isUsableDescription(c.dish.description, locale)
    ? c.dish.description
    : fr
      ? `${c.dish.name}${price ? ` à ${price}` : ""} chez ${c.restaurant.name} (${place}). Commandez-le en livraison ou à emporter sur Resto237.`
      : `${c.dish.name}${price ? ` for ${price}` : ""} at ${c.restaurant.name} (${place}). Order it for delivery or pickup on Resto237.`;
  return publicMetadata(c.path, title, description, c.dish.imageUrl);
}
/**
 * The same dish at the other restaurants that serve it, best placed first
 * (lib/discovery/placement). Someone who tapped "Eru & Water Fufu" wants the
 * eru — this restaurant's is one choice among several, and the page says so
 * instead of being a dead end. Never throws: a failed catalogue costs the
 * page this list, not the order button.
 */
async function sameDishElsewhere(dishName: string, restaurantId: string) {
  try {
    const { dishes } = await fetchDiscoveryCatalog();
    const slug = discoverySlug(dishName);
    const seen = new Set<string>([restaurantId]);
    return dishes
      .filter((d) => discoverySlug(d.name) === slug && d.restaurant_id !== restaurantId)
      .sort((a, b) => (a.restaurant.placement ?? 0) - (b.restaurant.placement ?? 0))
      .filter((d) => (seen.has(d.restaurant_id) ? false : (seen.add(d.restaurant_id), true)))
      .slice(0, 6);
  } catch {
    return [];
  }
}

export default async function DishPage({ params }: Props) {
  const c = await content(params);
  const locale = await getLocale();
  const fr = locale === "fr";
  const url = absolutePublicUrl(c.path, locale);
  const elsewhere = await sameDishElsewhere(c.dish.name, c.restaurant.id);
  const r = c.restaurant;
  const place = [r.cuisine, formatQuartier(r.quartier)].filter(Boolean).join(" · ");
  return <main className="container-page space-y-5 py-8">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString({ "@context": "https://schema.org", "@graph": [
      { "@type": "MenuItem", "@id": url + "#dish", name: c.dish.name, description: c.dish.description, url,
        image: c.dish.imageUrl ? new URL(c.dish.imageUrl, url).href : undefined,
        offers: { "@type": "Offer", price: c.dish.price, priceCurrency: "XAF", url, availability: c.dish.isAvailable && (!c.dish.trackStock || (c.dish.stockQuantity ?? 0) > 0) ? "https://schema.org/InStock" : "https://schema.org/OutOfStock" } },
      { "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: c.restaurant.name, item: absolutePublicUrl(`/restaurants/${c.restaurant.slug}`, locale) },
        { "@type": "ListItem", position: 2, name: c.dish.name, item: url },
      ] },
    ] }) }} />
    <Link className="text-sm text-primary" href={`/restaurants/${c.restaurant.slug}`}>← {c.restaurant.name}</Link>
    <h1 className="font-display text-3xl font-bold">{c.dish.name}</h1>
    <p className="text-text-secondary">{c.restaurant.name} · {c.restaurant.quartier}, Douala</p>
    {c.dish.imageUrl && <Image src={c.dish.imageUrl} alt={c.dish.name} width={900} height={600} sizes="(max-width: 768px) 100vw, 700px" className="max-h-[420px] w-full max-w-3xl rounded-xl object-cover" />}
    <p>{c.dish.description}</p>
    <MenuOrderer showDetailLinks={false} restaurant={c.restaurant} acceptingOrders={c.restaurant.isAcceptingOrders} menu={[{ category: c.section.category, items: [c.dish] }]} />

    {/* The restaurant behind the dish — one tap to its whole menu. */}
    <section aria-label={fr ? "Le restaurant" : "The restaurant"} className="max-w-3xl overflow-hidden rounded-lg border border-border bg-surface">
      <div className="relative h-28 bg-primary-light sm:h-36">
        {r.coverUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={r.coverUrl} alt="" loading="lazy" className="size-full object-cover" />
        )}
        <span className="absolute bottom-2 left-3 grid size-14 place-items-center overflow-hidden rounded-full border-2 border-surface bg-surface shadow-md">
          {r.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={r.logoUrl} alt="" loading="lazy" className="size-full object-cover" />
          ) : (
            <Store className="size-6 text-primary" aria-hidden />
          )}
        </span>
      </div>
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="truncate font-display text-xl font-bold">{r.name}</p>
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-text-secondary">
            {place && <span>{place}</span>}
            {r.reviewCount > 0 && (
              <span className="tnum flex items-center gap-1 font-semibold text-text">
                <Star className="size-3.5 fill-warning text-warning" aria-hidden />
                {r.rating.toFixed(1)}
              </span>
            )}
          </p>
        </div>
        <Link
          href={`/restaurants/${r.slug}`}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-5 font-semibold text-primary-fg transition-colors hover:bg-primary-hover"
        >
          {fr ? "Découvrir le restaurant" : "Discover the restaurant"}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </section>

    {elsewhere.length > 0 && (
      <section aria-labelledby="same-dish" className="max-w-3xl">
        <h2 id="same-dish" className="font-display text-2xl font-bold">
          {fr ? `${c.dish.name}, aussi chez` : `${c.dish.name}, also at`}
        </h2>
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface">
          {elsewhere.map((d) => (
            <li key={d.id}>
              <Link href={dishPath(d.restaurant.slug, d)} className="flex min-h-16 items-center gap-3 px-3 py-2.5 transition-colors hover:bg-primary-light sm:px-4">
                <span className="size-12 shrink-0 overflow-hidden rounded-md bg-primary-light">
                  {(d.image_url ?? d.restaurant.coverUrl) && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={(d.image_url ?? d.restaurant.coverUrl)!} alt="" loading="lazy" className="size-full object-cover" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{d.restaurant.name}</span>
                  <span className="block truncate text-sm text-text-secondary">{formatQuartier(d.restaurant.quartier)}</span>
                </span>
                {Number(d.price) > 0 && (
                  <span translate="no" className="tnum shrink-0 font-bold">{formatMoney(Number(d.price))}</span>
                )}
                <ArrowRight className="size-4 shrink-0 text-text-light" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
        <Link className="mt-3 inline-flex min-h-11 items-center gap-1 font-semibold text-primary" href={`/explore/food/${discoverySlug(c.dish.name)}`}>
          {fr ? "Comparer tous les restaurants" : "Compare every restaurant"}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </section>
    )}
  </main>;
}
