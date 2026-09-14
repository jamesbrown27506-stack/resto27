import Link from "next/link";
import { Banknote, Clock, Store, UserCog, Users } from "lucide-react";
import { AdminPage } from "@/components/layout/admin-shell";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatTile } from "@/components/ui/stat-tile";
import { formatDate, formatDateTime } from "@/lib/format/datetime";
import { getAdminOverview } from "@/lib/data/admin";
import { getWithdrawalFeeSummary } from "@/lib/data/platform";
import { requireRole } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * Platform overview.
 *
 * Only shows what the database can actually answer today. The revenue,
 * commission and moderation tiles the fixture version displayed are gone
 * rather than faked — a dashboard that invents numbers is worse than one that
 * admits a gap, because you cannot tell which figures to trust. They return
 * with migrations 0005 (platform ops) and 0006 (orders).
 */
export default async function AdminDashboard() {
  const [admin, overview, fees] = await Promise.all([
    requireRole("admin"),
    getAdminOverview(),
    getWithdrawalFeeSummary(),
  ]);

  const firstName = admin.name.split(" ")[0];

  return (
    <AdminPage
      title={`Welcome back, ${firstName}`}
      description="Platform overview."
      action={
        <Link href="/a/restaurants" className={buttonClasses({ variant: "outline" })}>
          Manage restaurants
        </Link>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Active restaurants"
          value={overview.restaurantsActive}
          icon={<Store />}
          hint={
            overview.restaurantsSuspended > 0
              ? `${overview.restaurantsSuspended} suspended`
              : "None suspended"
          }
          tone="dark"
        />
        <StatTile
          label="Awaiting approval"
          value={overview.restaurantsPending}
          icon={<Clock />}
          hint={overview.restaurantsPending > 0 ? "Action required" : "Nothing to review"}
          positiveIsGood={false}
        />
        <StatTile
          label="Users"
          value={overview.usersTotal}
          icon={<Users />}
          hint={`${overview.usersCustomers} customers · ${overview.usersManagers} owners`}
        />
        <StatTile
          label="Fee revenue"
          value={`${fees.totalFees.toLocaleString("fr-CM")} FCFA`}
          icon={<Banknote />}
          hint={`${fees.count} payout${fees.count === 1 ? "" : "s"} · ${fees.thisMonthFees.toLocaleString("fr-CM")} this month`}
          tone="primary"
        />
      </div>

      <div className="mt-6">
        <Panel
          title="Pending applications"
          description="New restaurants waiting to be reviewed."
          action={
            <Link
              href="/a/restaurants"
              className="text-sm font-semibold text-primary hover:underline"
            >
              View all
            </Link>
          }
        >
          {overview.pendingRestaurants.length === 0 ? (
            <EmptyState
              icon={<Store />}
              title="Nothing pending"
              description="Every application has been reviewed."
            />
          ) : (
            <ul className="divide-y divide-border">
              {overview.pendingRestaurants.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{r.name}</p>
                    <p className="mt-0.5 text-sm text-text-secondary">
                      {[r.quartier, r.cuisine].filter(Boolean).join(" · ") || "—"}
                    </p>
                    <p className="tnum mt-0.5 text-xs text-text-light">
                      Applied {formatDate(r.createdAt)}
                    </p>
                  </div>
                  <Badge tone="warning">Pending</Badge>
                  <Link
                    href="/a/restaurants"
                    className={buttonClasses({ variant: "outline", size: "sm" })}
                  >
                    Review
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/*
        The tax is the platform's revenue (migration 0022) — this
        is where it becomes visible instead of theory. Zero here means either
        the fee is off or no payout has carried one yet; the tile above sums
        the same rows.
      */}
      <div className="mt-6">
        <Panel
          title="Recent taxs"
          description="One row per payout that withheld a fee — gross owed, fee kept, net sent."
        >
          {fees.recent.length === 0 ? (
            <EmptyState
              icon={<Banknote />}
              title="No fees collected yet"
              description="Payouts are free until the tax is switched on in Settings → Payments, or until a payout carries one."
            />
          ) : (
            <ul className="divide-y divide-border">
              {fees.recent.map((f) => (
                <li
                  key={f.id}
                  className="flex flex-wrap items-center gap-x-6 gap-y-1 px-5 py-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="tnum text-sm font-semibold">
                      {f.gross.toLocaleString("fr-CM")} FCFA
                      <span className="ml-2 font-normal text-text-light">→ {f.phone}</span>
                    </p>
                    <p className="tnum mt-0.5 text-xs text-text-light">
                      {formatDateTime(f.createdAt)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="tnum text-sm font-semibold text-primary">
                      +{f.fee.toLocaleString("fr-CM")} FCFA
                    </p>
                    <p className="tnum text-xs text-text-light">net {f.net.toLocaleString("fr-CM")} FCFA</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </AdminPage>
  );
}
