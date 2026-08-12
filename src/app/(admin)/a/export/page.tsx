import { Download, FileSpreadsheet, ShieldAlert } from "lucide-react";
import { AdminPage } from "@/components/layout/admin-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { runHealthChecks } from "@/lib/data/platform";

export const dynamic = "force-dynamic";

/** Each report, its slug on the download route, and the table it needs. */
const REPORTS = [
  { slug: "restaurants", name: "Restaurants", description: "Every tenant with status, plan and location.", table: "restaurants" },
  { slug: "users", name: "Users", description: "Accounts with role, status and signup date.", table: "profiles" },
  { slug: "orders", name: "Orders", description: "Order-level totals, status and type.", table: "orders" },
  { slug: "order-items", name: "Order items", description: "Line items with their price and options snapshot.", table: "order_items" },
  { slug: "invoices", name: "Invoices", description: "Subscription invoices with period and payment status.", table: "invoices" },
  { slug: "payments", name: "Payments", description: "Confirmed payments with provider and method.", table: "payments" },
  { slug: "commissions", name: "Commissions", description: "Statements with the rate frozen at generation.", table: "commission_statements" },
  { slug: "refunds", name: "Refunds", description: "Refunds and chargebacks with their reasons.", table: "refunds" },
];

/**
 * CSV export.
 *
 * A report is offered only when its table exists AND has rows — an export
 * button that hands back an empty file reads as a bug in the exporter rather
 * than as "there is nothing to export yet".
 */
export default async function ExportPage() {
  const groups = await runHealthChecks();
  const schema = groups.find((g) => g.title === "Schema");

  const rowCountOf = (table: string): number | null => {
    const check = schema?.checks.find((c) => c.name === table);
    if (!check || check.status !== "pass") return null;
    const match = check.detail.match(/(\d+)\s+row/);
    return match ? Number(match[1]) : 0;
  };

  return (
    <AdminPage title="CSV export" description="Platform data as spreadsheets.">
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {REPORTS.map((report) => {
          const rows = rowCountOf(report.table);
          const missing = rows === null;
          const empty = rows === 0;

          return (
            <li key={report.name}>
              <Card className="flex h-full flex-col">
                <CardBody className="flex flex-1 flex-col">
                  <span className="grid size-10 place-items-center rounded-md bg-primary-light text-primary">
                    <FileSpreadsheet className="size-4.5" aria-hidden />
                  </span>
                  <p className="mt-3 font-display font-bold">{report.name}</p>
                  <p className="mt-1 flex-1 text-sm text-text-secondary">{report.description}</p>

                  <div className="mt-3">
                    {missing ? (
                      <Badge tone="error">Table missing</Badge>
                    ) : empty ? (
                      <Badge tone="neutral">No rows yet</Badge>
                    ) : (
                      <Badge tone="success">{rows} row(s)</Badge>
                    )}
                  </div>

                  {missing || empty ? (
                    <span
                      title={
                        missing ? "Run the migration that creates this table" : "Nothing to export yet"
                      }
                      className="mt-4 inline-flex cursor-not-allowed items-center gap-2 self-start rounded-full border border-border px-4 py-2 text-sm font-semibold opacity-50"
                    >
                      <Download className="size-3.5" aria-hidden />
                      <span>Download</span>
                    </span>
                  ) : (
                    // A plain anchor, not a fetch: the browser handles
                    // content-disposition and saves the file itself.
                    <a
                      href={`/a/export/${report.slug}`}
                      download
                      className="mt-4 inline-flex items-center gap-2 self-start rounded-full border border-border px-4 py-2 text-sm font-semibold transition-colors hover:border-primary hover:text-primary"
                    >
                      <Download className="size-3.5" aria-hidden />
                      <span>Download</span>
                    </a>
                  )}
                </CardBody>
              </Card>
            </li>
          );
        })}
      </ul>

      {/*
        §9 — two rules the writer enforces, restated because both are invisible
        until they bite.
      */}
      <p className="mt-6 flex max-w-3xl items-start gap-2.5 rounded-md border border-border bg-surface-2 p-4 text-sm text-text-secondary">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <span>
          Cells beginning with <code className="font-mono text-xs">=</code>,{" "}
          <code className="font-mono text-xs">+</code>, <code className="font-mono text-xs">-</code>{" "}
          or <code className="font-mono text-xs">@</code> are neutralised before writing — Excel
          executes them as formulas otherwise, and a restaurant name is attacker-controlled text.
          Files carry a UTF-8 BOM so accented names render correctly.
        </span>
      </p>
    </AdminPage>
  );
}
