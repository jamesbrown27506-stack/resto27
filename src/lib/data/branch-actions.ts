"use server";

import { revalidatePath } from "next/cache";
import { getTranslator } from "@/lib/i18n/locale-server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireBranch } from "@/lib/auth/branch";
import { can } from "@/lib/capabilities";
import { phoneSchema } from "@/lib/auth/schemas";
import { rateLimit } from "@/lib/rate-limit";
import { notify } from "@/lib/notify";
import { writeAudit } from "@/lib/audit";
import { resolveOrCreateQuartier } from "./quartiers";
import {
  accountCoveredCount,
  accountOpenBranchCount,
  ensureBranchTopUp,
  loadBranchAccount,
  refreshBranchInvoices,
  syncBranchCoverage,
  type BranchAccount,
} from "@/lib/branches/account";
import { includedBranchSlots, planAllowsBranches } from "@/lib/branches/coverage";
import { entitlementsFor } from "@/lib/billing/entitlements";
import { announceBranchTeam, installBranchTeam, loadBranchTeam } from "@/lib/branches/team";
import { resolveBranchTeam } from "@/lib/branches/team-rules";
import type { BranchTeamChoice } from "@/lib/branches/team-types";

/**
 * Opening, closing and paying for branches — the owner's side of 0072.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHO: the owner of the MAIN restaurant (`billing.manage` there), wherever
 *  they happen to be standing. A branch is a financial commitment on the
 *  main's invoice, so a manager at a branch cannot open another one, and an
 *  owner currently switched to a branch still manages the whole account.
 *  Which main is resolved from the active branch on the server — never from
 *  an argument — like every other branch-scoped action.
 *
 *  WHAT THESE NEVER DO: decide who runs. They change the facts (a branch
 *  exists, is closed, is paid for) and hand over to the sync in
 *  lib/branches/account.ts, the one writer of 'paused', so the screen, the
 *  bill and the nightly sweep cannot reach different answers.
 * ─────────────────────────────────────────────────────────────────────────
 */

export type BranchActionResult =
  | {
      ok: true;
      note?: string;
      branchId?: string;
      /** An invoice to pay before the branch can run. */
      invoiceId?: string;
      amount?: number;
    }
  | { ok: false; error: string; reason?: string };

interface OwnerScope {
  mainId: string;
  account: BranchAccount;
  profile: Awaited<ReturnType<typeof requireBranch>>["profile"];
  impersonating: boolean;
}

/**
 * The account the caller owns, or the reason they cannot touch it.
 *
 * While impersonating, the admin is the owner of whatever they opened —
 * including a branch, whose main they then manage too (the audit log names
 * them either way).
 */
async function ownerScope(): Promise<{ ok: true; scope: OwnerScope } | { ok: false; error: string; reason: string }> {
  const t = await getTranslator();
  const context = await requireBranch();
  const mainId = context.active.parentId ?? context.active.restaurantId;

  const atMain = context.impersonating
    ? context.active
    : context.branches.find((branch) => branch.restaurantId === mainId);
  if (!atMain || !can(atMain.role, "billing.manage")) {
    return { ok: false, reason: "notOwner", error: t("mbr.err.notOwner") };
  }

  const account = await loadBranchAccount(mainId);
  if (!account) return { ok: false, reason: "notFound", error: t("mbr.err.notFound") };
  if (!account.migrated) return { ok: false, reason: "migration", error: t("mbr.err.migration") };

  return { ok: true, scope: { mainId, account, profile: context.profile, impersonating: context.impersonating } };
}

/** URL-safe form of a name: accents folded, punctuation dropped (as at signup). */
function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Everything a new location inherits from the main restaurant: the brand
 * and the way it serves. Its address, team, menu, tables and wallet are its
 * own — a branch is independent in service, one restaurant only in billing.
 */
