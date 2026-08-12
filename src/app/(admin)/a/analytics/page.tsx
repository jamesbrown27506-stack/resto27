import Link from "next/link";
import { ChartColumn, Database, Store, Users } from "lucide-react";
import { AdminPage } from "@/components/layout/admin-shell";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, Panel } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatTile } from "@/components/ui/stat-tile";
import { getAdminOverview } from "@/lib/data/admin";

export const dynamic = "force-dynamic";

/**
 * Platform analytics.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  EVERY CHART HERE USED TO BE INVENTED.
 *
 *  Revenue curves, order volume, peak hours, top tenants by sales — all of it
 *  came from a fixture file, and all of it looked completely real. That is the
 *  worst possible state for an analytics page: a number you cannot trust is
 *  more expensive than a number you do not have, because you will act on it.
 *
 *  So the fabricated charts are gone rather than left in place. What remains
 *  is what the database can actually answer today: tenant and user counts.
 *
 *  Everything else needs orders, which arrive in migration 0006. When it does,
 *  the charts come back reading `orders` and `order_items` — and §7 applies:
 *  only DELIVERED, non-refunded orders count, and delivery fees are excluded,
 *  because that money is the restaurant's cost and not their revenue.
 * ─────────────────────────────────────────────────────────────────────────
 */
export default async function AdminAnalyticsPage() {
  const overview = await getAdminOverview();

  const tenantsTotal =
    overview.restaurantsActive + overview.restaurantsPending + overview.restaurantsSuspended;

  return (
    <AdminPage
      title="Analytics"
      description="Growth and platform composition."
      action={
        <Link href="/a/restaurants" className={buttonClasses({ variant: "outline" })}>
          Manage restaurants
        </Link>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Restaurants" value={tenantsTotal} icon={<Store />} tone="dark" />
        <StatTile
          label="Active"
          value={overview.restaurantsActive}
          hint={`${overview.restaurantsPending} pending · ${overview.restaurantsSuspended} suspended`}
        />
        <StatTile label="Users" value={overview.usersTotal} icon={<Users />} />
        <StatTile
          label="Restaurant owners"
          value={overview.usersManagers}
          hint={`${overview.usersCustomers} customers`}
          tone="primary"
        />
      </div>

      <Panel
        className="mt-6"
        title="Revenue, volume and top tenants"
        description="Waiting on order data."
      >
        <EmptyState
          icon={<ChartColumn />}
          title="No order data yet"
          description="Revenue over time, order volume, peak hours and top tenants all read from the orders table, which does not exist yet. These charts return with migration 0006 — computed from delivered, non-refunded orders only, excluding delivery fees."
        />
      </Panel>

      <Card className="mt-6 border-info/25 bg-info-light">
        <CardBody className="flex items-start gap-3">
          <Database className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
          <p className="text-sm leading-relaxed text-info">
            <strong className="font-semibold">Why this page is nearly empty.</strong> Every chart it
            previously showed was generated sample data. Numbers you cannot trust are worse than
            numbers you do not have, so they were removed rather than left in place looking real.
          </p>
        </CardBody>
      </Card>
    </AdminPage>
  );
}
