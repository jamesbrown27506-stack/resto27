import { redirect } from "next/navigation";
import { PrintButton } from "./print-button";
import { requireCapability } from "@/lib/auth/branch";
import { fetchTables } from "@/lib/data/manager";
import { getLocale } from "@/lib/i18n/locale-server";
import { absoluteUrl } from "@/lib/site-url";

export default async function PrintTableCards() {
  const { active } = await requireCapability("tables.manage");
  if (active.planTier !== "enterprise" || active.subscriptionState === "locked") redirect("/m/billing");

  const [allTables, base, locale] = await Promise.all([
    fetchTables(active.restaurantId),
    absoluteUrl(""),
    getLocale(),
  ]);
  const tables = allTables.filter((table): table is typeof table & { publicToken: string } =>
    !table.planLocked && table.status !== "out_of_service" && Boolean(table.publicToken),
  );
  const fr = locale === "fr";

  return (
    <main className="mx-auto max-w-5xl p-4 print:max-w-none print:p-0">
      <div className="mb-6 flex flex-col items-start justify-between gap-3 print:hidden sm:flex-row sm:items-center">
        <div>
          <h1 className="font-display text-2xl font-bold">{fr ? "QR codes des tables" : "Printable table QR cards"}</h1>
          <p className="text-sm text-text-secondary">{fr ? "Imprimez à l’échelle 100 % et placez chaque carte sur la table correspondante." : "Print at 100% scale and place the matching card on each table."}</p>
        </div>
        <PrintButton label={fr ? "Imprimer / Enregistrer en PDF" : "Print / Save PDF"} />
      </div>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 print:grid-cols-2">
        {tables.map((table) => (
          <section key={table.id} className="break-inside-avoid rounded-lg border-2 border-text bg-white p-6 text-center text-black">
            <p className="text-sm font-semibold">{active.restaurantName}</p>
            <h2 className="mt-1 text-3xl font-bold">Table {table.number}</h2>
            {/* eslint-disable-next-line @next/next/no-img-element -- printable self-hosted SVG needs exact physical dimensions */}
            <img src={`/api/table-qr/${table.publicToken}`} alt={`QR Table ${table.number}`} className="mx-auto mt-4 size-56" />
            <p className="mt-3 font-semibold">Scan to view the menu and order</p>
            <p className="mt-1 text-sm">Scannez pour consulter le menu et commander</p>
            <p className="mt-3 break-all text-[10px] text-gray-600">{base}/table/{table.publicToken}</p>
          </section>
        ))}
      </div>
    </main>
  );
}