const INHERITED_COLUMNS = [
  "description",
  "cuisine_id",
  "logo_url",
  "cover_url",
  "accepts_delivery",
  "accepts_pickup",
  "delivery_estimate_min",
  "minimum_order",
  "has_own_delivery",
  "min_delivery_fee",
  "max_delivery_fee",
] as const;

function revalidateBranchScreens() {
  revalidatePath("/m", "layout");
  revalidatePath("/m/branches");
  revalidatePath("/m/billing");
  revalidatePath("/a/restaurants");
}

/**
 * Copy the main's menu into one of its branches (0073, one transaction).
 *
 * Returns the number of dishes copied, or a reason. The SQL refuses a target
 * that is not this main's branch or whose menu already has dishes — a copy is
 * a starting point, never a merge.
 */
async function copyMenu(mainId: string, branchId: string): Promise<{ ok: true; dishes: number } | { ok: false; reason: string }> {
  const { data, error } = await createAdminClient().rpc("copy_restaurant_menu", {
    p_source: mainId,
    p_target: branchId,
  });
  if (!error) return { ok: true, dishes: Number(data ?? 0) };

  const message = error.message ?? "";
  if (message.includes("menu_copy_target_not_empty")) return { ok: false, reason: "notEmpty" };
  // 0073 not run yet: PostgREST cannot find the function.
  if (error.code === "PGRST202" || error.code === "42883") return { ok: false, reason: "migration" };
  console.error("[branches:copyMenu]", branchId, error.code ?? "", message);
  return { ok: false, reason: "failed" };
}

/** After a fact changed: run the sync, re-price open invoices, bill what is uncovered. */
async function settleCoverage(mainId: string) {
  await syncBranchCoverage(mainId);
  await refreshBranchInvoices(mainId);
  const fresh = await loadBranchAccount(mainId);
  if (fresh && accountOpenBranchCount(fresh) > accountCoveredCount(fresh)) {
    return ensureBranchTopUp(mainId);
  }
  return { kind: "covered" as const };
}

/* ── Open a branch ─────────────────────────────────────────────────────── */

