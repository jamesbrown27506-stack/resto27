"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, Store, X } from "lucide-react";
import { FilterBar } from "@/components/data/filter-bar";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CellStack, DataTable, type Column } from "@/components/ui/data-table";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { RatingStars } from "@/components/ui/rating-stars";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format/datetime";
import { setRestaurantStatus } from "@/lib/data/admin-actions";
import type { AdminRestaurant } from "@/lib/data/admin";

const STATUS_LABEL: Record<AdminRestaurant["status"], string> = {
  active: "Active",
  pending: "Pending",
  suspended: "Suspended",
};

/** Derived by the subscription_state view, never stored (§5). */
const SUB_STATE: Record<string, { label: string; tone: BadgeTone }> = {
  active: { label: "Active", tone: "success" },
  grace: { label: "In grace", tone: "warning" },
  locked: { label: "Locked", tone: "error" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

const STATUS_TONE: Record<AdminRestaurant["status"], BadgeTone> = {
  active: "success",
  pending: "warning",
  suspended: "error",
};

type Action = "approve" | "reject" | "suspend" | "reinstate";

const CONFIRM: Record<Action, { title: string; message: string; destructive: boolean }> = {
  approve: {
    title: "Approve this restaurant?",
    message:
      "It becomes publicly visible and appears in the sitemap. The applicant is notified by email.",
    destructive: false,
  },
  reject: {
    title: "Reject this application?",
    message: "It returns to pending so the applicant can correct their submission.",
    destructive: true,
  },
  suspend: {
    title: "Suspend this restaurant?",
    message:
      "It disappears from public results immediately. Its data, orders and history are all kept.",
    destructive: true,
  },
  reinstate: {
    title: "Reinstate this restaurant?",
    message: "It becomes visible again and the manager regains access.",
    destructive: false,
  },
};

export function RestaurantsTable({
  restaurants,
  quartiers,
}: {
  restaurants: AdminRestaurant[];
  quartiers: string[];
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [quartier, setQuartier] = useState("all");
  const [confirming, setConfirming] = useState<{ id: string; action: Action } | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return restaurants.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (quartier !== "all" && r.quartier !== quartier) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        (r.cuisine?.toLowerCase().includes(q) ?? false) ||
        r.slug.includes(q)
      );
    });
  }, [restaurants, query, status, quartier]);

  function run() {
    if (!confirming) return;
    const { id, action } = confirming;
    setConfirming(null);

    startTransition(async () => {
      const result = await setRestaurantStatus(id, action);
      if (!result.ok) {
        toast(result.error, "error");
        return;
      }

      // A note means the action succeeded but something adjacent did not —
      // usually the approval email. Shown as a warning, not a success, because
      // the admin may need to follow up by hand.
      if (result.note) {
        toast(result.note, "warning");
        return;
      }

      toast(
        {
          approve: "Restaurant approved.",
          reject: "Application rejected.",
          suspend: "Restaurant suspended.",
          reinstate: "Restaurant reinstated.",
        }[action],
        action === "reject" || action === "suspend" ? "info" : "success",
      );
    });
  }

  const columns: Column<AdminRestaurant>[] = [
    {
      key: "name",
      header: "Restaurant",
      cell: (r) => (
        <CellStack
          primary={
            <>
              {r.name}
              {!r.isPrimary && (
                <span className="ml-1.5 font-normal text-text-light">{r.branchLabel}</span>
              )}
            </>
          }
          secondary={[r.quartier, r.cuisine].filter(Boolean).join(" · ") || "—"}
        />
      ),
    },
    {
      key: "owner",
      header: "Owner",
      hideBelow: "lg",
      cell: (r) =>
        r.ownerName ? (
          <CellStack primary={r.ownerName} secondary={r.ownerEmail ?? undefined} />
        ) : (
          // Seeded scaffolding from migration 0003 has no owner yet.
          <Badge tone="neutral">Unowned</Badge>
        ),
    },
    {
      key: "plan",
      header: "Plan",
      cell: (r) => {
        if (!r.subscription) return <span className="text-text-light">—</span>;

        const meta = SUB_STATE[r.subscription.state] ?? SUB_STATE.cancelled;
        return (
          <CellStack
            primary={r.subscription.planName}
            secondary={<Badge tone={meta.tone}>{meta.label}</Badge>}
          />
        );
      },
    },
    {
      key: "expiry",
      header: "Expires",
      hideBelow: "md",
      cell: (r) => {
        const sub = r.subscription;
        if (!sub) return <span className="text-text-light">—</span>;

        // §5 rule 1 — a null end date means NEVER EXPIRES. Rendering it as a
        // blank cell or as 1970 is precisely how the original bug read.
        if (sub.endDate === null) {
          return <span className="font-medium text-success">Never</span>;
        }

        const overdue = sub.state === "grace" || sub.state === "locked";
        return (
          <CellStack
            primary={<span className="tnum">{formatDate(sub.endDate)}</span>}
            secondary={
              overdue ? (
                <span className={sub.state === "locked" ? "text-error" : "text-warning"}>
                  {sub.state === "locked"
                    ? "Past grace period"
                    : `In grace (${sub.graceDays}d)`}
                </span>
              ) : sub.daysRemaining !== null ? (
                `${sub.daysRemaining} days left`
              ) : undefined
            }
          />
        );
      },
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>,
    },
    {
      key: "rating",
      header: "Rating",
      hideBelow: "lg",
      cell: (r) =>
        r.reviewCount > 0 ? (
          <RatingStars value={r.rating} size="sm" showValue count={r.reviewCount} />
        ) : (
          <span className="text-text-light">—</span>
        ),
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      cell: (r) => (
        <div className="flex justify-end gap-1.5">
          {r.status === "pending" && (
            <>
              <Button
                size="sm"
                disabled={pending}
                onClick={() => setConfirming({ id: r.id, action: "approve" })}
              >
                <Check className="size-3.5" aria-hidden />
                <span>Approve</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                className="text-error hover:bg-error-light"
                aria-label={`Reject ${r.name}`}
                onClick={() => setConfirming({ id: r.id, action: "reject" })}
              >
                <X className="size-3.5" aria-hidden />
              </Button>
            </>
          )}
          {r.status === "active" && (
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              className="text-error hover:bg-error-light"
              onClick={() => setConfirming({ id: r.id, action: "suspend" })}
            >
              Suspend
            </Button>
          )}
          {r.status === "suspended" && (
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => setConfirming({ id: r.id, action: "reinstate" })}
            >
              Reinstate
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <FilterBar
        query={query}
        onQueryChange={setQuery}
        placeholder="Name, cuisine or slug…"
        onClear={() => {
          setQuery("");
          setStatus("all");
          setQuartier("all");
        }}
        selects={[
          {
            key: "status",
            label: "Status",
            value: status,
            onChange: setStatus,
            options: [
              { value: "all", label: "All statuses" },
              { value: "active", label: "Active" },
              { value: "pending", label: "Pending" },
              { value: "suspended", label: "Suspended" },
            ],
          },
          {
            key: "quartier",
            label: "Neighbourhood",
            value: quartier,
            onChange: setQuartier,
            options: [
              { value: "all", label: "All neighbourhoods" },
              ...quartiers.map((q) => ({ value: q, label: q })),
            ],
          },
        ]}
      />

      <p className="mt-4 text-sm text-text-secondary">
        Showing {rows.length} of {restaurants.length}
      </p>

      <div className="mt-3 overflow-hidden rounded-lg border border-border bg-surface">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          empty={
            <EmptyState
              icon={<Store />}
              title="No restaurants"
              description={
                restaurants.length === 0
                  ? "The table is empty. Run migration 0003_restaurants.sql."
                  : "Adjust your filters."
              }
            />
          }
        />
      </div>

      <ConfirmDialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        onConfirm={run}
        title={confirming ? CONFIRM[confirming.action].title : ""}
        message={confirming ? CONFIRM[confirming.action].message : ""}
        confirmLabel={confirming?.action === "approve" ? "Approve" : "Confirm"}
        destructive={confirming ? CONFIRM[confirming.action].destructive : false}
      />
    </>
  );
}
