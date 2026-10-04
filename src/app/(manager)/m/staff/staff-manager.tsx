"use client";

import { useState, useTransition } from "react";
import { Clock, Mail, RotateCcw, ShieldCheck, UserCog, UserPlus, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Radio, Select } from "@/components/ui/input";
import { Sheet, SheetActions } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { useDates } from "@/lib/format/use-dates";
import { BRANCH_ROLES, capabilitiesFor, type BranchRole } from "@/lib/capabilities";
import {
  addStaffToBranch,
  cancelInvite,
  changeStaffRole,
  inviteStaff,
  reinstateStaff,
  suspendStaff,
} from "@/lib/data/manager-actions";
import { useLocale } from "@/lib/i18n/use-locale";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import type { StaffMember } from "@/lib/data/manager";

const STATUS_TONE: Record<StaffMember["status"], BadgeTone> = {
  active: "success",
  invited: "warning",
  suspended: "neutral",
};

/**
 * The read layer's own fallback when an invitation has no name and no address
 * to show yet. It is a French literal in lib/data/manager.ts, which this screen
 * does not own, so it is swapped for a translated one here rather than shipping
 * the one untranslatable name on the page.
 */
const PENDING_NAME = "Invitation en attente";

/**
 * The same shape inviteStaff() enforces. Duplicated so the send button is not
 * offered for an address the server is about to refuse — the server's copy is
 * still the one that decides.
 */
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** What the confirmation dialog is about. */
type Confirmation = { id: string; name: string; kind: "suspend" | "cancelInvite" };

/**
 * The branch roster, on live rows.
 *
 * §2 — permission comes from `restaurant_staff.role`, PER BRANCH. That is why
 * the role is edited on this screen, row by row, and never on the user's
 * account: the same person can be owner here and waiter at the next location.
 *
 * Every guard below is duplicated in manager-actions.ts. The copies here exist
 * so a manager is not offered a button that will be refused; the server ones
 * are the ones that decide, because a Server Action is a public POST endpoint
 * that never passes through this component.
 */