export async function createBranch(input: {
  label: string;
  quartier: string;
  address: string;
  phone?: string;
  /** Start from the main's menu instead of an empty one. */
  copyMenu?: boolean;
  manager?: BranchTeamChoice;
  coOwner?: BranchTeamChoice;
}): Promise<BranchActionResult> {
  const t = await getTranslator();
  const owner = await ownerScope();
  if (!owner.ok) return owner;
  const { mainId, account, profile, impersonating } = owner.scope;

  // A restaurant row per click: cheap to abuse, so budgeted like signup.
  const limited = await rateLimit({ key: "branch:create", identifier: mainId, limit: 5, windowMs: 60 * 60_000 });
  if (!limited.ok) return { ok: false, reason: "rateLimited", error: t("mbr.err.tooMany") };

  if (account.main.status !== "active") return { ok: false, reason: "mainInactive", error: t("mbr.err.mainInactive") };

  const plan = account.plan;
  const sub = account.subscription;
  if (!plan || !sub || !planAllowsBranches(plan)) {
    return { ok: false, reason: "planNoBranches", error: t("mbr.err.planNoBranches") };
  }
  if (sub.state !== "active" && sub.state !== "grace") {
    return { ok: false, reason: "subscriptionLapsed", error: t("mbr.err.subscriptionLapsed") };
  }
  if (plan.extraBranchPrice === null && accountOpenBranchCount(account) + 1 > includedBranchSlots(plan)) {
    return {
      ok: false,
      reason: "planBranchLimit",
      error: t("mbr.err.planBranchLimit", { count: plan.includedBranches }),
    };
  }

  const label = input.label.trim();
  if (label.length < 2 || label.length > 60) return { ok: false, reason: "label", error: t("mbr.err.label") };
  const taken = [account.main.label, ...account.branches.map((branch) => branch.label)].some(
    (existing) => existing.trim().toLowerCase() === label.toLowerCase(),
  );
  if (taken) return { ok: false, reason: "labelTaken", error: t("mbr.err.labelTaken") };

  const address = input.address.trim();
  if (address.length < 4 || address.length > 300 || /^\+?[\d\s().-]{9,}$/.test(address)) {
    return { ok: false, reason: "address", error: t("mbr.err.address") };
  }

  let phone = (account.main.row.phone as string | null | undefined) ?? null;
  if (input.phone && input.phone.trim()) {
    const parsed = phoneSchema.safeParse(input.phone);
    if (!parsed.success) return { ok: false, reason: "phone", error: t("mbr.err.phone") };
    phone = parsed.data;
  }

  if (!account.main.ownerId) return { ok: false, reason: "ownerUnavailable", error: t("mbr.err.ownerUnavailable") };
  const team = await loadBranchTeam([mainId, ...account.branches.map(branch => branch.id)]);
  if (!team.available) return { ok: false, reason: "teamUnavailable", error: t("mbr.err.teamUnavailable") };
  const selectedTeam = resolveBranchTeam({
    members: team.members,
    mainOwnerId: account.main.ownerId,
    actorOwnerId: impersonating ? null : profile.id,
    manager: input.manager,
    coOwner: input.coOwner,
  });
  if (!selectedTeam.ok) return { ok: false, reason: "teamInvalid", error: t(selectedTeam.errorKey) };
  if (selectedTeam.assignments.length > 0) {
    const limits = await entitlementsFor({ planTier: plan.tier, subscriptionState: sub.state === "grace" ? "grace" : "active" });
    if (limits && !limits.staffManagement) return { ok: false, reason: "staffNotInPlan", error: t("est.staffNotInPlan") };
    if (limits && selectedTeam.assignments.some(person => person.role === "manager") && limits.staffLimit < 1) {
      return { ok: false, reason: "staffLimit", error: t("est.staffLimitReached", { limit: limits.staffLimit }) };
    }
  }

  const quartierId = await resolveOrCreateQuartier(input.quartier, account.main.serviceAreaId);
  if (!quartierId) return { ok: false, reason: "quartier", error: t("mbr.err.quartier") };

  const supabase = createAdminClient();

  // Two locations of "Chez Marcel" are chez-marcel-akwa and chez-marcel-bonapriso.
  const base = slugify(`${account.main.name} ${label}`) || "restaurant";
  let slug = base;
  for (let attempt = 2; attempt <= 50; attempt++) {
    const { data: clash } = await supabase.from("restaurants").select("id").eq("slug", slug).maybeSingle();
    if (!clash) break;
    slug = `${base}-${attempt}`;
  }

  const inherited: Record<string, unknown> = {};
  for (const column of INHERITED_COLUMNS) {
    if (column in account.main.row) inherited[column] = account.main.row[column];
  }

  /*
    Born PAUSED, then the sync decides. A branch the plan covers is running
    a moment later; one that needs paying for stays paused until the top-up
    is settled — there is no instant at which an unpaid branch is live.
    `setup_done_at` stays empty: the first visit opens the setup wizard, as
    it did for the main restaurant.
  */
  const { data: created, error } = await supabase
    .from("restaurants")
    .insert({
      ...inherited,
      owner_id: account.main.ownerId,
      parent_id: mainId,
      is_primary: false,
      name: account.main.name,
      branch_label: label,
      slug,
      status: "paused",
      // Closed until the selected team is installed. Even a failed rollback
      // cannot let the coverage sweep publish this incomplete new location.
      branch_closed_at: new Date().toISOString(),
      service_area_id: account.main.serviceAreaId,
      quartier_id: quartierId,
      address_line: address,
      phone,
    })
    .select("id")
    .single();

  if (error || !created) {
    console.error("[branches:create]", mainId, error?.code ?? "", error?.message);
    return { ok: false, reason: "createFailed", error: t("mbr.err.createFailed") };
  }

  const branchId = created.id as string;

  const installedTeam = await installBranchTeam(branchId, selectedTeam.assignments, profile);
  if (!installedTeam.ok) {
    // Still unpublished, with no menu, invoices or invitations sent. Undo
    // this new row rather than report a branch whose chosen team was lost.
    const { error: rollbackError } = await supabase.from("restaurants").delete()
      .eq("id", branchId).eq("parent_id", mainId).eq("status", "paused");
    if (rollbackError) {
      console.error("[branches:rollbackTeam]", branchId, rollbackError.code);
      revalidateBranchScreens();
      return { ok: false, reason: "teamSavedPaused", error: t("mbr.err.teamSavedPaused", { label }) };
    }
    return { ok: false, reason: "teamSaveFailed", error: t("mbr.err.teamSaveFailed") };
  }

  // The menu is copied BEFORE the branch can run, so it never opens to
  // customers with an empty card. A failed copy does not undo the branch —
  // the owner can retry from the Branches page.
  let menuNote: string | null = null;
  if (input.copyMenu) {
    const copied = await copyMenu(mainId, branchId);
    menuNote = copied.ok ? t("mbr.note.menuCopied", { count: copied.dishes }) : t("mbr.note.menuNotCopied");
  }

  const { data: readyBranch, error: readyError } = await supabase.from("restaurants")
    .update({ branch_closed_at: null }).eq("id", branchId).eq("parent_id", mainId)
    .eq("status", "paused").select("id").maybeSingle();
  const activationFailed = Boolean(readyError || !readyBranch);
  if (activationFailed) console.error("[branches:ready]", branchId, readyError?.code);

  await writeAudit(profile, {
    action: activationFailed ? "restaurant.branch_created" : "restaurant.branch_opened",
    entityType: "restaurant",
    entityId: branchId,
    summary: `${account.main.name} opened the branch ${label}${input.copyMenu ? " (menu copied)" : ""}`,
    metadata: { mainId, copyMenu: Boolean(input.copyMenu), team: selectedTeam.assignments.map(person => ({ profileId: person.profileId, role: person.role })) },
  });
  await notify({
    event: "billing",
    tone: "info",
    admins: true,
    href: "/a/restaurants",
    params: { restaurantName: account.main.name, detail: `${account.main.name} opened a branch: ${label}.` },
  });

  const outcome = activationFailed ? { kind: "held" as const } : await settleCoverage(mainId);
  revalidateBranchScreens();

  const invitationsSent = await announceBranchTeam({
    branchId, label, restaurantName: account.main.name, actor: profile,
    assignments: selectedTeam.assignments, invitations: installedTeam.invitations,
  });
  const teamNote = !invitationsSent
    ? t("mbr.note.inviteMailFailed")
    : installedTeam.invitations.length > 0 ? t("mbr.note.teamInvited") : null;

  const withMenu = (note: string) => [note, menuNote, teamNote].filter(Boolean).join(" ");
  if (outcome.kind === "held") return { ok: true, branchId, note: withMenu(t("mbr.note.createdClosed", { label })) };
  if (outcome.kind === "invoice") {
    return {
      ok: true,
      branchId,
      invoiceId: outcome.invoiceId,
      amount: outcome.amount,
      note: withMenu(t("mbr.note.payToOpen")),
    };
  }
  if (outcome.kind === "renewal") return { ok: true, branchId, note: withMenu(t("mbr.note.onRenewal")) };
  return { ok: true, branchId, note: withMenu(t("mbr.note.opened", { label })) };
}

