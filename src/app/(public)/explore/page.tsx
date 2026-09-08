import Link from "@/components/layout/public-link";
import { fetchDiscoveryCatalog } from "@/lib/data/discovery";
import { publicMetadata } from "@/lib/seo";
import { getLocale } from "@/lib/i18n/locale-server";

export async function generateMetadata() {
  const fr = await getLocale() === "fr";
  return publicMetadata("/explore", fr ? "Plats, cuisines et quartiers de Douala" : "Food, cuisines and neighbourhoods in Douala",
    fr ? "Trouvez un restaurant à Douala par quartier, cuisine ou plat. Consultez les menus et les prix sur Resto237." : "Find a Douala restaurant by neighbourhood, cuisine or dish. Browse menus and prices on Resto237.");
}

export default async function ExplorePage() {
  const { groups } = await fetchDiscoveryCatalog();
  const fr = await getLocale() === "fr";
  return <main className="container-page space-y-8 py-10">
    <header><h1 className="font-display text-3xl font-bold">{fr ? "Que voulez-vous manger à Douala ?" : "What would you like to eat in Douala?"}</h1>
      <p className="mt-3 text-text-secondary">{fr ? "Explorez les plats réellement proposés par nos restaurants et trouvez votre prochain repas par quartier ou cuisine." : "Explore dishes offered by our restaurants and find your next meal by neighbourhood or cuisine."}</p></header>
    {[["neighbourhood", fr ? "Par quartier" : "By neighbourhood"], ["cuisine", fr ? "Par cuisine" : "By cuisine"], ["food", fr ? "Par plat" : "By dish"]].map(([kind, title]) => <section key={kind}>
      <h2 className="mb-3 text-xl font-semibold">{title}</h2><div className="flex flex-wrap gap-2">
        {groups.filter(g => g.kind === kind).map(g => <Link key={g.slug} href={`/explore/${g.kind}/${g.slug}`} className="rounded-full border border-border bg-surface px-4 py-3 text-sm hover:bg-primary-light">{g.name}</Link>)}
      </div>
    </section>)}
    <Link href="/restaurants" className="font-semibold text-primary">{fr ? "Voir tous les restaurants →" : "View all restaurants →"}</Link>
  </main>;
}
