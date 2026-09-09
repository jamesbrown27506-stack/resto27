import Link from "@/components/layout/public-link";
import { ArrowRight, MapPin, Soup, UtensilsCrossed } from "lucide-react";
import { fetchDiscoveryCatalog } from "@/lib/data/discovery";
import { jsonLdString, publicMetadata } from "@/lib/seo";
import { absolutePublicUrl } from "@/lib/seo-config";
import { breadcrumbJsonLd } from "@/lib/breadcrumbs";
import { discoverySlug } from "@/lib/seo-config";
import { getLocale } from "@/lib/i18n/locale-server";

export async function generateMetadata() {
  const fr = await getLocale() === "fr";
  return publicMetadata(
    "/explore",
    fr ? "Plats, cuisines et quartiers de Douala" : "Food, cuisines and neighbourhoods in Douala",
    fr
      ? "Trouvez un restaurant à Douala par quartier, cuisine ou plat. Consultez les menus et les prix sur Resto237."
      : "Find a Douala restaurant by neighbourhood, cuisine or dish. Browse menus and prices on Resto237.",
  );
}

export default async function ExplorePage() {
  const [{ groups, restaurants, dishes }, locale] = await Promise.all([
    fetchDiscoveryCatalog(),
    getLocale(),
  ]);
  const fr = locale === "fr";

  const neighbourhoods = groups
    .filter((group) => group.kind === "neighbourhood")
    .map((group) => ({
      ...group,
      count: restaurants.filter((restaurant) => discoverySlug(restaurant.quartier) === group.slug).length,
    }));
  const cuisines = groups
    .filter((group) => group.kind === "cuisine")
    .map((group) => ({
      ...group,
      count: restaurants.filter((restaurant) => discoverySlug(restaurant.cuisine) === group.slug).length,
    }));
  const foods = groups
    .filter((group) => group.kind === "food")
    .map((group) => {
      const matches = dishes.filter((dish) => discoverySlug(dish.name) === group.slug);
      return { ...group, count: matches.length, imageUrl: matches.find((dish) => dish.image_url)?.image_url ?? null };
    });

  /*
    The hub for the whole discovery taxonomy shipped with no structured data.
    One `ItemList` covering the three collections it links to gives Google the
    shape of the section rather than leaving it to infer it from anchors.
  */
  const hubJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: fr ? "Explorer Douala" : "Explore Douala",
    itemListElement: [...neighbourhoods, ...cuisines, ...foods].map((group, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: group.name,
      url: absolutePublicUrl(`/explore/${group.kind}/${group.slug}`, locale),
    })),
  };

  const crumbs = breadcrumbJsonLd(
    [
      { name: fr ? "Accueil" : "Home", path: "/" },
      { name: fr ? "Explorer" : "Explore", path: "/explore" },
    ],
    locale,
  );

  return (
    <main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(hubJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(crumbs) }} />
      <header className="border-b border-border bg-surface-2">
        <div className="container-page py-14 sm:py-20">
          <p className="text-xs font-bold tracking-[0.14em] text-primary uppercase">
            {fr ? "Explorer Douala" : "Explore Douala"}
          </p>
          <h1 className="mt-3 max-w-3xl font-display text-4xl font-bold sm:text-5xl">
            {fr ? "Trouvez votre prochain repas." : "Find your next meal."}
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-text-secondary">
            {fr
              ? "Partez d'un quartier, d'une cuisine ou du plat que vous avez déjà en tête."
              : "Start with a neighbourhood, a cuisine, or the dish you already have in mind."}
          </p>
        </div>
      </header>

      <div className="container-page space-y-16 py-12 sm:py-16">
        <section aria-labelledby="explore-food">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <span className="grid size-10 place-items-center rounded-md bg-primary-light text-primary">
                <Soup className="size-5" aria-hidden />
              </span>
              <h2 id="explore-food" className="mt-3 font-display text-2xl font-bold sm:text-3xl">
                {fr ? "Choisir un plat" : "Choose a dish"}
              </h2>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {foods.map((food) => (
              <Link
                key={food.slug}
                href={`/explore/food/${food.slug}`}
                className="group relative min-h-48 overflow-hidden rounded-lg border border-border bg-brand-solid text-brand-on-solid shadow-sm"
              >
                {food.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={food.imageUrl}
                    alt={`${food.name} — Douala`}
                    loading="lazy"
                    className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                )}
                <span className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-black/5" />
                <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-5 text-white">
                  <span>
                    <span className="block font-display text-xl font-bold">{food.name}</span>
                    <span className="mt-1 block text-xs text-white/70">
                      {food.count} {fr ? "option(s)" : "option(s)"}
                    </span>
                  </span>
                  <ArrowRight className="size-5 transition-transform group-hover:translate-x-1" aria-hidden />
                </span>
              </Link>
            ))}
          </div>
        </section>

        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
          <section aria-labelledby="explore-neighbourhood">
            <span className="grid size-10 place-items-center rounded-md bg-primary-light text-primary">
              <MapPin className="size-5" aria-hidden />
            </span>
            <h2 id="explore-neighbourhood" className="mt-3 font-display text-2xl font-bold">
              {fr ? "Manger dans votre quartier" : "Eat in your neighbourhood"}
            </h2>
            <div className="mt-5 divide-y divide-border rounded-lg border border-border bg-surface">
              {neighbourhoods.map((group) => (
                <Link
                  key={group.slug}
                  href={`/explore/neighbourhood/${group.slug}`}
                  className="flex min-h-14 items-center justify-between gap-4 px-4 transition-colors hover:bg-primary-light"
                >
                  <span className="font-semibold">{group.name}</span>
                  <span className="text-sm text-text-light">
                    {group.count} {fr ? "restaurant(s)" : "restaurant(s)"}
                  </span>
                </Link>
              ))}
            </div>
          </section>

          <section aria-labelledby="explore-cuisine">
            <span className="grid size-10 place-items-center rounded-md bg-primary-light text-primary">
              <UtensilsCrossed className="size-5" aria-hidden />
            </span>
            <h2 id="explore-cuisine" className="mt-3 font-display text-2xl font-bold">
              {fr ? "Explorer par cuisine" : "Explore by cuisine"}
            </h2>
            <div className="mt-5 flex flex-wrap gap-2.5">
              {cuisines.map((group) => (
                <Link
                  key={group.slug}
                  href={`/explore/cuisine/${group.slug}`}
                  className="rounded-full border border-border bg-surface px-4 py-2.5 text-sm font-semibold transition-colors hover:border-primary hover:text-primary"
                >
                  {group.name}
                  <span className="ml-2 text-text-light">{group.count}</span>
                </Link>
              ))}
            </div>
          </section>
        </div>

        <div className="flex justify-center border-t border-border pt-10">
          <Link
            href="/restaurants"
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-6 font-semibold text-primary-fg transition-colors hover:bg-primary-hover"
          >
            {fr ? "Voir tous les restaurants" : "View all restaurants"}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      </div>
    </main>
  );
}