/* ── Copy the menu later ───────────────────────────────────────────────── */

/**
 * The main's menu into a branch whose menu is still empty — for a branch
 * opened without it, or before 0073 existed.
 */
export async function copyMenuToBranch(branchId: string): Promise<BranchActionResult> {
  const t = await getTranslator();
  const owner = await ownerScope();
  if (!owner.ok) return owner;

  const branch = owner.scope.account.branches.find((b) => b.id === branchId);
  if (!branch) return { ok: false, reason: "notFound", error: t("mbr.err.notFound") };

  const copied = await copyMenu(owner.scope.mainId, branchId);
  if (!copied.ok) {
    return {
      ok: false,
      reason: copied.reason,
      error:
        copied.reason === "notEmpty"
          ? t("mbr.err.menuNotEmpty")
          : copied.reason === "migration"
            ? t("mbr.err.menuMigration")
            : t("mbr.err.menuCopyFailed"),
    };
  }

  await writeAudit(owner.scope.profile, {
    action: "restaurant.branch_menu_copied",
    entityType: "restaurant",
    entityId: branchId,
    summary: `Copied ${copied.dishes} dish(es) from the main menu into ${branch.label}`,
  });

  revalidatePath("/m/branches");
  revalidatePath("/m/menu");
  revalidatePath(`/restaurants/${branch.slug}`);
  return { ok: true, note: t("mbr.note.menuCopied", { count: copied.dishes }) };
}

