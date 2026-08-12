import { Lock, ScrollText, VenetianMask } from "lucide-react";
import { AdminPage } from "@/components/layout/admin-shell";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime, isoAttr } from "@/lib/format/datetime";
import { listAuditLog } from "@/lib/data/platform";

export const dynamic = "force-dynamic";

/**
 * The audit log.
 *
 * READ-ONLY BY DESIGN (§14.5). No edit control, no delete control, no bulk
 * action — not hidden, absent. Migration 0005 backs that with a database-level
 * `REVOKE UPDATE, DELETE`, so it holds even against a SQL console.
 *
 * Each row snapshots the actor's email and role as they were at the time (§9),
 * because actors get anonymised and the trail has to survive them.
 */
export default async function AuditPage() {
  const entries = await listAuditLog();

  return (
    <AdminPage
      title="Audit log"
      description="Permanent record of every privileged action."
      action={
        <Badge tone="neutral">
          <Lock className="size-3" aria-hidden />
          Read-only
        </Badge>
      }
    >
      <p className="mb-6 flex max-w-3xl items-start gap-2.5 rounded-md border border-border bg-surface-2 p-4 text-sm text-text-secondary">
        <ScrollText className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <span>
          This log cannot be edited or deleted — not through this page, and not through a database
          client: <code className="font-mono text-xs">UPDATE</code> and{" "}
          <code className="font-mono text-xs">DELETE</code> are revoked on the table. When an
          administrator acts on behalf of a tenant, both identities are recorded separately.
        </span>
      </p>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        {entries.length === 0 ? (
          <EmptyState
            icon={<ScrollText />}
            title="No entries yet"
            description="Privileged actions — approvals, suspensions, refunds, settings changes — are recorded here as they happen."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Audit log entries, newest first</caption>
              <thead>
                <tr className="border-b border-border bg-surface-2">
                  {["When", "Action", "Actor", "Detail", "Origin"].map((h) => (
                    <th
                      key={h}
                      scope="col"
                      className="px-4 py-3 text-left text-[11px] font-bold tracking-[0.08em] text-text-light uppercase"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="px-4 py-3 align-top whitespace-nowrap">
                      <time dateTime={isoAttr(entry.createdAt)} className="tnum text-text-secondary">
                        {formatDateTime(entry.createdAt)}
                      </time>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <code className="font-mono text-xs font-medium">{entry.action}</code>
                      <span className="mt-0.5 block text-xs text-text-light">
                        {entry.entityType}
                        {entry.entityId ? ` · ${entry.entityId.slice(0, 8)}` : ""}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className="block font-medium">{entry.actorEmail}</span>
                      <span className="block text-xs text-text-light">{entry.actorRole}</span>
                      {entry.impersonatorEmail && (
                        <Badge tone="accent" className="mt-1">
                          <VenetianMask className="size-3" aria-hidden />
                          via {entry.impersonatorEmail}
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top text-text-secondary">
                      {entry.summary || "—"}
                    </td>
                    <td className="tnum px-4 py-3 align-top text-xs text-text-light">
                      {entry.ipAddress ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminPage>
  );
}
