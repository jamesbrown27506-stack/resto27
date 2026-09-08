import Link from "@/components/layout/public-link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { fetchDiscoveryCatalog } from "@/lib/data/discovery";
import { publicMetadata, jsonLdString } from "@/lib/seo";
import { absolutePublicUrl, discoverySlug } from "@/lib/seo-config";
import { getLocale } from "@/lib/i18n/locale-server";
import { RestaurantCard } from "@/components/restaurant/restaurant-card";
import { formatMoney } from "@/lib/format/currency";

type Props = { params: Promise<{ kind: string; slug: string }> };
async function content(params: Props["params"]) {
  const { kind, slug } = await params;
  const catalog = await fetchDiscoveryCatalog();
  const group = catalog.groups.find(g => g.kind === kind && g.slug === slug);
  if (!group) notFound();
  const fr = await getLocale() === "fr";
  const title = kind === "neighbourhood" ? `${fr ? "Restaurants à" : "Restaurants in"} ${group.name}, Douala`
    : `${group.name} ${fr ? "à" : "in"} Douala`;
  const dishes = catalog.dishes.filter(d => discoverySlug(d.name) === slug);
  const restaurants = catalog.restaurants.filter(r => kind === "neighbourhood" ? discoverySlug(r.quartier) === slug
    : kind === "cuisine" ? discoverySlug(r.cuisine) === slug : dishes.some(d => d.restaurant.id === r.id));
  return { group, title, dishes, restaurants, fr, path: `/explore/${kind}/${slug}` };
}
export async function generateMetadata({ params }: Props) {
  const c = await content(params);
  return publicMetadata(c.path, c.title, c.fr ? `Découvrez ${c.restaurants.length} restaurant(s), leurs menus, prix et options de commande sur Resto237. ${c.title}.` : `Explore ${c.restaurants.length} restaurant(s), menus, prices and ordering options on Resto237. ${c.title}.`);
}
export default async function DiscoveryPage({ params }: Props) {
  const c = await content(params);
  const links = c.group.kind === "food" ? c.dishes.map(d => ({ name: d.name + " — " + d.restaurant.name, path: `/restaurants/${d.restaurant.slug}/menu/${d.id}` }))
    : c.restaurants.map(r => ({ name: r.name, path: `/restaurants/${r.slug}` }));
  return <main className="container-page space-y-6 py-10">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString({ "@context": "https://schema.org", "@type": "ItemList", itemListElement: links.map((l, i) => ({ "@type": "ListItem", position: i + 1, name: l.name, url: absolutePublicUrl(l.path, c.fr ? "fr" : "en") })) }) }} />
    <Link href="/explore" className="text-sm text-primary">← {c.fr ? "Explorer les plats et quartiers" : "Explore food and neighbourhoods"}</Link>
    <h1 className="font-display text-3xl font-bold">{c.title}</h1>
    <p className="max-w-2xl text-text-secondary">{c.fr ? "Comparez les menus et les prix des restaurants ci-dessous. Consultez chaque établissement pour ses horaires, son adresse et les modes de commande disponibles." : "Compare menus and prices below. Open each restaurant for its hours, address and available ordering options."}</p>
    {c.group.kind === "food" && <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{c.dishes.map(d => <Link key={d.id} href={`/restaurants/${d.restaurant.slug}/menu/${d.id}`} className="overflow-hidden rounded-xl border border-border bg-surface">
      {d.image_url && <Image src={d.image_url} alt={d.name} width={600} height={400} sizes="(max-width: 640px) 100vw, 33vw" className="aspect-[3/2] w-full object-cover" />}
      <div className="space-y-2 p-4"><h2 className="font-semibold">{d.name}</h2><p className="text-sm text-text-secondary">{d.restaurant.name} · {d.restaurant.quartier}</p><p className="text-sm">{d.description}</p><p className="font-semibold">{formatMoney(d.price)}</p></div>
    </Link>)}</div>}
    <h2 className="text-xl font-semibold">{c.fr ? "Restaurants" : "Restaurants"} ({c.restaurants.length})</h2>
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{c.restaurants.map(r => <RestaurantCard key={r.id} restaurant={r} />)}</div>
  </main>;
}