/* ── Close and reopen ──────────────────────────────────────────────────── */

async function branchOf(scope: OwnerScope, branchId: string) {
  return scope.account.branches.find((branch) => branch.id === branchId) ?? null;
}

/**
 * Close a branch: paused, unlisted, no longer billed from the next invoice.
 * Its menu, team, history and wallet are kept for the day it reopens. What
 * was already paid for this period is not refunded.
 */
export async function closeBranch(branchId: string): Promise<BranchActionResult> {
  const t = await getTranslator();
  const owner = await ownerScope();
  if (!owner.ok) return owner;

  const branch = await branchOf(owner.scope, branchId);
  if (!branch) return { ok: false, reason: "notFound", error: t("mbr.err.notFound") };
  if (branch.closedAt) return { ok: true };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("restaurants")
    .update({ branch_closed_at: new Date().toISOString() })
    .eq("id", branchId)
    .eq("parent_id", owner.scope.mainId);

  if (error) {
    console.error("[branches:close]", branchId, error.message);
    return { ok: false, reason: "saveFailed", error: t("mbr.err.saveFailed") };
  }

  await writeAudit(owner.scope.profile, {
    action: "restaurant.branch_closed",
    entityType: "restaurant",
    entityId: branchId,
    summary: `Closed the branch ${branch.label}`,
  });

  await syncBranchCoverage(owner.scope.mainId);
  await refreshBranchInvoices(owner.scope.mainId);
  revalidateBranchScreens();
  return { ok: true, note: t("mbr.note.closed", { label: branch.label }) };
}

