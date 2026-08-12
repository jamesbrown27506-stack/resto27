import { AlertTriangle, CheckCircle2, Info, ShieldCheck, XCircle } from "lucide-react";
import { AdminPage } from "@/components/layout/admin-shell";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { runHealthChecks } from "@/lib/data/platform";
import { requireRole } from "@/lib/auth/session";
import { MailTester } from "./mail-tester";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const ICONS = { pass: CheckCircle2, warn: AlertTriangle, fail: XCircle } as const;
const TONE = { pass: "text-success", warn: "text-warning", fail: "text-error" } as const;

/**
 * Passive health checks — now genuinely passive AND genuinely checking.
 *
 * The previous version listed hardcoded results that always said "pass",
 * which is worse than having no page: it actively asserts that things are fine
 * without looking. Every row below is now a real probe — each table gets a
 * `head: true` count that asks Postgres whether it exists, and the settings
 * and environment rows read actual values.
 *
 * Still safe to open in production during an incident: nothing external is
 * contacted and nothing is written. Actively exercising the payment gateway is
 * /a/diagnostics' job.
 */
export default async function TestsPage() {
  const [admin, groups] = await Promise.all([requireRole("admin"), runHealthChecks()]);
  const all = groups.flatMap((g) => g.checks);

  const passed = all.filter((c) => c.status === "pass").length;
  const warned = all.filter((c) => c.status === "warn").length;
  const failed = all.filter((c) => c.status === "fail").length;

  return (
    <AdminPage
      title="Health checks"
      description="Passive verification — no external calls, nothing written."
      action={
        <Badge tone={failed > 0 ? "error" : warned > 0 ? "warning" : "success"}>
          <ShieldCheck className="size-3" aria-hidden />
          {failed > 0 ? "Problems found" : warned > 0 ? "Warnings" : "All clear"}
        </Badge>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Passing" value={passed} tone="primary" />
        <StatTile label="Warnings" value={warned} positiveIsGood={false} />
        <StatTile label="Failing" value={failed} positiveIsGood={false} />
      </div>

      <p className="mt-6 flex max-w-3xl items-start gap-2.5 rounded-md border border-border bg-surface-2 p-4 text-sm text-text-secondary">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <span>
          These are live probes against your database and environment, not a static list. Every
          table is queried for existence and row count. Nothing here contacts the outside world —
          the one exception is the email panel below, which is behind a button for exactly that
          reason. To exercise the payment gateway for real, use{" "}
          <strong className="text-text">Diagnostics</strong>.
        </span>
      </p>

      <div className="mt-6">
        <MailTester adminEmail={admin.email} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        {groups.map((group) => (
          <Panel key={group.title} title={group.title} description={group.description}>
            <ul className="divide-y divide-border">
              {group.checks.map((check) => {
                const Icon = ICONS[check.status];
                return (
                  <li key={check.name} className="flex items-start gap-3 px-5 py-3">
                    <Icon
                      className={cn("mt-0.5 size-4 shrink-0", TONE[check.status])}
                      aria-hidden
                    />
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-medium">{check.name}</p>
                      <p className="mt-0.5 text-xs text-text-light">{check.detail}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>
        ))}
      </div>
    </AdminPage>
  );
}
