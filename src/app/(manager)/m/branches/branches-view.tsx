"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Copy, CreditCard, Info, Lock, MapPin, Plus, RotateCcw, Store } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input, Select, Switch } from "@/components/ui/input";
import { Sheet, SheetActions } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { formatMoney } from "@/lib/format/currency";
import { useLocale } from "@/lib/i18n/use-locale";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import type { NextBranchCost } from "@/lib/branches/coverage";
import {
  closeBranch,
  copyMenuToBranch,
  createBranch,
  payForBranches,
  reopenBranch,
  syncBranchMenu,
} from "@/lib/data/branch-actions";
import { cn } from "@/lib/utils";
import { useBranchNavigation } from "@/components/layout/branch-navigation";
import type { BranchLeader, BranchTeamChoice, BranchTeamMember } from "@/lib/branches/team-types";

const EMPTY_FORM = { label: "", quartier: "", address: "", phone: "", copyMenu: true, manager: "", managerEmail: "", coOwner: "", coOwnerEmail: "" };

function teamChoice(value: string, email: string): BranchTeamChoice {
  return value === "invite" ? { kind: "invite", email } : value ? { kind: "member", profileId: value } : { kind: "none" };
}

interface BranchItem {
  id: string;
  label: string;
  addressLine: string | null;
  status: string;
  closed: boolean;
  canOpen: boolean;
  /** Dishes on its menu — an empty one is offered the main's. */
  dishes: number;
}

/** What the owner reads on each row — the plan's verdict, not the raw column. */
function rowState(branch: BranchItem): { key: TranslationKey; tone: BadgeTone } {
  if (branch.closed) return { key: "mbr.status.closed", tone: "neutral" };
  switch (branch.status) {
    case "active":
      return { key: "mbr.status.active", tone: "success" };
    case "paused":
      return { key: "mbr.status.paused", tone: "warning" };
    case "suspended":
      return { key: "mbr.status.suspended", tone: "error" };
    default:
      return { key: "mbr.status.pending", tone: "neutral" };
  }
}

