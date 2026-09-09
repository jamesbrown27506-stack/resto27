import Link from "@/components/layout/public-link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { fetchDiscoveryCatalog } from "@/lib/data/discovery";
import { publicMetadata, jsonLdString } from "@/lib/seo";
import { absolutePublicUrl, discoverySlug, dishPath } from "@/lib/seo-config";
import { getLocale } from "@/lib/i18n/locale-server";
import { RestaurantCard } from "@/components/restaurant/restaurant-card";
import { formatMoney } from "@/lib/format/currency";
import { discoveryAvailability, discoveryIntro } from "@/lib/discovery-content";
import { formatQuartier } from "@/lib/geo-cm";
import { breadcrumbJsonLd } from "@/lib/breadcrumbs";

type Props = { params: Promise<{ kind: string; slug: string }> };
async function content(params: Props["params"]) {
  const { kind, slug } = await params;
  const catalog = await fetchDiscoveryCatalog();
  const group = catalog.groups.find(g => g.kind === kind && g.slug === slug);
  if (!group) notFound();
  const fr = await getLocale() === "fr";
  const displayName = kind === "neighbourhood" ? formatQuartier(group.name) : group.name;
  const title = kind === "neighbourhood" ? `${fr ? "Restaurants à" : "Restaurants in"} ${displayName}, Douala`
    : `${displayName} ${fr ? "à" : "in"} Douala`;
  const dishes = catalog.dishes.filter(d => discoverySlug(d.name) === slug);
  const restaurants = catalog.restaurants.filter(r => kind === "neighbourhood" ? discoverySlug(r.quartier) === slug
    : kind === "cuisine" ? discoverySlug(r.cuisine) === slug : dishes.some(d => d.restaurant.id === r.id));
  return { group, title, displayName, dishes, restaurants, fr, path: `/explore/${kind}/${slug}` };
}

/**
 * The description used to read "Découvrez 4 restaurant(s), leurs menus…".
 *
 * That literal "(s)" shipped to the SERP on every discovery page. It is the
 * kind of detail that reads as machine-generated at a glance, and the snippet
 * is the only thing a searcher sees before deciding whether to click.
 */
function metaDescription(count: number, title: string, fr: boolean): string {
  if (fr) {
    const noun = count > 1 ? `${count} restaurants` : count === 1 ? "1 restaurant" : "les restaurants";
    return `${title} : découvrez ${noun}, leurs menus, leurs prix et leurs modes de commande sur Resto237.`;
  }
  const noun = count > 1 ? `${count} restaurants` : count === 1 ? "1 restaurant" : "restaurants";
  return `${title}: explore ${noun}, their menus, prices and ordering options on Resto237.`;
}

export async function generateMetadata({ params }: Props) {
  const c = await content(params);
  return publicMetadata(c.path, c.title, metaDescription(c.restaurants.length, c.title, c.fr));
}

export default async function DiscoveryPage({ params }: Props) {
  const c = await content(params);
  const links = c.group.kind === "food" ? c.dishes.map(d => ({ name: d.name + " — " + d.restaurant.name, path: dishPath(d.restaurant.slug, d) }))
    : c.restaurants.map(r => ({ name: r.name, path: `/restaurants/${r.slug}` }));

  const intro = discoveryIntro(c.group.kind, c.group.slug, c.displayName, c.fr);
  const availability = discoveryAvailability({
    fr: c.fr,
    count: c.restaurants.length,
    delivery: c.restaurants.filter(r => r.acceptsDelivery).length,
    pickup: c.restaurants.filter(r => r.acceptsPickup).length,
    placeLabel: c.group.kind === "neighbourhood"
      ? (c.fr ? `des livraisons et retraits à ${c.displayName}` : `service in ${c.displayName}`)
      : (c.fr ? `${c.displayName} à Douala` : `${c.displayName} in Douala`),
  });

  return <main className="container-page space-y-6 py-10">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString({ "@context": "https://schema.org", "@type": "ItemList", itemListElement: links.map((l, i) => ({ "@type": "ListItem", position: i + 1, name: l.name, url: absolutePublicUrl(l.path, c.fr ? "fr" : "en") })) }) }} />
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(breadcrumbJsonLd([
      { name: c.fr ? "Accueil" : "Home", path: "/" },
      { name: c.fr ? "Explorer" : "Explore", path: "/explore" },
      { name: c.title, path: c.path },
    ], c.fr ? "fr" : "en")) }} />
    <Link href="/explore" className="text-sm text-primary">← {c.fr ? "Explorer les plats et quartiers" : "Explore food and neighbourhoods"}</Link>
    <h1 className="font-display text-3xl font-bold">{c.title}</h1>

    {/*
      The editorial paragraph, then the availability sentence.

      These two carry the whole difference between a page that answers
      "où commander du ndolé à Douala" / "quels restaurants livrent à
      Bonamoussadi" and a page that only lists cards. The second one exists
      because the word "livraison" did not previously appear anywhere on a
      neighbourhood page — the exact question it is built to rank for.
    */}
    <div className="max-w-2xl space-y-3 text-text-secondary">
      <p>{intro}</p>
      {availability && <p>{availability}</p>}
    </div>

    {c.group.kind === "food" && <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{c.dishes.map(d => <Link key={d.id} href={dishPath(d.restaurant.slug, d)} className="overflow-hidden rounded-xl border border-border bg-surface">
      {/*
        Alt names the restaurant, not just the dish: this grid is the SAME
        dish from several kitchens, so `alt={d.name}` repeated identically
        down the page and told image search nothing that distinguished them.
      */}
      {d.image_url && <Image src={d.image_url} alt={`${d.name} — ${d.restaurant.name}, ${formatQuartier(d.restaurant.quartier)}`} width={600} height={400} sizes="(max-width: 640px) 100vw, 33vw" className="aspect-[3/2] w-full object-cover" />}
      <div className="space-y-2 p-4"><h2 className="font-semibold">{d.name}</h2><p className="text-sm text-text-secondary">{d.restaurant.name} · {formatQuartier(d.restaurant.quartier)}</p><p className="text-sm">{d.description}</p><p className="font-semibold">{formatMoney(d.price)}</p></div>
    </Link>)}</div>}
    <h2 className="text-xl font-semibold">{c.fr ? "Restaurants" : "Restaurants"} ({c.restaurants.length})</h2>
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{c.restaurants.map(r => <RestaurantCard key={r.id} restaurant={r} />)}</div>
  </main>;
}
