import Link from "@/components/layout/public-link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { fetchDiscoveryCatalog } from "@/lib/data/discovery";
import { faqJsonLd, publicMetadata, jsonLdString } from "@/lib/seo";
import { Faq } from "@/components/marketing/faq";
import { absolutePublicUrl, discoverySlug, dishPath } from "@/lib/seo-config";
import { getLocale } from "@/lib/i18n/locale-server";
import { ChevronDown, CircleHelp, MapPin, Soup } from "lucide-react";
import { RestaurantCard } from "@/components/restaurant/restaurant-card";
import { RestaurantLogo } from "@/components/restaurant/restaurant-logo";
import { OpenBadge } from "@/components/restaurant/open-badge";
import { formatMoney } from "@/lib/format/currency";
import { cuisineTitle, discoveryAvailability, discoveryFaq, discoveryIntro, isDiscoveryIndexable } from "@/lib/discovery-content";
import { formatQuartier } from "@/lib/geo-cm";
import { breadcrumbJsonLd } from "@/lib/breadcrumbs";
import { fetchGuideCatalog } from "@/lib/data/guides";
import { guideTitle } from "@/lib/seo-guides";

type Props = { params: Promise<{ kind: string; slug: string }> };
async function content(params: Props["params"]) {
  const { kind, slug } = await params;
  const catalog = await fetchDiscoveryCatalog();
  const group = catalog.groups.find(g => g.kind === kind && g.slug === slug);
  if (!group) notFound();
  const fr = await getLocale() === "fr";
  const displayName = kind === "neighbourhood" ? formatQuartier(group.name) : group.name;
  const title = kind === "neighbourhood" ? `${fr ? "Restaurants à" : "Restaurants in"} ${displayName}, Douala`
    : kind === "cuisine" ? cuisineTitle(slug, displayName, fr)
    : `${displayName} ${fr ? "à" : "in"} Douala`;
  // The <title> adds what the searcher came for; the H1 stays the name of the
  // place or dish. "ndolé douala" results are TikToks and a 2015 blog post —
  // none says where to order it or what it costs, which is what this page does.
  const sep = fr ? " : " : ": ";
  const metaTitle = kind === "food" ? title + sep + (fr ? "restaurants et prix" : "restaurants and prices")
    : kind === "neighbourhood" ? title + sep + (fr ? "menus et prix" : "menus and prices")
    : title;
  const dishes = catalog.dishes.filter(d => discoverySlug(d.name) === slug);
  const restaurants = catalog.restaurants.filter(r => kind === "neighbourhood" ? discoverySlug(r.quartier) === slug
    : kind === "cuisine" ? discoverySlug(r.cuisine) === slug : dishes.some(d => d.restaurant.id === r.id));
  return { group, title, metaTitle, displayName, dishes, restaurants, fr, path: `/explore/${kind}/${slug}` };
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
  return publicMetadata(c.path, c.metaTitle, metaDescription(c.restaurants.length, c.title, c.fr), undefined, {
    index: isDiscoveryIndexable(c.group.kind, c.group.slug, c.restaurants.length),
  });
}

