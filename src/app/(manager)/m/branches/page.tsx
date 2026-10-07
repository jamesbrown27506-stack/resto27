import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ManagerPage } from "@/components/layout/manager-shell";
import { BranchesView } from "./branches-view";
import { requireBranch } from "@/lib/auth/branch";
import { can } from "@/lib/capabilities";
import { isFreeMode } from "@/lib/data/billing";
import {
  accountCoveredCount,
  accountOpenBranchCount,
  fetchUnpaidBranchTopUp,
  loadBranchAccount,
} from "@/lib/branches/account";
import { nextBranchCost, openBranches } from "@/lib/branches/coverage";
import { summarizeLedger, type LedgerEntry } from "@/lib/wallet/breakdown";
import { doualaDay } from "@/lib/wallet/schedule-rules";
import { createAdminClient } from "@/lib/supabase/server";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/locale-server";
import { loadBranchLeaders, loadBranchTeam } from "@/lib/branches/team";

// Opening, closing or paying for a branch changes this page under the owner;
// a cached copy would offer to pay for one already running.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: DICTIONARIES[locale]["mbr.title"] };
}

/**
 * Branches (0072).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  OWNER OF THE MAIN RESTAURANT ONLY, from wherever they stand.
 *
 *  `requireCapability` checks the ACTIVE branch, but a branch is opened on
 *  the main's invoice, so the check is `billing.manage` AT THE MAIN — an
 *  owner switched to Bonapriso still manages every location, and a manager
 *  at Bonapriso does not. Same 404 as requireCapability for everyone else.
 *  The actions re-check it themselves (lib/data/branch-actions.ts).
 * ─────────────────────────────────────────────────────────────────────────
 */
export default async function BranchesPage() {
  const context = await requireBranch();
  const mainId = context.active.parentId ?? context.active.restaurantId;
  const atMain = context.impersonating
    ? context.active
    : context.branches.find((branch) => branch.restaurantId === mainId);

  if (!atMain || !can(atMain.role, "billing.manage")) redirect("/not-found");

  const [account, freeMode, topUp] = await Promise.all([
    loadBranchAccount(mainId),
    isFreeMode(),
    fetchUnpaidBranchTopUp(mainId),
  ]);
  if (!account) redirect("/not-found");
  const now = new Date();

  // How many dishes each location has: an empty branch menu is offered the
  // main's (0073). Head counts — a handful of branches, never the rows.
  const supabase = createAdminClient();
  const locationIds = [account.main.id, ...account.branches.map((branch) => branch.id)];
  const [team, leaders] = await Promise.all([loadBranchTeam(locationIds), loadBranchLeaders(locationIds)]);

  /*
    THE GROUP AT A GLANCE (owners of several locations): balance, today's and
    the week's orders, and the week's income — read off each wallet's ledger
    like the wallet page, so the two never disagree.
  */
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const today = doualaDay(now).ymd;
  const startOfToday = new Date(`${today}T00:00:00+01:00`).toISOString();
  const overview = await Promise.all(
    locationIds.map(async (id) => {
      const [wallet, ordersToday, orders7d, ledger] = await Promise.all([
        supabase.from("restaurant_wallets").select("balance").eq("restaurant_id", id).maybeSingle(),
        supabase.from("orders").select("id", { count: "exact", head: true }).eq("restaurant_id", id).gte("created_at", startOfToday).neq("status", "cancelled"),
        supabase.from("orders").select("id", { count: "exact", head: true }).eq("restaurant_id", id).gte("created_at", weekAgo).neq("status", "cancelled"),
        supabase.from("wallet_ledger").select("amount, kind, note, reference").eq("restaurant_id", id).gte("created_at", weekAgo).limit(5000),
      ]);
      const week = summarizeLedger((ledger.data ?? []) as LedgerEntry[]);
      return {
        id,
        balance: Number((wallet.data as { balance?: number } | null)?.balance ?? 0),
        ordersToday: ordersToday.count ?? 0,
        orders7d: orders7d.count ?? 0,
        // Money earned, before refunds and withdrawals.
        income7d: week.orders + week.tables + week.reservations,
      };
    }),
  );
  const dishCounts = new Map(
    await Promise.all(
      [account.main.id, ...account.branches.map((branch) => branch.id)].map(async (id) => {
        const { count } = await supabase
          .from("menu_items")
          .select("id", { count: "exact", head: true })
          .eq("restaurant_id", id);
        return [id, count ?? 0] as const;
      }),
    ),
  );

  const plan = account.plan;
  const sub = account.subscription;
  const open = accountOpenBranchCount(account);
  const covered = accountCoveredCount(account);
  const members = new Set(context.branches.map((branch) => branch.restaurantId));

  // Branches the plan allows but that wait on a payment: open, not closed,
  // beyond what is covered. The oldest run, so these are the newest ones.
  const waiting = Math.max(0, openBranches(account.branches).length - covered);

  return (
    <ManagerPage titleKey="mbr.title" descriptionKey="mbr.subtitle">
      <BranchesView
        migrated={account.migrated}
        activeId={context.active.restaurantId}
        main={{
          id: account.main.id,
          name: account.main.name,
          label: account.main.label,
          dishes: dishCounts.get(account.main.id) ?? 0,
          owner: { id: account.main.ownerId, name: team.members.find(member => member.profileId === account.main.ownerId)?.name ?? DICTIONARIES[await getLocale()]["mbr.add.mainOwner"] },
        }}
        team={team}
        leaders={leaders}
        actorProfileId={context.impersonating ? null : context.profile.id}
        plan={
          plan
            ? {
                name: plan.name,
                tier: plan.tier,
                includedBranches: plan.includedBranches,
                extraBranchPrice: plan.extraBranchPrice,
              }
            : null
        }
        subscriptionLive={sub ? sub.state === "active" || sub.state === "grace" : false}
        paidExtra={sub?.extraBranches ?? 0}
        open={open}
        covered={covered}
        waiting={waiting}
        topUp={topUp}
        freeMode={freeMode}
        overview={overview}
        nextCost={
          plan && sub
            ? nextBranchCost({
                plan,
                openBranches: open,
                paidExtraBranches: sub.extraBranches,
                periodEnd: sub.endDate,
                now,
                freeMode,
              })
            : { kind: "unavailable" }
        }
        branches={account.branches.map((branch) => ({
          id: branch.id,
          label: branch.label,
          addressLine: branch.addressLine,
          status: branch.status,
          closed: Boolean(branch.closedAt),
          dishes: dishCounts.get(branch.id) ?? 0,
          // Only a branch this person is on the roster of can be switched to.
          canOpen: members.has(branch.id) && (branch.status === "active" || branch.status === "paused"),
        }))}
      />
    </ManagerPage>
  );
}