export async function reopenBranch(branchId: string): Promise<BranchActionResult> {
  const t = await getTranslator();
  const owner = await ownerScope();
  if (!owner.ok) return owner;
  const { account, mainId } = owner.scope;

  const branch = await branchOf(owner.scope, branchId);
  if (!branch) return { ok: false, reason: "notFound", error: t("mbr.err.notFound") };
  if (!branch.closedAt) return { ok: true };

  const plan = account.plan;
  if (!plan || !planAllowsBranches(plan)) {
    return { ok: false, reason: "planNoBranches", error: t("mbr.err.planNoBranches") };
  }
  if (plan.extraBranchPrice === null && accountOpenBranchCount(account) + 1 > includedBranchSlots(plan)) {
    return {
      ok: false,
      reason: "planBranchLimit",
      error: t("mbr.err.planBranchLimit", { count: plan.includedBranches }),
    };
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("restaurants")
    .update({ branch_closed_at: null })
    .eq("id", branchId)
    .eq("parent_id", mainId);

  if (error) {
    console.error("[branches:reopen]", branchId, error.message);
    return { ok: false, reason: "saveFailed", error: t("mbr.err.saveFailed") };
  }

  await writeAudit(owner.scope.profile, {
    action: "restaurant.branch_reopened",
    entityType: "restaurant",
    entityId: branchId,
    summary: `Reopened the branch ${branch.label}`,
  });

  const outcome = await settleCoverage(mainId);
  revalidateBranchScreens();

  if (outcome.kind === "invoice") {
    return { ok: true, branchId, invoiceId: outcome.invoiceId, amount: outcome.amount, note: t("mbr.note.payToOpen") };
  }
  if (outcome.kind === "renewal") return { ok: true, branchId, note: t("mbr.note.onRenewal") };
  return { ok: true, branchId, note: t("mbr.note.reopened", { label: branch.label }) };
}

/* ── Pay for paused branches ───────────────────────────────────────────── */

/**
 * The invoice that opens every paused, open branch — raised if needed.
 * The caller sends the owner to /m/billing/pay/<id> (on the main).
 */
export async function payForBranches(): Promise<BranchActionResult> {
  const t = await getTranslator();
  const owner = await ownerScope();
  if (!owner.ok) return owner;

  const outcome = await ensureBranchTopUp(owner.scope.mainId);
  revalidateBranchScreens();

  switch (outcome.kind) {
    case "invoice":
      return { ok: true, invoiceId: outcome.invoiceId, amount: outcome.amount };
    case "granted":
    case "covered":
      return { ok: true, note: t("mbr.note.allCovered") };
    case "renewal":
      return { ok: true, note: t("mbr.note.onRenewal") };
    default:
      return { ok: false, reason: "unavailable", error: t("mbr.err.planNoBranches") };
  }
}

/* ── Push the main's menu to a branch (0074) ───────────────────────────── */

/**
 * Bring a branch's menu up to the main's — a MERGE (sync_branch_menu):
 * dishes both have take the main's price, description and photo; dishes
 * only the main has are added with their options; the branch's own dishes,
 * its availability and its stock are left alone. New dishes never take the
 * menu past the plan's dish ceiling.
 */
export async function syncBranchMenu(branchId: string): Promise<BranchActionResult & { updated?: number; added?: number }> {
  const t = await getTranslator();
  const owner = await ownerScope();
  if (!owner.ok) return owner;
  const { mainId, account } = owner.scope;

  const branch = account.branches.find((b) => b.id === branchId);
  if (!branch) return { ok: false, reason: "notFound", error: t("mbr.err.notFound") };

  const supabase = createAdminClient();

  // The plan the branch runs on is the main's (0072).
  let maxNew: number | null = null;
  if (account.plan && account.subscription) {
    const plan = await entitlementsFor({
      planTier: account.plan.tier,
      subscriptionState: account.subscription.state === "cancelled" ? "locked" : (account.subscription.state as "active" | "grace" | "locked"),
    });
    if (plan && plan.menuItemLimit !== null) {
      const { count } = await supabase
        .from("menu_items")
        .select("id", { count: "exact", head: true })
        .eq("restaurant_id", branchId);
      maxNew = Math.max(0, plan.menuItemLimit - (count ?? 0));
    }
  }

  const { data, error } = await supabase.rpc("sync_branch_menu", {
    p_source: mainId,
    p_target: branchId,
    p_max_new: maxNew,
  });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") {
      return { ok: false, reason: "migration", error: t("mbr.err.syncMigration") };
    }
    console.error("[branches:syncMenu]", branchId, error.code ?? "", error.message);
    return { ok: false, reason: "failed", error: t("mbr.err.syncFailed") };
  }

  const counts = (data ?? {}) as { updated?: number; added?: number };
  const updated = Number(counts.updated ?? 0);
  const added = Number(counts.added ?? 0);

  await writeAudit(owner.scope.profile, {
    action: "restaurant.branch_menu_synced",
    entityType: "restaurant",
    entityId: branchId,
    summary: `Updated ${branch.label}'s menu from the main: ${updated} dish(es) updated, ${added} added`,
  });

  revalidatePath("/m/branches");
  revalidatePath("/m/menu");
  revalidatePath(`/restaurants/${branch.slug}`);
  return { ok: true, updated, added, note: t("mbr.note.synced", { updated, added }) };
}