export function BranchesView({
  migrated,
  activeId,
  main,
  plan,
  subscriptionLive,
  paidExtra,
  open,
  covered,
  waiting,
  topUp,
  freeMode,
  nextCost,
  branches,
  overview,
  team,
  leaders,
  actorProfileId,
}: {
  /** Each location's money and orders, for the group view. */
  overview: { id: string; balance: number; ordersToday: number; orders7d: number; income7d: number }[];
  migrated: boolean;
  activeId: string;
  main: { id: string; name: string; label: string; dishes: number; owner: { id: string | null; name: string } };
  team: { available: boolean; members: BranchTeamMember[] };
  leaders: Record<string, BranchLeader[]>;
  actorProfileId: string | null;
  plan: { name: string; tier: string; includedBranches: number; extraBranchPrice: number | null } | null;
  subscriptionLive: boolean;
  paidExtra: number;
  open: number;
  covered: number;
  /** Open branches waiting on a payment (paused, not closed). */
  waiting: number;
  topUp: { id: string; amount: number } | null;
  freeMode: boolean;
  nextCost: NextBranchCost;
  branches: BranchItem[];
}) {
  const { t } = useLocale();
  const { toast } = useToast();
  const router = useRouter();
  const { switchTo, switching } = useBranchNavigation();
  const [pending, startTransition] = useTransition();

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [closing, setClosing] = useState<BranchItem | null>(null);
  const [syncing, setSyncing] = useState<BranchItem | null>(null);
  // The refusal of the open sheet or dialog, shown in it (ui/form-error).
  const [formError, setFormError] = useState<string | null>(null);

  const allowsBranches = plan !== null && (plan.includedBranches > 1 || plan.extraBranchPrice !== null);
  const includedBranches = Math.max(0, (plan?.includedBranches ?? 1) - 1);

  /**
   * Invoices are paid from the MAIN restaurant — the pay page is scoped to
   * the active branch, like every billing screen. An owner standing on a
   * branch is switched over first, then sent to pay.
   */
  function goPay(invoiceId: string) {
    switchTo(main.id, `/m/billing/pay/${invoiceId}`);
  }

  function openBranch(id: string) {
    switchTo(id, "/m");
  }

  function submit() {
    setFormError(null);
    if (form.label.trim().length < 2) return setFormError(t("mbr.err.label"));
    if (!form.quartier.trim()) return setFormError(t("mbr.err.quartier"));
    if (form.address.trim().length < 4 || /^\+?[\d\s().-]{9,}$/.test(form.address.trim())) return setFormError(t("mbr.err.address"));
    if ([form.manager === "invite" ? form.managerEmail : null, form.coOwner === "invite" ? form.coOwnerEmail : null]
      .some(email => email !== null && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()))) return setFormError(t("est.emailInvalid"));
    startTransition(async () => {
      const result = await createBranch({
        label: form.label, quartier: form.quartier, address: form.address, phone: form.phone,
        copyMenu: form.copyMenu && main.dishes > 0,
        manager: teamChoice(form.manager, form.managerEmail), coOwner: teamChoice(form.coOwner, form.coOwnerEmail),
      });
      if (!result.ok) return setFormError(result.error);

      setAdding(false);
      setForm(EMPTY_FORM);
      if (result.note) toast(result.note, "success");
      if (result.invoiceId) return goPay(result.invoiceId);
      router.refresh();
    });
  }

  function copyMenu(branch: BranchItem) {
    startTransition(async () => {
      const result = await copyMenuToBranch(branch.id);
      if (!result.ok) return toast(result.error, "error");
      if (result.note) toast(result.note, "success");
      router.refresh();
    });
  }

  function confirmSync() {
    if (!syncing) return;
    const target = syncing;
    startTransition(async () => {
      const result = await syncBranchMenu(target.id);
      if (!result.ok) return setFormError(result.error);
      setSyncing(null);
      if (result.note) toast(result.note, "success");
      router.refresh();
    });
  }

  function confirmClose() {
    if (!closing) return;
    const target = closing;
    startTransition(async () => {
      const result = await closeBranch(target.id);
      if (!result.ok) return setFormError(result.error);
      setClosing(null);
      if (result.note) toast(result.note, "success");
      router.refresh();
    });
  }

  function reopen(branch: BranchItem) {
    startTransition(async () => {
      const result = await reopenBranch(branch.id);
      if (!result.ok) return toast(result.error, "error");
      if (result.note) toast(result.note, "success");
      if (result.invoiceId) return goPay(result.invoiceId);
      router.refresh();
    });
  }

  function payWaiting() {
    startTransition(async () => {
      if (topUp) return goPay(topUp.id);
      const result = await payForBranches();
      if (!result.ok) return toast(result.error, "error");
      if (result.invoiceId) return goPay(result.invoiceId);
      if (result.note) toast(result.note, "info");
      router.refresh();
    });
  }

  if (!migrated) {
    return (
      <Card className="mx-auto max-w-lg">
        <CardBody className="py-10 text-center text-sm text-text-secondary">{t("mbr.err.migration")}</CardBody>
      </Card>
    );
  }

  /* ── Starter: one location, and the way up ──────────────────────────── */
  if (!allowsBranches) {
    return (
      <Card className="mx-auto max-w-lg">
        <CardBody className="py-12 text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-warning-light text-warning">
            <Lock className="size-6" aria-hidden />
          </span>
          <h2 className="mt-4 font-display text-xl font-bold">{t("mbr.upsell.title")}</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-text-secondary">{t("mbr.upsell.body")}</p>
          {branches.length > 0 && (
            <p className="mx-auto mt-3 max-w-sm text-sm font-semibold text-warning">
              {t("mbr.upsell.pausedCount", { count: branches.length })}
            </p>
          )}
          <Link href="/m/billing" className={buttonClasses({ size: "lg", className: "mt-6 w-full sm:w-auto" })}>
            {t("mbr.upsell.cta")}
          </Link>
        </CardBody>
      </Card>
    );
  }

  const costLine = (() => {
    switch (nextCost.kind) {
      case "covered":
        return t("mbr.add.costCovered");
      case "unavailable":
        return t("mbr.add.unavailable");
      case "extra":
        if (freeMode) return t("mbr.add.costExtraFree", { monthly: formatMoney(nextCost.monthly) });
        if (nextCost.dueNow <= 0) return t("mbr.add.costExtraRenewal", { monthly: formatMoney(nextCost.monthly) });
        return t("mbr.add.costExtra", {
          monthly: formatMoney(nextCost.monthly),
          now: formatMoney(nextCost.dueNow),
          days: nextCost.days,
        });
    }
  })();

  const canAdd = subscriptionLive && nextCost.kind !== "unavailable";
  const busy = pending || switching;
  const candidates = team.members.filter(member => member.profileId !== main.owner.id);

  function teamLine(id: string, role: "owner" | "manager") {
    const people = (leaders[id] ?? []).filter(person => person.role === role);
    return people.length > 0
      ? people.map(person => person.invited ? t("mbr.list.invitedPerson", { name: person.name }) : person.name).join(", ")
      : role === "owner" ? main.owner.name : t("mbr.list.noManager");
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ── What the plan includes ─────────────────────────────────────── */}
      <Card>
        <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-light text-primary">
              <Building2 className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="font-display text-lg font-bold">{t("mbr.plan.title", { plan: plan?.name ?? "—" })}</p>
              <p className="mt-0.5 text-sm text-text-secondary">
                {includedBranches > 0
                  ? t("mbr.plan.included", { count: plan?.includedBranches ?? 1, branches: includedBranches })
                  : t("mbr.plan.mainOnly")}
              </p>
              <p className="mt-0.5 text-sm text-text-secondary">
                {plan?.extraBranchPrice !== null && plan?.extraBranchPrice !== undefined
                  ? t("mbr.plan.extraPrice", { price: formatMoney(plan.extraBranchPrice) })
                  : t("mbr.plan.noExtra")}
              </p>
              <p className="mt-2 text-sm font-semibold">
                {t("mbr.plan.usage", { open, covered: Math.min(open, covered) })}
                {paidExtra > 0 && <span className="font-normal text-text-secondary"> · {t("mbr.plan.paidExtra", { count: paidExtra })}</span>}
              </p>
            </div>
          </div>

          <span title={canAdd ? undefined : nextCost.kind === "unavailable" ? t("mbr.add.unavailable") : t("mbr.lapsed")}>
            <Button fullWidth className="sm:w-auto" disabled={!canAdd || pending} onClick={() => (setFormError(null), setAdding(true))}>
              <Plus className="size-4" aria-hidden />
              <span>{t("mbr.add.title")}</span>
            </Button>
          </span>
        </CardBody>
      </Card>

      {!subscriptionLive && (
        <p className="flex items-start gap-2.5 rounded-md border border-error/25 bg-error-light p-4 text-sm text-error">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <span>{t("mbr.lapsed")} </span>
            <Link href="/m/billing" className="font-semibold underline">
              {t("mbr.lapsedCta")}
            </Link>
          </span>
        </p>
      )}

      {/* ── Branches waiting on a payment ─────────────────────────────── */}
      {subscriptionLive && waiting > 0 && (
        <div className="flex flex-col gap-3 rounded-md border border-warning/30 bg-warning-light p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2.5 text-sm text-warning">
            <CreditCard className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              {topUp
                ? t("mbr.unpaid.bodyAmount", { count: waiting, amount: formatMoney(topUp.amount) })
                : t("mbr.unpaid.body", { count: waiting })}
            </span>
          </p>
          <Button size="sm" loading={pending} onClick={payWaiting}>
            <span>{topUp ? t("mbr.unpaid.payAmount", { amount: formatMoney(topUp.amount) }) : t("mbr.unpaid.pay")}</span>
          </Button>
        </div>
      )}

      {/* ── The locations ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <h2 className="font-display text-base font-bold">{t("mbr.list.title")}</h2>
        <p className="-mt-1 text-sm text-text-secondary">{t("mbr.list.help")}</p>

        <ul className="flex flex-col gap-2">
          <li className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <Store className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <div className="min-w-0">
                <p className="truncate font-semibold">
                  <span>{main.name}</span>
                  {main.label && main.label !== "Principal" && <span className="font-normal text-text-secondary"> — {main.label}</span>}
                </p>
                <p className="text-xs text-text-light">{t("mbr.list.main")}</p>
                <p className="mt-1 text-xs text-text-secondary">{t("mbr.list.owner", { names: teamLine(main.id, "owner") })}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone="success">{t("mbr.status.active")}</Badge>
              {activeId === main.id ? (
                <Badge tone="primary">{t("mbr.action.current")}</Badge>
              ) : (
                <Button variant="outline" size="sm" disabled={busy} onClick={() => openBranch(main.id)}>
                  <span>{t("mbr.action.open")}</span>
                </Button>
              )}
            </div>
          </li>

          {branches.map((branch) => {
            const state = rowState(branch);
            return (
              <li
                key={branch.id}
                className={cn(
                  "flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between",
                  (branch.closed || branch.status !== "active") && "bg-surface-2",
                )}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-text-light" aria-hidden />
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{branch.label}</p>
                    {branch.addressLine && <p className="truncate text-xs text-text-light">{branch.addressLine}</p>}
                    {branch.status === "paused" && !branch.closed && (
                      <p className="mt-1 text-xs text-warning">{t("mbr.status.pausedHint")}</p>
                    )}
                    {branch.closed && <p className="mt-1 text-xs text-text-secondary">{t("mbr.status.closedHint")}</p>}
                    <p className="mt-0.5 text-xs text-text-light">{t("mbr.list.dishes", { count: branch.dishes })}</p>
                    <p className="mt-1 text-xs text-text-secondary">{t("mbr.list.owner", { names: teamLine(branch.id, "owner") })}</p>
                    <p className="text-xs text-text-secondary">{t("mbr.list.manager", { names: teamLine(branch.id, "manager") })}</p>
                    {branch.canOpen && <button type="button" className="mt-1 text-xs font-semibold text-primary underline underline-offset-2 disabled:opacity-60" disabled={busy} onClick={() => switchTo(branch.id, "/m/staff")}>{t("mbr.action.team")}</button>}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={state.tone}>{t(state.key)}</Badge>
                  {branch.dishes === 0 && main.dishes > 0 && (
                    <Button variant="outline" size="sm" disabled={pending} onClick={() => copyMenu(branch)}>
                      <Copy className="size-3.5" aria-hidden />
                      <span>{t("mbr.action.copyMenu")}</span>
                    </Button>
                  )}
                  {branch.dishes > 0 && main.dishes > 0 && (
                    <Button variant="ghost" size="sm" disabled={pending} onClick={() => (setFormError(null), setSyncing(branch))}>
                      <RotateCcw className="size-3.5" aria-hidden />
                      <span>{t("mbr.action.syncMenu")}</span>
                    </Button>
                  )}
                  {activeId === branch.id ? (
                    <Badge tone="primary">{t("mbr.action.current")}</Badge>
                  ) : (
                    branch.canOpen && (
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => openBranch(branch.id)}>
                        <span>{t("mbr.action.open")}</span>
                      </Button>
                    )
                  )}
                  {branch.status !== "suspended" &&
                    (branch.closed ? (
                      <Button variant="outline" size="sm" disabled={pending || !subscriptionLive} onClick={() => reopen(branch)}>
                        <RotateCcw className="size-3.5" aria-hidden />
                        <span>{t("mbr.action.reopen")}</span>
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-error hover:bg-error-light"
                        disabled={pending}
                        onClick={() => (setFormError(null), setClosing(branch))}
                      >
                        <span>{t("mbr.action.close")}</span>
                      </Button>
                    ))}
                </div>
              </li>
            );
          })}
        </ul>

        {branches.length === 0 && (
          <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-text-secondary">
            {t("mbr.list.empty")}
          </p>
        )}
      </div>

      {/* ── The group at a glance ─────────────────────────────────────── */}
      {branches.length > 0 && overview.length > 0 && (
        <div className="flex flex-col gap-3">
          <div>
            <h2 className="font-display text-base font-bold">{t("mbr.ov.title")}</h2>
            <p className="text-sm text-text-secondary">{t("mbr.ov.subtitle")}</p>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] font-bold tracking-[0.08em] text-text-light uppercase">
                  <th className="px-4 py-3">{t("mbr.ov.location")}</th>
                  <th className="px-4 py-3 text-right">{t("mbr.ov.ordersToday")}</th>
                  <th className="px-4 py-3 text-right">{t("mbr.ov.orders7d")}</th>
                  <th className="px-4 py-3 text-right">{t("mbr.ov.income7d")}</th>
                  <th className="px-4 py-3 text-right">{t("mbr.ov.balance")}</th>
                </tr>
              </thead>
              <tbody>
                {overview.map((row) => {
                  const label =
                    row.id === main.id
                      ? main.label && main.label !== "Principal"
                        ? main.label
                        : main.name
                      : (branches.find((branch) => branch.id === row.id)?.label ?? "—");
                  return (
                    <tr key={row.id} className="border-b border-border last:border-b-0">
                      <td className="px-4 py-3 font-semibold">{label}</td>
                      <td className="tnum px-4 py-3 text-right">{row.ordersToday}</td>
                      <td className="tnum px-4 py-3 text-right">{row.orders7d}</td>
                      <td className="tnum px-4 py-3 text-right">{formatMoney(row.income7d)}</td>
                      <td className="tnum px-4 py-3 text-right">{formatMoney(row.balance)}</td>
                    </tr>
                  );
                })}
                <tr className="bg-surface-2 font-bold">
                  <td className="px-4 py-3">{t("mbr.ov.total")}</td>
                  <td className="tnum px-4 py-3 text-right">{overview.reduce((sum, row) => sum + row.ordersToday, 0)}</td>
                  <td className="tnum px-4 py-3 text-right">{overview.reduce((sum, row) => sum + row.orders7d, 0)}</td>
                  <td className="tnum px-4 py-3 text-right">{formatMoney(overview.reduce((sum, row) => sum + row.income7d, 0))}</td>
                  <td className="tnum px-4 py-3 text-right">{formatMoney(overview.reduce((sum, row) => sum + row.balance, 0))}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="flex items-start gap-2.5 rounded-md border border-border bg-surface-2 p-4 text-sm text-text-secondary">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <span>{t("mbr.rules")}</span>
      </p>

      {/* ── Open a branch ──────────────────────────────────────────────── */}
      <Sheet
        error={formError}
        open={adding}
        onClose={() => { if (!pending) setAdding(false); }}
        title={t("mbr.add.title")}
        description={t("mbr.add.body", { name: main.name })}
        footer={
          <SheetActions>
            <Button variant="outline" disabled={pending} onClick={() => setAdding(false)}>
              <span>{t("common.cancel")}</span>
            </Button>
            <Button
              loading={pending}
              disabled={!canAdd || !team.available}
              onClick={submit}
            >
              <span>
                {nextCost.kind === "extra" && nextCost.dueNow > 0 && !freeMode ? t("mbr.add.submitPay") : t("mbr.add.submit")}
              </span>
            </Button>
          </SheetActions>
        }
      >
        <fieldset disabled={pending} className="flex min-w-0 flex-col gap-4">
          <Field label={t("mbr.add.label")} htmlFor="branch-label" required hint={t("mbr.add.labelHint")}>
            <Input
              id="branch-label"
              value={form.label}
              maxLength={60}
              placeholder={t("mbr.add.labelPlaceholder")}
              onChange={(e) => setForm((prev) => ({ ...prev, label: e.target.value }))}
            />
          </Field>
          <Field label={t("mbr.add.quartier")} htmlFor="branch-quartier" required hint={t("mbr.add.quartierHint")}>
            <Input
              id="branch-quartier"
              value={form.quartier}
              placeholder={t("mbr.add.quartierPlaceholder")}
              maxLength={120}
              onChange={(e) => setForm((prev) => ({ ...prev, quartier: e.target.value }))}
            />
          </Field>
          <Field label={t("mbr.add.address")} htmlFor="branch-address" required hint={t("mbr.add.addressHint")}>
            <Input
              id="branch-address"
              value={form.address}
              placeholder={t("mbr.add.addressPlaceholder")}
              autoComplete="street-address"
              maxLength={300}
              onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))}
            />
          </Field>
          {main.dishes > 0 && (
            <Switch
              label={t("mbr.add.copyMenu", { count: main.dishes })}
              description={t("mbr.add.copyMenuHint")}
              checked={form.copyMenu}
              onChange={(e) => setForm((prev) => ({ ...prev, copyMenu: e.target.checked }))}
            />
          )}
          <Field label={t("mbr.add.phone")} htmlFor="branch-phone" hint={t("mbr.add.phoneHint")}>
            <Input
              id="branch-phone"
              type="tel"
              inputMode="tel"
              value={form.phone}
              placeholder={t("mbr.add.phonePlaceholder")}
              onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
            />
          </Field>

          <fieldset className="mt-1 flex flex-col gap-4 border-t border-border pt-4">
            <legend className="px-0 font-display text-base font-bold">{t("mbr.add.teamTitle")}</legend>
            <p className="-mt-2 text-xs leading-relaxed text-text-secondary">{t("mbr.add.teamIntro")}</p>
            {!team.available && <p role="alert" className="text-sm text-error">{t("mbr.err.teamUnavailable")}</p>}
            <Field label={t("mbr.add.manager")} htmlFor="branch-manager" hint={t("mbr.add.managerHint")}>
              <Select id="branch-manager" value={form.manager} disabled={!team.available || pending} onChange={event => setForm(prev => ({ ...prev, manager: event.target.value, managerEmail: "" }))}>
                <option value="">{t("mbr.add.managerLater")}</option>
                {candidates.filter(member => member.profileId !== actorProfileId && member.profileId !== form.coOwner).map(member => <option key={member.profileId} value={member.profileId}>{member.name} · {member.email}</option>)}
                <option value="invite">{t("mbr.add.inviteManager")}</option>
              </Select>
            </Field>
            {form.manager === "invite" && <Field label={t("mbr.add.managerEmail")} htmlFor="branch-manager-email" required hint={t("mbr.add.inviteHint")}>
              <Input id="branch-manager-email" type="email" autoComplete="off" maxLength={254} placeholder={t("mbr.add.emailPlaceholder")} value={form.managerEmail} onChange={event => setForm(prev => ({ ...prev, managerEmail: event.target.value }))} />
            </Field>}
            <Field label={t("mbr.add.owner")} htmlFor="branch-owner" hint={t("mbr.add.ownerHint", { name: main.owner.name })}>
              <Select id="branch-owner" value={form.coOwner} disabled={!team.available || pending} onChange={event => setForm(prev => ({ ...prev, coOwner: event.target.value, coOwnerEmail: "" }))}>
                <option value="">{t("mbr.add.keepOwner", { name: main.owner.name })}</option>
                {candidates.filter(member => member.profileId !== form.manager && member.profileId !== actorProfileId).map(member => <option key={member.profileId} value={member.profileId}>{t("mbr.add.coOwnerPerson", { name: member.name })}</option>)}
                <option value="invite">{t("mbr.add.inviteCoOwner")}</option>
              </Select>
            </Field>
            {form.coOwner && <p className="rounded-md border border-warning/25 bg-warning-light p-3 text-xs leading-relaxed text-warning">{t("mbr.add.coOwnerAccess")}</p>}
            {form.coOwner === "invite" && <Field label={t("mbr.add.coOwnerEmail")} htmlFor="branch-owner-email" required hint={t("mbr.add.inviteHint")}>
              <Input id="branch-owner-email" type="email" autoComplete="off" maxLength={254} placeholder={t("mbr.add.emailPlaceholder")} value={form.coOwnerEmail} onChange={event => setForm(prev => ({ ...prev, coOwnerEmail: event.target.value }))} />
            </Field>}
          </fieldset>

          {/* The price BEFORE the commitment, from the same arithmetic the
              invoice will use (lib/branches/coverage). */}
          <p
            className={cn(
              "rounded-md border p-3 text-sm",
              nextCost.kind === "covered"
                ? "border-success/25 bg-success-light text-success"
                : nextCost.kind === "extra"
                  ? "border-info/25 bg-info-light text-info"
                  : "border-warning/30 bg-warning-light text-warning",
            )}
          >
            {costLine}
          </p>
        </fieldset>
      </Sheet>

      <ConfirmDialog
        error={formError}
        open={syncing !== null}
        onClose={() => setSyncing(null)}
        onConfirm={confirmSync}
        title={t("mbr.sync.title", { label: syncing?.label ?? "" })}
        message={t("mbr.sync.body", { label: syncing?.label ?? "" })}
        confirmLabel={t("mbr.action.syncMenu")}
        loading={pending}
      />

      <ConfirmDialog
        error={formError}
        open={closing !== null}
        onClose={() => setClosing(null)}
        onConfirm={confirmClose}
        title={t("mbr.close.title", { label: closing?.label ?? "" })}
        message={t("mbr.close.body")}
        confirmLabel={t("mbr.close.confirm")}
        destructive
        loading={pending}
      />
    </div>
  );
}
