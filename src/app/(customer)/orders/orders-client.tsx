"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ReceiptText } from "lucide-react";
import { AccountShell } from "@/components/layout/account-shell";
import { OrderCard } from "@/components/order/order-parts";
import { FilterChips } from "@/components/data/filter-bar";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { isTerminal } from "@/lib/format/order-status";
import type { CustomerOrder } from "@/lib/data/customer";
import type { SessionUser } from "@/lib/session";

const FILTERS = [
  { value: "all", label: "Toutes" },
  { value: "active", label: "En cours" },
  { value: "delivered", label: "Livrées" },
  { value: "cancelled", label: "Annulées" },
];

export function OrdersClient({
  user,
  orders: all,
}: {
  user: SessionUser;
  orders: CustomerOrder[];
}) {
  const [filter, setFilter] = useState("all");

  const counts = useMemo(
    () => ({
      all: all.length,
      active: all.filter((o) => !isTerminal(o.status)).length,
      delivered: all.filter((o) => o.status === "delivered").length,
      cancelled: all.filter((o) => o.status === "cancelled").length,
    }),
    [all],
  );

  const orders = all.filter((o) => {
    if (filter === "active") return !isTerminal(o.status);
    if (filter === "delivered") return o.status === "delivered";
    if (filter === "cancelled") return o.status === "cancelled";
    return true;
  });

  return (
    <AccountShell user={user} title="Mes commandes" description="Historique et suivi en direct.">
      <FilterChips
        items={FILTERS.map((f) => ({ ...f, count: counts[f.value as keyof typeof counts] }))}
        value={filter}
        onChange={setFilter}
      />

      <div className="mt-6">
        {orders.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface">
            <EmptyState
              icon={<ReceiptText />}
              title="Aucune commande ici"
              description={
                filter === "all"
                  ? "Vos commandes apparaîtront dans cette liste."
                  : "Aucune commande ne correspond à ce filtre."
              }
              action={
                filter === "all" ? (
                  <Link href="/browse" className={buttonClasses()}>
                    Commander
                  </Link>
                ) : undefined
              }
            />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {orders.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </div>
        )}
      </div>
    </AccountShell>
  );
}
