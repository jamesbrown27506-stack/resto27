"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ShieldCheck, UserPlus } from "lucide-react";
import { SuperAdminOnlyHint, useIsSuperAdmin } from "@/components/layout/admin-shell";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardBody, Panel } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/format/datetime";
import {
  addAdministrator,
  removeAdministrator,
  setAdministratorLevel,
} from "@/lib/data/admin-management-actions";
import type { AdministratorRow } from "@/lib/data/admins";
import type { AdminLevel } from "@/lib/auth/super-admin-rules";

type Pending =
  | { kind: "promote" | "demote" | "remove"; admin: AdministratorRow }
  | null;

export function AdminsClient({
  admins,
  currentAdminId,
  migrated,
}: {
  admins: AdministratorRow[];
  currentAdminId: string;
  migrated: boolean;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isSuper = useIsSuperAdmin();

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [level, setLevel] = useState<AdminLevel>("simple");
  const [confirm, setConfirm] = useState<Pending>(null);

  const activeSupers = admins.filter((a) => a.isSuperAdmin && a.status === "active").length;

  function add() {
    startTransition(async () => {
      const result = await addAdministrator({ email, level, name });
      if (!result.ok) {
        toast(result.error, "error");
        return;
      }
      toast(result.note ?? "Administrator added.", "success");
      setEmail("");
      setName("");
      setLevel("simple");
      router.refresh();
    });
  }

  function apply(action: NonNullable<Pending>) {
    startTransition(async () => {
      const result =
        action.kind === "remove"
          ? await removeAdministrator(action.admin.id)
          : await setAdministratorLevel(action.admin.id, action.kind === "promote" ? "super" : "simple");
      if (!result.ok) {
        toast(result.error, "error");
        return;
      }
      toast(
        action.kind === "remove"
          ? `${action.admin.email} is no longer an administrator.`
          : action.kind === "promote"
            ? `${action.admin.email} is now a super administrator.`
            : `${action.admin.email} is now a simple administrator.`,
        "success",
      );
      router.refresh();
    });
  }

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      {!migrated && (
        <p className="flex items-start gap-2.5 rounded-md border border-warning/30 bg-warning-light p-4 text-sm text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Migration <strong>0063</strong> has not been run, so every administrator is treated as a super
            administrator and levels cannot be changed yet. Run it (then 0064) in the Supabase SQL editor.
          </span>
        </p>
      )}

      <Panel
        title="Add an administrator"
        description="An existing customer account is promoted in place. A new address receives an invitation to choose a password."
      >
        <CardBody>
          {isSuper ? (
            <form
              className="grid gap-4 sm:grid-cols-[1fr_1fr_12rem_auto] sm:items-end"
              onSubmit={(event) => {
                event.preventDefault();
                add();
              }}
            >
              <Field label="Email" htmlFor="adm-email" required>
                <Input
                  id="adm-email"
                  type="email"
                  autoComplete="off"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                />
              </Field>
              <Field label="Name" htmlFor="adm-name" hint="Used only for a new account.">
                <Input id="adm-name" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Level" htmlFor="adm-level">
                <Select id="adm-level" value={level} onChange={(e) => setLevel(e.target.value as AdminLevel)}>
                  <option value="simple">Simple administrator</option>
                  <option value="super">Super administrator</option>
                </Select>
              </Field>
              <Button type="submit" loading={pending} disabled={pending || !email.trim()}>
                <UserPlus className="size-4" aria-hidden />
                <span>Add</span>
              </Button>
            </form>
          ) : (
            <p className="flex flex-wrap items-center gap-2 text-sm text-text-secondary">
              <SuperAdminOnlyHint />
              Adding, promoting and removing administrators.
            </p>
          )}
          <p className="mt-4 text-xs text-text-light">
            Restaurant accounts cannot be made administrators — use a separate email address. Every change is
            written to the audit log.
          </p>
        </CardBody>
      </Panel>

      <Panel
        title={`Administrators (${admins.length})`}
        description={`${activeSupers} active super administrator${activeSupers === 1 ? "" : "s"}. The platform always keeps at least one.`}
      >
        <ul className="divide-y divide-border">
          {admins.map((a) => {
            const self = a.id === currentAdminId;
            return (
              <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4">
                <Avatar name={a.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-semibold">{a.name}</span>
                    {self && <span className="text-xs text-text-light">(you)</span>}
                    <Badge tone={a.isSuperAdmin ? "accent" : "neutral"}>
                      {a.isSuperAdmin ? (
                        <span className="inline-flex items-center gap-1">
                          <ShieldCheck className="size-3" aria-hidden />
                          Super
                        </span>
                      ) : (
                        "Simple"
                      )}
                    </Badge>
                    {a.status !== "active" && (
                      <Badge tone={a.status === "suspended" ? "error" : "warning"}>
                        {a.status === "suspended" ? "Suspended" : "Pending"}
                      </Badge>
                    )}
                    {a.invitePending && <Badge tone="info">Invitation pending</Badge>}
                  </p>
                  <p className="truncate text-sm text-text-secondary">{a.email}</p>
                  <p className="mt-0.5 text-xs text-text-light">
                    {a.lastSignInAt ? `Last sign-in ${formatDateTime(a.lastSignInAt)}` : "Never signed in"}
                  </p>
                </div>

                {isSuper && !self && (
                  <div className="flex flex-wrap gap-1.5">
                    {a.isSuperAdmin ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pending || !migrated}
                        onClick={() => setConfirm({ kind: "demote", admin: a })}
                      >
                        Make simple
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pending || !migrated || a.status !== "active"}
                        onClick={() => setConfirm({ kind: "promote", admin: a })}
                      >
                        Make super
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-error hover:bg-error-light"
                      disabled={pending}
                      onClick={() => setConfirm({ kind: "remove", admin: a })}
                    >
                      Remove
                    </Button>
                  </div>
                )}
                {isSuper && self && (
                  <span className="text-xs text-text-light" title="Another super administrator can change your level.">
                    Your own level cannot be changed here
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </Panel>

      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          const action = confirm;
          setConfirm(null);
          if (action) apply(action);
        }}
        title={
          confirm?.kind === "remove"
            ? "Remove administrator rights?"
            : confirm?.kind === "promote"
              ? "Make super administrator?"
              : "Make simple administrator?"
        }
        message={
          confirm?.kind === "remove"
            ? `${confirm.admin.email} loses access to /a on their next click. The account itself is kept (as a customer account); suspend or anonymise it from Users if needed.`
            : confirm?.kind === "promote"
              ? `${confirm?.admin.email} will control payments, fees, withdrawals, impersonation and administrators.`
              : `${confirm?.admin.email} keeps day-to-day administration but loses the money and security switches.`
        }
        confirmLabel={confirm?.kind === "remove" ? "Remove rights" : "Confirm"}
        destructive={confirm?.kind === "remove" || confirm?.kind === "demote"}
        loading={pending}
      />
    </div>
  );
}