export default async function DiscoveryPage({ params }: Props) {
  const c = await content(params);
  const { guides } = await fetchGuideCatalog();
  // The intent pages for this quartier ("pas chers", "livraison"…), or the
  // city-wide ones on a dish or cuisine page. Indexable only: a link to a
  // noindex page spends a crawl on a page Google is told to drop.
  const quartierGuides = c.group.kind === "neighbourhood" ? guides.filter(g => g.indexable && g.place.slug === c.group.slug) : [];
  const guideLinks = (quartierGuides.length ? quartierGuides : guides.filter(g => g.indexable && g.place.kind === "city")).slice(0, 6);
  // "ou manger le ndole a douala", "où manger à bonamoussadi" — answered from
  // the listings below (see `discoveryFaq`).
  const faq = discoveryFaq({
    kind: c.group.kind,
    name: c.displayName,
    fr: c.fr,
    restaurants: c.restaurants.map(r => ({ name: r.name, quartier: formatQuartier(r.quartier), acceptsDelivery: r.acceptsDelivery, minPrice: r.priceRange?.min ?? null })),
    dishOffers: c.dishes.map(d => ({ restaurant: d.restaurant.name, quartier: formatQuartier(d.restaurant.quartier), price: Number(d.price) })),
    money: amount => formatMoney(amount),
  });
  const links = c.group.kind === "food" ? c.dishes.map(d => ({ name: d.name + " — " + d.restaurant.name, path: dishPath(d.restaurant.slug, d) }))
    : c.restaurants.map(r => ({ name: r.name, path: `/restaurants/${r.slug}` }));

  const intro = discoveryIntro(c.group.kind, c.group.slug, c.displayName, c.fr);
  // A restaurant's own description of the dish, the fullest one, for "what is
  // this dish?" — the cards no longer carry it.
  const dishStory = c.dishes
    .map((d) => d.description?.trim())
    .filter((text): text is string => Boolean(text))
    .sort((a, b) => b.length - a.length)[0];
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
    {faq.length > 0 && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(faqJsonLd(faq)) }} />}
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
    {c.group.kind === "food" ? (
      /*
        On a dish page the restaurants come first: in Douala nobody needs
        Ekwang explained before they can order it. The explanation is one tap
        away, and still in the page for search engines.
      */
      <details className="group max-w-2xl">
        <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold text-primary transition-colors hover:border-primary [&::-webkit-details-marker]:hidden">
          <CircleHelp className="size-4" aria-hidden />
          <span>{c.fr ? "C'est quoi ce plat ?" : "What is this dish?"}</span>
          <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="mt-3 space-y-3 rounded-xl border border-border bg-surface-2 p-4 text-text-secondary">
          {dishStory && <p className="text-text">{dishStory}</p>}
          <p>{intro}</p>
          {availability && <p>{availability}</p>}
        </div>
      </details>
    ) : (
      <div className="max-w-2xl space-y-3 text-text-secondary">
        <p>{intro}</p>
        {availability && <p>{availability}</p>}
      </div>
    )}

    {/*
      The SAME dish from several kitchens, so each card leads with who makes
      it and where: the restaurant's logo, name and neighbourhood sit on the
      photo like a label, with open/closed and the price in its corners.
      Cheapest first, because comparing is what this page is for.
    */}
    {c.group.kind === "food" && <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{[...c.dishes].sort((a, b) => Number(a.price) - Number(b.price)).map(d => <Link key={d.id} href={dishPath(d.restaurant.slug, d)} className="group overflow-hidden rounded-xl border border-border bg-surface transition-shadow hover:shadow-md">
      <div className="relative aspect-[3/2] overflow-hidden bg-surface-2">
        {/*
          Alt names the restaurant, not just the dish: `alt={d.name}` repeated
          identically down the page and told image search nothing that
          distinguished one kitchen's plate from the next.
        */}
        {d.image_url
          ? <Image src={d.image_url} alt={`${d.name} — ${d.restaurant.name}, ${formatQuartier(d.restaurant.quartier)}`} width={600} height={400} sizes="(max-width: 640px) 100vw, 33vw" className="size-full object-cover transition-transform duration-500 group-hover:scale-105" />
          : <span className="grid size-full place-items-center text-text-light"><Soup className="size-10" aria-hidden /></span>}
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/80 to-transparent" />
        <span className="absolute top-3 left-3"><OpenBadge hours={d.restaurant.hours} acceptingOrders={d.restaurant.isAcceptingOrders} /></span>
        <span className="tnum absolute top-3 right-3 rounded-full bg-white/95 px-3 py-1 text-sm font-bold text-neutral-900 shadow-md">{formatMoney(d.price)}</span>
        <span className="absolute inset-x-3 bottom-3 flex items-center gap-2.5 text-white">
          <RestaurantLogo name={d.restaurant.name} logoUrl={d.restaurant.logoUrl} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold drop-shadow">{d.restaurant.name}</span>
            <span className="flex items-center gap-1 text-xs text-white/85">
              <MapPin className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{formatQuartier(d.restaurant.quartier)}</span>
            </span>
          </span>
        </span>
      </div>
      <div className="p-4">
        <h2 className="font-display text-lg font-bold">{d.name}</h2>
      </div>
    </Link>)}</div>}
    <h2 className="text-xl font-semibold">{c.fr ? "Restaurants" : "Restaurants"} ({c.restaurants.length})</h2>
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{c.restaurants.map(r => <RestaurantCard key={r.id} restaurant={r} />)}</div>
    {faq.length > 0 && <section aria-labelledby="discovery-faq" className="max-w-3xl">
      <h2 id="discovery-faq" className="mb-4 font-display text-2xl font-bold">{c.fr ? "Questions fréquentes" : "Frequently asked questions"}</h2>
      <Faq items={faq} />
    </section>}
    {guideLinks.length > 0 && <nav aria-labelledby="discovery-guides" className="border-t border-border pt-6">
      <h2 id="discovery-guides" className="text-lg font-semibold">{c.fr ? "Guides pratiques" : "Handy guides"}</h2>
      <ul className="mt-3 flex flex-wrap gap-2.5">{guideLinks.map(g => <li key={g.slug}>
        <Link href={`/explore/guide/${g.slug}`} className="inline-flex rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold transition-colors hover:border-primary hover:text-primary">{guideTitle(g, c.fr)}</Link>
      </li>)}</ul>
    </nav>}
  </main>;
}
