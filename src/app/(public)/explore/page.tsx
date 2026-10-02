import Link from "@/components/layout/public-link";
import { ArrowRight, Compass, MapPin, Search, Store } from "lucide-react";
import { RestaurantCard, RestaurantGrid } from "@/components/restaurant/restaurant-card";
import { COURSE_ICONS, cuisineIcon } from "@/components/restaurant/kind-icons";
import { fetchDiscoveryCatalog } from "@/lib/data/discovery";
import { fetchGuideCatalog } from "@/lib/data/guides";
import { guideTitle } from "@/lib/seo-guides";
import { jsonLdString, publicMetadata } from "@/lib/seo";
import { absolutePublicUrl, discoverySlug } from "@/lib/seo-config";
import { breadcrumbJsonLd } from "@/lib/breadcrumbs";
import { getLocale, getTranslator } from "@/lib/i18n/locale-server";
import { DISH_COURSES, isDishCourse, majorityCourse, type DishCourse } from "@/lib/menu/course";
import { fuzzySearch } from "@/lib/search/fuzzy";
import { cn } from "@/lib/utils";

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

type Food = { kind: string; slug: string; name: string; count: number; imageUrl: string | null; course: DishCourse };

/**
 * Explore — find food by what it is.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  SEARCH FIRST, THEN THE KINDS OF DISH.
 *
 *  The page used to open on one long grid of every dish, then the
 *  neighbourhoods and cuisines. Now (2026-10): a search box that forgives
 *  spelling (lib/search/fuzzy — "ndole", "koky", "poulet dj" all land), then
 *  chips for the four kinds of dish (lib/menu/course: breakfast & snacks,
 *  main dishes, desserts, drinks). "Tout" shows each kind as its own
 *  section; a chip shows only that one. Then restaurant types, guides and
 *  neighbourhoods.
 *
 *  ?q= and ?course= are views of this one page: the canonical stays /explore.
 * ─────────────────────────────────────────────────────────────────────────
 */
