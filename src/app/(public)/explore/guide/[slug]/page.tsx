import Link from "@/components/layout/public-link";
import { notFound } from "next/navigation";
import { MapPin } from "lucide-react";
import { fetchDiscoveryCatalog } from "@/lib/data/discovery";
import { fetchGuideCatalog } from "@/lib/data/guides";
import { faqJsonLd, jsonLdString, publicMetadata } from "@/lib/seo";
import { absolutePublicUrl } from "@/lib/seo-config";
import { getLocale } from "@/lib/i18n/locale-server";
import { breadcrumbJsonLd } from "@/lib/breadcrumbs";
import { RestaurantCard } from "@/components/restaurant/restaurant-card";
import { Faq } from "@/components/marketing/faq";
import { guideDescription, guideFact, guideFaq, guideIntro, guideMetaTitle, guideTitle, relatedGuides } from "@/lib/seo-guides";

type Props = { params: Promise<{ slug: string }> };

/**
 * One search intent in one place — "restaurants pas chers à Douala",
 * "livraison de repas à Bonamoussadi". See `lib/seo-guides.ts` for why these
 * exist and how every figure on them is computed.
 */
async function load(params: Props["params"]) {
  const { slug } = await params;
  const [{ guides, ctx }, { restaurants }, locale] = await Promise.all([fetchGuideCatalog(), fetchDiscoveryCatalog(), getLocale()]);
  const guide = guides.find((g) => g.slug === slug);
  // No restaurant matches at all (no reviews yet, no one open on Sundays…):
  // there is nothing to show, and nothing links here.
  if (!guide || guide.restaurants.length === 0) notFound();
  const fr = locale === "fr";
  const full = new Map(restaurants.map((r) => [r.id, r]));
  return {
    guide,
    guides,
    ctx,
    fr,
    locale,
    path: `/explore/guide/${slug}`,
    title: guideTitle(guide, fr),
    cards: guide.restaurants.flatMap((r) => (full.has(r.id) ? [full.get(r.id)!] : [])),
  };
}

export async function generateMetadata({ params }: Props) {
  const c = await load(params);
  return publicMetadata(c.path, guideMetaTitle(c.guide, c.ctx, c.fr), guideDescription(c.guide, c.ctx, c.fr), undefined, { index: c.guide.indexable });
}

export default async function GuidePage({ params }: Props) {
  const c = await load(params);
  const intro = guideIntro(c.guide, c.ctx, c.fr);
  const faq = guideFaq(c.guide, c.ctx, c.fr);
  const related = relatedGuides(c.guides, c.guide);
  const place = c.guide.place;

  return (
    <main className="container-page space-y-8 py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdString({
            "@context": "https://schema.org",
            "@type": "ItemList",
            name: c.title,
            itemListOrder: "https://schema.org/ItemListOrderAscending",
            itemListElement: c.cards.map((r, i) => ({
              "@type": "ListItem",
              position: i + 1,
              name: r.name,
              url: absolutePublicUrl(`/restaurants/${r.slug}`, c.locale),
            })),
          }),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdString(
            breadcrumbJsonLd(
              [
                { name: c.fr ? "Accueil" : "Home", path: "/" },
                { name: c.fr ? "Explorer" : "Explore", path: "/explore" },
                { name: c.title, path: c.path },
              ],
              c.locale,
            ),
          ),
        }}
      />
      {faq.length > 0 && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(faqJsonLd(faq)) }} />}

      <Link href="/explore" className="text-sm text-primary">
        ← {c.fr ? "Explorer les plats et quartiers" : "Explore food and neighbourhoods"}
      </Link>

      <header className="max-w-2xl space-y-3">
        <h1 className="font-display text-3xl font-bold sm:text-4xl">{c.title}</h1>
        {intro.map((paragraph) => (
          <p key={paragraph} className="leading-relaxed text-text-secondary">
            {paragraph}
          </p>
        ))}
        {place.kind === "quartier" && (
          <Link href={`/explore/neighbourhood/${place.slug}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
            <MapPin className="size-4" aria-hidden />
            {c.fr ? `Tous les restaurants à ${place.name}` : `All restaurants in ${place.name}`}
          </Link>
        )}
      </header>

      <section aria-labelledby="guide-list">
        <h2 id="guide-list" className="mb-4 text-xl font-semibold">
          {c.cards.length} {c.cards.length > 1 ? "restaurants" : "restaurant"}
        </h2>
        <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {c.cards.map((r) => {
            const fact = guideFact(c.guide, r, c.ctx, c.fr);
            return (
              <li key={r.id} className="flex flex-col gap-2">
                {fact && <p className="text-sm font-semibold text-primary">{fact}</p>}
                <RestaurantCard restaurant={r} />
              </li>
            );
          })}
        </ol>
      </section>

      {faq.length > 0 && (
        <section aria-labelledby="guide-faq" className="max-w-3xl">
          <h2 id="guide-faq" className="mb-4 font-display text-2xl font-bold">
            {c.fr ? "Questions fréquentes" : "Frequently asked questions"}
          </h2>
          <Faq items={faq} />
        </section>
      )}

      {related.length > 0 && (
        <nav aria-labelledby="guide-related" className="border-t border-border pt-6">
          <h2 id="guide-related" className="text-lg font-semibold">
            {c.fr ? "À voir aussi" : "See also"}
          </h2>
          <ul className="mt-3 flex flex-wrap gap-2.5">
            {related.map((g) => (
              <li key={g.slug}>
                <Link
                  href={`/explore/guide/${g.slug}`}
                  className="inline-flex rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold transition-colors hover:border-primary hover:text-primary"
                >
                  {guideTitle(g, c.fr)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </main>
  );
}
