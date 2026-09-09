import Image from "next/image";
import Link from "@/components/layout/public-link";
import { notFound, permanentRedirect } from "next/navigation";
import { fetchPublicRestaurantBySlug, fetchMenuSections } from "@/lib/data/public";
import { getLocale } from "@/lib/i18n/locale-server";
import { publicMetadata, jsonLdString } from "@/lib/seo";
import { absolutePublicUrl, dishPath, dishSlug } from "@/lib/seo-config";
import { MenuOrderer } from "@/components/menu/menu-orderer";

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
  return publicMetadata(c.path, `${c.dish.name} — ${c.restaurant.name}, Douala`, c.dish.description || `${c.dish.name} · ${c.restaurant.name} · ${c.restaurant.quartier}, Douala`, c.dish.imageUrl);
}
export default async function DishPage({ params }: Props) {
  const c = await content(params);
  const locale = await getLocale();
  const fr = locale === "fr";
  const url = absolutePublicUrl(c.path, locale);
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
    <Link className="font-semibold text-primary" href={`/restaurants/${c.restaurant.slug}`}>{fr ? "Voir le menu complet →" : "View the full menu →"}</Link>
  </main>;
}