export default async function ExplorePage({ searchParams }: { searchParams: Promise<{ q?: string; course?: string }> }) {
  const [{ groups, restaurants, dishes }, locale, { guides }, t, params] = await Promise.all([
    fetchDiscoveryCatalog(),
    getLocale(),
    fetchGuideCatalog(),
    getTranslator(),
    searchParams,
  ]);
  const fr = locale === "fr";
  const query = (params.q ?? "").trim().slice(0, 80);
  const course: DishCourse | "all" = isDishCourse(params.course) ? params.course : "all";
  // Douala-wide intent pages that pass their quality gate.
  const cityGuides = guides.filter((guide) => guide.indexable && guide.place.kind === "city");

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
  const foods: Food[] = groups
    .filter((group) => group.kind === "food")
    .map((group) => {
      const matches = dishes.filter((dish) => discoverySlug(dish.name) === group.slug);
      return {
        ...group,
        count: matches.length,
        imageUrl: matches.find((dish) => dish.image_url)?.image_url ?? null,
        course: majorityCourse(matches.map((dish) => dish.dishCourse)),
      };
    });

  const courseCount = (c: DishCourse | "all") => (c === "all" ? foods.length : foods.filter((food) => food.course === c).length);
  const exploreHref = (next: { course?: DishCourse | "all"; q?: string }) => {
    const qs = new URLSearchParams();
    const c = next.course ?? course;
    const q = next.q ?? query;
    if (q) qs.set("q", q);
    if (c !== "all") qs.set("course", c);
    const str = qs.toString();
    return str ? `/explore?${str}` : "/explore";
  };

  // Search: dishes by name; restaurants by name, type, quartier and dishes.
  const dishNamesByRestaurant = new Map<string, string[]>();
  for (const dish of dishes) {
    const list = dishNamesByRestaurant.get(dish.restaurant_id) ?? [];
    list.push(dish.name);
    dishNamesByRestaurant.set(dish.restaurant_id, list);
  }
  const searchable = course === "all" ? foods : foods.filter((food) => food.course === course);
  const foodHits = query ? fuzzySearch(searchable, query, (food) => [food.name]) : null;
  const restaurantHits = query
    ? fuzzySearch(
        [...restaurants].sort((a, b) => (a.placement ?? 0) - (b.placement ?? 0)),
        query,
        (r) => [r.name, r.cuisine, r.quartier, ...(dishNamesByRestaurant.get(r.id) ?? [])],
        { limit: 6 },
      )
    : null;
  const foundFoods = foodHits ? (foodHits.exact.length > 0 ? foodHits.exact : foodHits.similar) : [];
  const foundRestaurants = restaurantHits
    ? (restaurantHits.exact.length > 0 ? restaurantHits.exact : restaurantHits.similar).slice(0, 6)
    : [];
  const approximate = Boolean(foodHits && restaurantHits && foodHits.exact.length === 0 && restaurantHits.exact.length === 0);

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
        <div className="container-page py-8 sm:py-14">
          <p className="text-xs font-bold tracking-[0.14em] text-primary uppercase">
            {fr ? "Explorer Douala" : "Explore Douala"}
          </p>
          <h1 className="mt-2 max-w-3xl font-display text-3xl font-bold sm:text-5xl">
            {fr ? "Trouvez votre prochain repas." : "Find your next meal."}
          </h1>
          <form action="/explore" method="get" role="search" className="relative mt-5 max-w-2xl">
            <label htmlFor="explore-search" className="sr-only">
              {fr ? "Rechercher un plat ou un restaurant" : "Search for a dish or a restaurant"}
            </label>
            <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-text-light" aria-hidden />
            <input
              id="explore-search"
              name="q"
              type="search"
              enterKeyHint="search"
              defaultValue={query}
              placeholder={fr ? "Ndolé, poulet DG, jus, glace…" : "Ndolé, chicken, juice, ice cream…"}
              className="h-13 w-full rounded-md border border-border-strong bg-surface pr-28 pl-12 text-base text-text placeholder:text-text-light focus:border-primary focus:outline-none"
            />
            {course !== "all" && <input type="hidden" name="course" value={course} />}
            <button
              type="submit"
              className="absolute top-1.5 right-1.5 h-10 rounded-md bg-primary px-4 text-sm font-semibold text-primary-fg hover:bg-primary-hover"
            >
              {fr ? "Chercher" : "Search"}
            </button>
          </form>
        </div>
      </header>

      {/* The kinds of dish, one tap each — scrolls sideways on a phone. */}
      <nav
        aria-label={fr ? "Types de plats" : "Kinds of dish"}
        className="sticky top-20 z-20 border-b border-border bg-bg/95 backdrop-blur lg:top-16"
      >
        <div className="container-page flex gap-2 overflow-x-auto py-3 [scrollbar-width:none]">
          {(["all", ...DISH_COURSES] as const).map((c) => {
            const Icon = c === "all" ? Store : COURSE_ICONS[c];
            const active = course === c;
            return (
              <Link
                key={c}
                href={exploreHref({ course: c })}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors",
                  active ? "border-primary bg-primary text-primary-fg" : "border-border bg-surface hover:border-primary/50",
                )}
              >
                <Icon className="size-4" aria-hidden />
                {t(`course.${c}`)}
                <span className={cn("tnum text-xs", active ? "text-primary-fg/80" : "text-text-light")}>{courseCount(c)}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="container-page space-y-14 py-8 sm:py-12">
        {query ? (
          <section aria-labelledby="explore-results" className="space-y-8">
            <div>
              <h2 id="explore-results" className="font-display text-2xl font-bold sm:text-3xl">
                {fr ? `Résultats pour « ${query} »` : `Results for “${query}”`}
              </h2>
              {approximate && (foundFoods.length > 0 || foundRestaurants.length > 0) && (
                <p className="mt-2 rounded-md bg-info-light px-3 py-2 text-sm text-info">
                  {fr ? "Rien d'exact — voici ce qui s'en rapproche le plus :" : "Nothing exact — here is the closest:"}
                </p>
              )}
            </div>
            {foundFoods.length > 0 && <FoodGrid foods={foundFoods} />}
            {foundRestaurants.length > 0 && (
              <div>
                <h3 className="mb-4 font-display text-xl font-bold">Restaurants</h3>
                <RestaurantGrid>
                  {foundRestaurants.map((r) => (
                    <RestaurantCard key={r.id} restaurant={r} />
                  ))}
                </RestaurantGrid>
              </div>
            )}
            {foundFoods.length === 0 && foundRestaurants.length === 0 && (
              <div className="rounded-lg border border-border bg-surface p-6 text-center">
                <p className="font-semibold">{fr ? "Aucun plat ni restaurant trouvé." : "No dish or restaurant found."}</p>
                <p className="mt-1 text-sm text-text-secondary">
                  {fr ? "Essayez un autre mot, ou parcourez les types de plats ci-dessus." : "Try another word, or browse the kinds of dish above."}
                </p>
              </div>
            )}
            <Link href={exploreHref({ q: "" })} className="inline-flex min-h-11 items-center gap-2 font-semibold text-primary">
              {fr ? "Effacer la recherche" : "Clear the search"}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </section>
        ) : (
          (course === "all" ? (["main", "light", "dessert", "drink"] as const) : [course]).map((c) => {
            const list = foods.filter((food) => food.course === c);
            if (list.length === 0) return null;
            const Icon = COURSE_ICONS[c];
            return (
              <section key={c} aria-labelledby={`explore-${c}`}>
                <div className="mb-5 flex items-center justify-between gap-4">
                  <h2 id={`explore-${c}`} className="flex items-center gap-3 font-display text-2xl font-bold sm:text-3xl">
                    <span className="grid size-10 shrink-0 place-items-center rounded-md bg-primary-light text-primary">
                      <Icon className="size-5" aria-hidden />
                    </span>
                    {t(`course.${c}`)}
                  </h2>
                  {course === "all" && list.length > 6 && (
                    <Link href={exploreHref({ course: c })} className="flex min-h-11 shrink-0 items-center text-sm font-semibold text-primary">
                      {fr ? "Tout voir" : "See all"}
                    </Link>
                  )}
                </div>
                <FoodGrid foods={course === "all" ? list.slice(0, 6) : list} />
              </section>
            );
          })
        )}

        {cuisines.length > 0 && (
          <section aria-labelledby="explore-cuisine">
            <h2 id="explore-cuisine" className="font-display text-2xl font-bold sm:text-3xl">
              {fr ? "Par type de restaurant" : "By kind of restaurant"}
            </h2>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {cuisines.map((group) => {
                const Icon = cuisineIcon(group.name);
                return (
                  <Link
                    key={group.slug}
                    href={`/explore/cuisine/${group.slug}`}
                    className="flex min-h-16 items-center gap-3 rounded-lg border border-border bg-surface px-3 py-3 transition-colors hover:border-primary sm:px-4"
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-md bg-primary-light text-primary">
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{group.name}</span>
                      <span className="text-sm text-text-light">
                        {group.count} {group.count > 1 ? "restaurants" : "restaurant"}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {cityGuides.length > 0 && (
          <section aria-labelledby="explore-guides">
            <span className="grid size-10 place-items-center rounded-md bg-primary-light text-primary">
              <Compass className="size-5" aria-hidden />
            </span>
            <h2 id="explore-guides" className="mt-3 font-display text-2xl font-bold sm:text-3xl">
              {fr ? "Selon ce que vous cherchez" : "By what you are after"}
            </h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {cityGuides.map((guide) => (
                <Link
                  key={guide.slug}
                  href={`/explore/guide/${guide.slug}`}
                  className="group flex min-h-16 items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3 transition-colors hover:border-primary"
                >
                  <span>
                    <span className="block font-semibold">{guideTitle(guide, fr)}</span>
                    <span className="text-sm text-text-light">
                      {guide.restaurants.length} {guide.restaurants.length > 1 ? "restaurants" : "restaurant"}
                    </span>
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-primary transition-transform group-hover:translate-x-1" aria-hidden />
                </Link>
              ))}
            </div>
          </section>
        )}

        <section aria-labelledby="explore-neighbourhood">
          <span className="grid size-10 place-items-center rounded-md bg-primary-light text-primary">
            <MapPin className="size-5" aria-hidden />
          </span>
          <h2 id="explore-neighbourhood" className="mt-3 font-display text-2xl font-bold">
            {fr ? "Manger dans votre quartier" : "Eat in your neighbourhood"}
          </h2>
          <div className="mt-5 grid divide-y divide-border rounded-lg border border-border bg-surface sm:grid-cols-2 sm:divide-y-0">
            {neighbourhoods.map((group) => (
              <Link
                key={group.slug}
                href={`/explore/neighbourhood/${group.slug}`}
                className="flex min-h-14 items-center justify-between gap-4 px-4 transition-colors hover:bg-primary-light sm:border-b sm:border-border"
              >
                <span className="font-semibold">{group.name}</span>
                <span className="text-sm text-text-light">
                  {group.count} {group.count > 1 ? "restaurants" : "restaurant"}
                </span>
              </Link>
            ))}
          </div>
        </section>

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

/** The dish tiles: photo, name, how many places serve it. Each opens the dish's page across restaurants. */
function FoodGrid({ foods }: { foods: Food[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
      {foods.map((food) => (
        <Link
          key={food.slug}
          href={`/explore/food/${food.slug}`}
          className="group relative aspect-[4/3] overflow-hidden rounded-lg border border-border bg-brand-solid text-brand-on-solid shadow-sm sm:aspect-auto sm:min-h-48"
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
          <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3 text-white sm:p-5">
            <span className="min-w-0">
              <span className="block font-display text-base leading-tight font-bold sm:text-xl">{food.name}</span>
              <span className="mt-1 block text-xs text-white/75">
                {food.count} {food.count > 1 ? "restaurants" : "restaurant"}
              </span>
            </span>
            <ArrowRight className="hidden size-5 shrink-0 transition-transform group-hover:translate-x-1 sm:block" aria-hidden />
          </span>
        </Link>
      ))}
    </div>
  );
}