export function StaffManager({
  staff,
  myProfileId,
  isOwner,
  restaurantName,
  branchLabel,
  otherBranches = [],
}: {
  staff: StaffMember[];
  /** Other locations of this restaurant where the viewer manages staff. */
  otherBranches?: { id: string; label: string; isOwner: boolean }[];
  myProfileId: string;
  /** Only an owner may create or demote another owner. */
  isOwner: boolean;
  restaurantName: string;
  /** null for the primary location, whose label adds nothing to the heading. */
  branchLabel: string | null;
}) {
  const { t } = useLocale();
  const dates = useDates();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<BranchRole>("waiter");
  // The address is only judged once they have finished typing it. Complaining
  // at the first keystroke marks every email invalid on the way in.
  const [emailTouched, setEmailTouched] = useState(false);
  const [confirming, setConfirming] = useState<Confirmation | null>(null);
  // Adding a colleague to another location of the same restaurant.
  const [moving, setMoving] = useState<StaffMember | null>(null);
  const [moveTarget, setMoveTarget] = useState(otherBranches[0]?.id ?? "");
  const [moveRole, setMoveRole] = useState<BranchRole>("waiter");

  // An owner may appoint another owner; a manager may not. Filtering the list
  // is a courtesy — inviteStaff and changeStaffRole refuse it either way.
  const assignableRoles = BRANCH_ROLES.filter((r) => isOwner || r !== "owner");

  const typedEmail = inviteEmail.trim();
  const emailValid = EMAIL_RE.test(typedEmail);
  const emailRejected = emailTouched && typedEmail !== "" && !emailValid;

  const nameOf = (member: StaffMember) =>
    member.name === PENDING_NAME ? t("mst.pendingInvite") : member.name;

  const roleLabel = (role: BranchRole) => t(`mst.role.${role}` as TranslationKey);

  function whenLabel(member: StaffMember): string {
    if (member.status === "invited") {
      return member.invitedAt ? t("mst.invitedOn", { date: dates.date(member.invitedAt) }) : "—";
    }
    return member.acceptedAt ? t("mst.memberSince", { date: dates.date(member.acceptedAt) }) : "—";
  }

  function run(
    fn: () => Promise<{ ok: boolean; error?: string; note?: string }>,
    success: string,
    // Runs only when the server said yes, so a sheet or a dialog stays open —
    // with its data — on the one path where the user still needs it.
    onSuccess?: () => void,
  ) {
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) return toast(result.error ?? t("common.error"), "error");
      onSuccess?.();
      // Added, but the email did not go — warn rather than claim success.
      if (result.note) return toast(result.note, "warning");
      toast(success, "success");
    });
  }

  function closeInvite() {
    setInviteOpen(false);
    setInviteEmail("");
    setInviteName("");
    setInviteRole("waiter");
    setEmailTouched(false);
  }

  function submitInvite() {
    if (!emailValid) return;

    run(
      () =>
        inviteStaff({ email: typedEmail, role: inviteRole, name: inviteName.trim() || undefined }),
      t("mst.toast.invited"),
      closeInvite,
    );
  }

  function confirmAction() {
    const target = confirming;
    if (!target) return;

    if (target.kind === "cancelInvite") {
      run(() => cancelInvite(target.id), t("mst.toast.inviteCancelled"), () => setConfirming(null));
    } else {
      run(
        () => suspendStaff(target.id),
        t("mst.toast.suspended", { name: target.name }),
        () => setConfirming(null),
      );
    }
  }

  const columns: Column<StaffMember>[] = [
    {
      key: "person",
      header: t("mst.col.person"),
      // An avatar beside a name already says "member"; a label above it in
      // card mode is noise.
      hideLabelOnCard: true,
      cell: (member) => {
        const isMe = member.profileId === myProfileId;

        return (
          <div className="flex min-w-0 items-center gap-3 text-left">
            <Avatar name={nameOf(member)} src={member.avatarUrl} size="sm" />

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="truncate font-semibold text-text">{nameOf(member)}</span>
                <Badge tone={STATUS_TONE[member.status]}>
                  <span>{t(`mst.status.${member.status}` as TranslationKey)}</span>
                </Badge>
                {isMe && (
                  <Badge tone="info">
                    <span>{t("mst.you")}</span>
                  </Badge>
                )}
              </div>

              {member.email !== "" && (
                <p className="mt-0.5 truncate text-sm text-text-secondary">{member.email}</p>
              )}

              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-text-light">
                <Clock className="size-3 shrink-0" aria-hidden />
                <span>{whenLabel(member)}</span>
              </p>
            </div>
          </div>
        );
      },
    },
    {
      key: "role",
      header: t("mst.col.role"),
      width: "w-52",
      cell: (member) => {
        const isMe = member.profileId === myProfileId;
        // A manager may not touch an owner row at all: no demotion, and no
        // promotion of themselves by way of it.
        const ownerLocked = member.isOwner && !isOwner;

        // An outstanding invitation has nobody behind it yet, so there is no
        // role to change — only an invitation to cancel and re-send.
        if (member.status === "invited") {
          return (
            <Badge tone="neutral">
              <span>{roleLabel(member.role)}</span>
            </Badge>
          );
        }

        const locked = isMe
          ? t("mst.cannotChangeOwnRole")
          : ownerLocked
            ? t("mst.ownerProtected")
            : null;

        // The current role must stay in the list even when it is not
        // assignable, or a manager looking at an owner sees a blank select.
        const options = assignableRoles.includes(member.role)
          ? assignableRoles
          : [member.role, ...assignableRoles];

        return (
          // The reason sits on the wrapper, not the control: a disabled form
          // control fires no pointer events, so a `title` on it never surfaces
          // and the greying-out goes unexplained.
          <span className="block" title={locked ?? undefined}>
            <Select
              aria-label={t("mst.roleOf", { name: nameOf(member) })}
              value={member.role}
              disabled={pending || locked !== null}
              className="h-9 w-full min-w-38 text-sm"
              onChange={(e) => {
                const next = e.target.value as BranchRole;
                run(
                  () => changeStaffRole(member.id, next),
                  t("mst.toast.roleChanged", { name: nameOf(member), role: roleLabel(next) }),
                );
              }}
            >
              {options.map((role) => (
                <option key={role} value={role}>
                  {roleLabel(role)}
                </option>
              ))}
            </Select>
          </span>
        );
      },
    },
    {
      key: "actions",
      header: t("mst.col.actions"),
      align: "right",
      width: "w-44",
      hideLabelOnCard: true,
      cell: (member) => {
        const isMe = member.profileId === myProfileId;
        const ownerLocked = member.isOwner && !isOwner;

        // Suspending yourself locks you out of the branch you are
        // administering; suspending the owner is not a manager's call. The
        // last-owner rule needs no mirror here — a viewer who is an owner is
        // themselves an active owner row, so a SECOND owner on screen can
        // never be the only one left.
        const blocked = isMe
          ? t("mst.cannotSuspendSelf")
          : ownerLocked
            ? t("mst.ownerProtected")
            : null;

        return (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {member.status === "active" && member.profileId && otherBranches.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => {
                  setMoveTarget(otherBranches[0]?.id ?? "");
                  setMoveRole(member.role === "owner" ? "manager" : member.role);
                  setMoving(member);
                }}
              >
                <span>{t("mst.toBranch")}</span>
              </Button>
            )}
            {member.status === "invited" ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                aria-label={t("mst.cancelInviteFor", { name: nameOf(member) })}
                onClick={() =>
                  setConfirming({ id: member.id, name: nameOf(member), kind: "cancelInvite" })
                }
              >
                <X className="size-3.5" aria-hidden />
                <span>{t("mst.cancelInvite")}</span>
              </Button>
            ) : member.status === "suspended" ? (
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                aria-label={t("mst.reinstateFor", { name: nameOf(member) })}
                onClick={() =>
                  run(
                    () => reinstateStaff(member.id),
                    t("mst.toast.reinstated", { name: nameOf(member) }),
                  )
                }
              >
                <RotateCcw className="size-3.5" aria-hidden />
                <span>{t("mst.reinstate")}</span>
              </Button>
            ) : (
              <span title={blocked ?? undefined}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-error hover:bg-error-light"
                  disabled={pending || blocked !== null}
                  aria-label={t("mst.suspendFor", { name: nameOf(member) })}
                  onClick={() =>
                    setConfirming({ id: member.id, name: nameOf(member), kind: "suspend" })
                  }
                >
                  <span>{t("mst.suspend")}</span>
                </Button>
              </span>
            )}
          </div>
        );
      },
    },
  ];

  const cancelling = confirming?.kind === "cancelInvite";

  return (
    <>
      {/* Stacked below `sm`: the invite button lands under the heading at full
          width rather than beside it, where it would squeeze the branch name. */}
      <div className="mb-5 flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="font-display truncate text-base font-bold">
              {t("mst.teamOf", { name: restaurantName })}
            </span>
            {branchLabel !== null && (
              <Badge tone="primary">
                <span>{branchLabel}</span>
              </Badge>
            )}
          </div>

          <Button fullWidth className="sm:w-auto" onClick={() => setInviteOpen(true)}>
            <UserPlus className="size-4" aria-hidden />
            <span>{t("mst.invite")}</span>
          </Button>
        </div>

        <p className="flex items-start gap-2.5 rounded-md border border-border bg-surface-2 p-4 text-sm text-text-secondary">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <span>{t("mst.branchNotice")}</span>
        </p>
      </div>

      {staff.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState
            icon={<UserCog />}
            title={t("mst.empty.title")}
            description={t("mst.empty.body")}
            action={
              <Button onClick={() => setInviteOpen(true)}>
                <UserPlus className="size-4" aria-hidden />
                <span>{t("mst.invite")}</span>
              </Button>
            }
          />
        </div>
      ) : (
        // The panel chrome only appears from `md`, where DataTable is a real
        // table again. Below it every row is already its own bordered card, and
        // a border around a stack of borders reads as a mistake.
        <div className="md:overflow-hidden md:rounded-lg md:border md:border-border md:bg-surface">
          <DataTable columns={columns} rows={staff} rowKey={(member) => member.id} />
        </div>
      )}

      {/* ── Invite ─────────────────────────────────────────────────────── */}
      <Sheet
        open={inviteOpen}
        onClose={closeInvite}
        title={t("mst.invite.title")}
        footer={
          <SheetActions>
            <Button variant="outline" disabled={pending} onClick={closeInvite}>
              <span>{t("common.cancel")}</span>
            </Button>
            {/* The sheet closes on success only — a rejected address would
                otherwise take the whole form with it. */}
            <Button loading={pending} disabled={!emailValid} onClick={submitInvite}>
              <span>{t("mst.invite.send")}</span>
            </Button>
          </SheetActions>
        }
      >
        <div className="flex flex-col gap-4">
          <Field
            label={t("mst.invite.email")}
            htmlFor="invite-email"
            required
            hint={t("mst.invite.emailHint")}
            error={emailRejected ? t("mst.invite.emailInvalid") : undefined}
          >
            <Input
              id="invite-email"
              type="email"
              icon={<Mail />}
              invalid={emailRejected}
              value={inviteEmail}
              // Cleared on every keystroke so the complaint disappears the
              // moment they start fixing it, not once they finish.
              onChange={(e) => {
                setInviteEmail(e.target.value);
                setEmailTouched(false);
              }}
              onBlur={() => setEmailTouched(true)}
              placeholder={t("mst.invite.emailPh")}
            />
          </Field>

          <Field label={t("mst.invite.name")} htmlFor="invite-name" hint={t("mst.invite.nameHint")}>
            <Input
              id="invite-name"
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              placeholder={t("mst.invite.namePh")}
            />
          </Field>

          <fieldset>
            <legend className="mb-2 text-sm font-semibold">{t("mst.invite.roleLegend")}</legend>
            <div className="flex flex-col gap-2">
              {assignableRoles.map((role) => (
                <Radio
                  key={role}
                  name="invite-role"
                  checked={inviteRole === role}
                  disabled={pending}
                  onChange={() => setInviteRole(role)}
                  label={<span>{roleLabel(role)}</span>}
                  description={t(`mst.roleDesc.${role}` as TranslationKey)}
                />
              ))}
            </div>
          </fieldset>

          {/* What the role actually grants, spelled out. A role name alone is
              a guess; this is the capability matrix the server enforces. */}
          <div className="rounded-md border border-border bg-surface-2 p-4">
            <p className="mb-2 text-xs font-bold tracking-wide text-text-light uppercase">
              {t("mst.invite.grants")}
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {capabilitiesFor(inviteRole).map((capability) => (
                <li key={capability}>
                  <Badge tone="neutral">
                    <span>{t(`mst.cap.${capability}` as TranslationKey)}</span>
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Sheet>

      {/* One dialog for both destructive gestures — suspension, which keeps the
          row, and cancelling an invitation, which is the one staff row that CAN
          be deleted because nobody has worked under it yet. */}
      {/* ── Add to another location ────────────────────────────────────── */}
      <Dialog
        open={moving !== null}
        onClose={() => setMoving(null)}
        title={t("mst.toBranch.title", { name: moving ? nameOf(moving) : "" })}
        size="sm"
        footer={
          <>
            <Button variant="outline" disabled={pending} onClick={() => setMoving(null)}>
              <span>{t("common.cancel")}</span>
            </Button>
            <Button
              loading={pending}
              disabled={pending || !moveTarget}
              onClick={() => {
                const member = moving;
                if (!member) return;
                run(
                  () => addStaffToBranch({ staffId: member.id, targetRestaurantId: moveTarget, role: moveRole }),
                  t("mst.toBranch.submit"),
                  () => setMoving(null),
                );
              }}
            >
              <span>{t("mst.toBranch.submit")}</span>
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-secondary">{t("mst.toBranch.body")}</p>
          <Field label={t("mst.toBranch.branch")} htmlFor="move-branch">
            <Select id="move-branch" value={moveTarget} onChange={(e) => setMoveTarget(e.target.value)}>
              {otherBranches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("mst.toBranch.role")} htmlFor="move-role">
            <Select id="move-role" value={moveRole} onChange={(e) => setMoveRole(e.target.value as BranchRole)}>
              {BRANCH_ROLES.filter(
                (role) => role !== "owner" || otherBranches.find((branch) => branch.id === moveTarget)?.isOwner,
              ).map((role) => (
                <option key={role} value={role}>
                  {roleLabel(role)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title={
          cancelling
            ? t("mst.cancelInvite.title", { name: confirming?.name ?? "" })
            : t("mst.suspend.title", { name: confirming?.name ?? "" })
        }
        /* Suspension, not deletion: the row stays so the orders and status
           changes they recorded keep naming somebody (§12 rule 7). */
        message={cancelling ? t("mst.cancelInvite.body") : t("mst.suspend.body")}
        confirmLabel={cancelling ? t("mst.cancelInvite.confirm") : t("mst.suspend")}
        cancelLabel={cancelling ? t("mst.cancelInvite.keep") : t("common.cancel")}
        destructive
        loading={pending}
        onConfirm={confirmAction}
      />
    </>
  );
}
