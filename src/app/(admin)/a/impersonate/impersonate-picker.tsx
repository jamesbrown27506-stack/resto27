"use client";

import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, Search, Store, VenetianMask } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { TypedConfirmDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/format/datetime";
import { beginImpersonation } from "@/lib/data/platform-actions";
import type { AdminRestaurant } from "@/lib/data/admin";
import type { AuditRow } from "@/lib/data/platform";

export function ImpersonatePicker({
  restaurants,
  history,
}: {
  restaurants: AdminRestaurant[];
  history: AuditRow[];
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<AdminRestaurant | null>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return restaurants.filter(
      (r) =>
        !q || r.name.toLowerCase().includes(q) || (r.quartier?.toLowerCase().includes(q) ?? false),
    );
  }, [restaurants, query]);

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
      <div>
        <div className="flex items-start gap-3 rounded-md border border-warning/30 bg-warning-light p-4 text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="text-sm">
            <p className="font-semibold">Read this before continuing</p>
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 opacity-90">
              <li>A permanent, undismissable banner will show that you are impersonating.</li>
              <li>
                Every action is recorded with <strong>your identity as the impersonator</strong>,
                separately from the tenant — the log must never show them doing something they
                did not do.
              </li>
              <li>Both the start and the end of the session are written to the audit log.</li>
              <li>Do only what the diagnosis requires.</li>
            </ul>
          </div>
        </div>

        <div className="mt-6">
          <label className="sr-only" htmlFor="imp-search">
            Search restaurants
          </label>
          <Input
            id="imp-search"
            type="search"
            icon={<Search />}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Restaurant name or neighbourhood…"
          />
        </div>

        <div className="mt-4 overflow-hidden rounded-lg border border-border bg-surface">
          {results.length === 0 ? (
            <EmptyState
              icon={<Store />}
              title="No matches"
              description={
                restaurants.length === 0
                  ? "No active restaurants to impersonate."
                  : "Try a different search."
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {results.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-4 p-4">
                  <span className="grid size-10 shrink-0 place-items-center rounded-md bg-primary-light text-primary">
                    <Store className="size-4.5" aria-hidden />
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {r.name}
                      {!r.isPrimary && (
                        <span className="ml-1.5 font-normal text-text-light">{r.branchLabel}</span>
                      )}
                    </p>
                    <p className="text-sm text-text-secondary">
                      {[r.quartier, r.cuisine].filter(Boolean).join(" · ") || "—"}
                      {r.ownerName ? ` · ${r.ownerName}` : " · unowned"}
                    </p>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() => setTarget(r)}
                  >
                    <VenetianMask className="size-3.5" aria-hidden />
                    <span>Impersonate</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <aside className="lg:sticky lg:top-24">
        <Card>
          <CardBody>
            <p className="font-display text-lg font-bold">History</p>
            <p className="mt-1 text-sm text-text-secondary">
              Impersonation sessions are visible to every administrator.
            </p>

            {history.length === 0 ? (
              <p className="mt-4 text-sm text-text-light">No sessions recorded yet.</p>
            ) : (
              <ul className="mt-4 flex flex-col gap-3">
                {history.map((entry) => (
                  <li key={entry.id} className="border-l-2 border-accent pl-3">
                    <p className="text-sm font-medium">{entry.summary || entry.action}</p>
                    <p className="tnum mt-0.5 text-xs text-text-light">
                      {entry.actorEmail} · {formatDateTime(entry.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            <Badge tone="accent" className="mt-4">
              Written to the audit log
            </Badge>
          </CardBody>
        </Card>
      </aside>

      <TypedConfirmDialog
        open={target !== null}
        onClose={() => setTarget(null)}
        onConfirm={() => {
          const restaurant = target;
          setTarget(null);
          if (!restaurant) return;
          startTransition(async () => {
            const result = await beginImpersonation(restaurant.id);
            if (result.ok) {
              toast(`Impersonation of ${restaurant.name} recorded in the audit log.`, "info");
            } else {
              toast(result.error, "error");
            }
          });
        }}
        title="Impersonate this tenant"
        message={`You will see the platform as ${target?.name ?? ""}. An undismissable banner will be shown throughout, and every action will be recorded under your name as the impersonator.`}
        phrase="IMPERSONATE"
        confirmLabel="Start session"
        hint="Both the start and the end are written to the audit log."
      />
    </div>
  );
}
