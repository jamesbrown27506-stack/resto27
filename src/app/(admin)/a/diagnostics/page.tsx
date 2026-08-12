import Link from "next/link";
import { Activity, Database, Smartphone, Webhook } from "lucide-react";
import { AdminPage } from "@/components/layout/admin-shell";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, Panel } from "@/components/ui/card";
import { runHealthChecks } from "@/lib/data/platform";

export const dynamic = "force-dynamic";

/**
 * Diagnostics.
 *
 * The previous version listed SebPay probes with simulated results — the
 * provider from explanation.md, which this project is not using. Fabricated
 * results on a diagnostics page are worse than none: the whole purpose is to
 * tell you whether something really works.
 *
 * Live provider checks now live on /a/camerpay, which calls the real API. This
 * page is the map: what is verifiable today, what is not, and where to go.
 */
export default async function DiagnosticsPage() {
  const groups = await runHealthChecks();
  const schema = groups.find((g) => g.title === "Schema");
  const tablesPresent = schema?.checks.filter((c) => c.status === "pass").length ?? 0;
  const tablesTotal = schema?.checks.length ?? 0;

  return (
    <AdminPage
      title="Diagnostics"
      description="Actively exercise external services, rather than reading configuration."
    >
      <div className="flex max-w-3xl flex-col gap-6">
        <Card className="border-warning/25 bg-warning-light">
          <CardBody className="flex items-start gap-3">
            <Activity className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <p className="text-sm leading-relaxed text-warning">
              <strong className="font-semibold">These make real calls.</strong> Unlike Health
              checks, anything here contacts a third party and may move money. Use it to diagnose a
              real problem, not to browse.
            </p>
          </CardBody>
        </Card>

        <Panel
          title="Mobile money — CamerPay"
          description="Authentication, callback registration, live transactions and reconciliation."
        >
          <CardBody className="flex flex-col gap-4">
            <p className="text-sm leading-relaxed text-text-secondary">
              Every provider probe lives on its own console, because CamerPay has no sandbox: a
              deposit charges a real wallet, minimum 500 FCFA. Keeping those controls behind a
              deliberate click rather than beside passive checks is the point.
            </p>
            <p className="text-sm leading-relaxed text-text-secondary">
              Callbacks from CamerPay are <strong className="text-text">unsigned</strong>, so
              nothing is ever credited on the strength of one — every outcome is confirmed back to
              the provider before money moves.
            </p>
            <Link href="/a/camerpay" className={buttonClasses({ className: "self-start" })}>
              <Smartphone className="size-4" aria-hidden />
              <span>Open the CamerPay console</span>
            </Link>
          </CardBody>
        </Panel>

        <Panel title="Database" description="Reachability and schema completeness.">
          <CardBody className="flex flex-col gap-4">
            <p className="text-sm text-text-secondary">
              <strong className="text-text">
                {tablesPresent} of {tablesTotal}
              </strong>{" "}
              expected tables are present and reachable. Full breakdown on Health checks.
            </p>
            <Link
              href="/a/tests"
              className={buttonClasses({ variant: "outline", className: "self-start" })}
            >
              <Database className="size-4" aria-hidden />
              <span>Open health checks</span>
            </Link>
          </CardBody>
        </Panel>

        <Panel title="Not yet available" description="Honest about what cannot be tested today.">
          <CardBody>
            <ul className="flex flex-col gap-3 text-sm">
              <li className="flex items-start gap-2.5">
                <Webhook className="mt-0.5 size-4 shrink-0 text-text-light" aria-hidden />
                <span className="text-text-secondary">
                  <strong className="text-text">Self-directed webhook test.</strong> Requires an
                  HTTPS callback URL — localhost is rejected by CamerPay. Register a tunnel from
                  the CamerPay console first.
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <Webhook className="mt-0.5 size-4 shrink-0 text-text-light" aria-hidden />
                <span className="text-text-secondary">
                  <strong className="text-text">Send a real email.</strong> No mail provider is
                  configured yet.
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <Webhook className="mt-0.5 size-4 shrink-0 text-text-light" aria-hidden />
                <span className="text-text-secondary">
                  <strong className="text-text">Trigger the reconciler.</strong> The sweep exists
                  once payment attempts do; it is what recovers a payment whose callback was lost.
                </span>
              </li>
            </ul>
          </CardBody>
        </Panel>
      </div>
    </AdminPage>
  );
}
