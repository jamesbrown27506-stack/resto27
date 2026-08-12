"use client";

import { useMemo, useState, useTransition } from "react";
import { Users } from "lucide-react";
import { FilterBar } from "@/components/data/filter-bar";
import { Avatar } from "@/components/ui/avatar";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CellStack, DataTable, type Column } from "@/components/ui/data-table";
import { ConfirmDialog, TypedConfirmDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format/datetime";
import { anonymiseUser, reinstateUser, suspendUser } from "@/lib/data/admin-actions";
import type { AdminUser } from "@/lib/data/admin";
import type { UserStatus } from "@/lib/session";

const ROLE_LABEL: Record<string, string> = {
  customer: "Customer",
  manager: "Restaurant owner",
  admin: "Administrator",
};

const STATUS_LABEL: Record<UserStatus, string> = {
  active: "Active",
  pending: "Pending",
  suspended: "Suspended",
};

const STATUS_TONE: Record<UserStatus, BadgeTone> = {
  active: "success",
  pending: "warning",
  suspended: "error",
};

export function UsersTable({ users, currentUserId }: { users: AdminUser[]; currentUserId: string }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  const [role, setRole] = useState("all");
  const [status, setStatus] = useState("all");
  const [suspendId, setSuspendId] = useState<string | null>(null);
  const [anonymiseId, setAnonymiseId] = useState<string | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      if (role !== "all" && u.role !== role) return false;

      // "Anonymised" is not a status column — it is `deleted_at` being set, on
      // top of a suspended row. Filtering by it needs its own branch, and
      // "Suspended" deliberately excludes them: an admin looking for accounts
      // to reinstate should not have to read past the ones that cannot be.
      if (status === "anonymised") {
        if (!u.deletedAt) return false;
      } else if (status !== "all") {
        if (u.status !== status || u.deletedAt) return false;
      }

      if (!q) return true;
      return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
    });
  }, [users, query, role, status]);

  function act(fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const result = await fn();
      if (result.ok) toast(success, "success");
      else toast(result.error ?? "Something went wrong.", "error");
    });
  }

  const columns: Column<AdminUser>[] = [
    {
      key: "user",
      header: "User",
      cell: (u) => (
        <div className="flex items-center gap-3">
          <Avatar name={u.name} src={u.avatarUrl} size="sm" />
          <CellStack
            primary={
              <>
                {u.name}
                {u.id === currentUserId && (
                  <Badge tone="primary" className="ml-2">
                    You
                  </Badge>
                )}
              </>
            }
            secondary={u.email}
          />
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      cell: (u) => (
        <Badge tone={u.role === "admin" ? "accent" : u.role === "manager" ? "primary" : "neutral"}>
          {ROLE_LABEL[u.role] ?? u.role}
        </Badge>
      ),
    },
    {
      key: "restaurants",
      header: "Restaurants",
      hideBelow: "lg",
      cell: (u) =>
        u.restaurantNames.length > 0 ? (
          <span className="text-text-secondary">{u.restaurantNames.join(", ")}</span>
        ) : (
          <span className="text-text-light">—</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      cell: (u) => (
        <div className="flex items-center gap-2">
          <Badge tone={STATUS_TONE[u.status]}>{STATUS_LABEL[u.status]}</Badge>
          {u.deletedAt && <Badge tone="neutral">Anonymised</Badge>}
        </div>
      ),
    },
    {
      key: "created",
      header: "Joined",
      hideBelow: "md",
      align: "right",
      cell: (u) => <span className="tnum text-text-light">{formatDate(u.createdAt)}</span>,
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      cell: (u) => {
        // Locking yourself out of the admin panel is not a recoverable mistake
        // without database access, so the controls simply are not offered.
        if (u.id === currentUserId) return <span className="text-xs text-text-light">—</span>;

        return (
          <div className="flex justify-end gap-1.5">
            {u.status === "active" && !u.deletedAt && (
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                className="text-error hover:bg-error-light"
                onClick={() => setSuspendId(u.id)}
              >
                Suspend
              </Button>
            )}
            {u.status === "suspended" && !u.deletedAt && (
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => act(() => reinstateUser(u.id), "Account reinstated.")}
              >
                Reinstate
              </Button>
            )}
            {!u.deletedAt && (
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => setAnonymiseId(u.id)}
              >
                Anonymise
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <>
      <FilterBar
        query={query}
        onQueryChange={setQuery}
        placeholder="Name or email…"
        onClear={() => {
          setQuery("");
          setRole("all");
          setStatus("all");
        }}
        selects={[
          {
            key: "role",
            label: "Role",
            value: role,
            onChange: setRole,
            options: [
              { value: "all", label: "All roles" },
              { value: "customer", label: "Customers" },
              { value: "manager", label: "Restaurant owners" },
              { value: "admin", label: "Administrators" },
            ],
          },
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
              { value: "anonymised", label: "Anonymised" },
            ],
          },
        ]}
      />

      <p className="mt-4 text-sm text-text-secondary">
        Showing {rows.length} of {users.length}
      </p>

      <div className="mt-3 overflow-hidden rounded-lg border border-border bg-surface">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(u) => u.id}
          empty={<EmptyState icon={<Users />} title="No users" />}
        />
      </div>

      <ConfirmDialog
        open={suspendId !== null}
        onClose={() => setSuspendId(null)}
        onConfirm={() => {
          const id = suspendId;
          setSuspendId(null);
          if (id) act(() => suspendUser(id), "Account suspended and sessions revoked.");
        }}
        title="Suspend this account?"
        // §12 rule 6. Revoking refresh tokens stops new access tokens; the
        // status check on every request closes the up-to-an-hour window left by
        // a token already in their browser. Both halves are needed.
        message="Access is revoked immediately, including on sessions already open. The account's data is kept and the suspension is reversible."
        confirmLabel="Suspend"
        destructive
      />

      <TypedConfirmDialog
        open={anonymiseId !== null}
        onClose={() => setAnonymiseId(null)}
        onConfirm={() => {
          const id = anonymiseId;
          setAnonymiseId(null);
          if (id) act(() => anonymiseUser(id), "Account anonymised.");
        }}
        title="Anonymise this account"
        // §12 rule 7 — anonymise, never delete.
        message="The name, email and phone number are permanently overwritten and access is removed. Orders, payments and commissions stay in the database: deleting them would destroy the restaurants' accounts and the commission calculation."
        phrase="ANONYMISE"
        confirmLabel="Anonymise account"
        hint="This cannot be undone."
      />
    </>
  );
}
