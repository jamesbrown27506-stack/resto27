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
import { useLocale } from "@/lib/i18n/use-locale";
import type { CustomerOrder } from "@/lib/data/customer";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import type { SessionUser } from "@/lib/session";

/** Values only — the words come from the dictionary at render time. */
const FILTERS = ["all", "active", "delivered", "cancelled"] as const;

export function OrdersClient({
  user,
  orders: all,
}: {
  user: SessionUser;
  orders: CustomerOrder[];
}) {
  const { t } = useLocale();
  const [filter, setFilter] = useState<string>("all");

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
    <AccountShell user={user} title={t("cor.title")} description={t("cor.subtitle")}>
      <FilterChips
        items={FILTERS.map((value) => ({
          value,
          label: t(`cor.filter.${value}` as TranslationKey),
          count: counts[value],
        }))}
        value={filter}
        onChange={setFilter}
      />

      <div className="mt-6">
        {orders.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface">
            <EmptyState
              icon={<ReceiptText />}
              title={t("cor.empty")}
              description={
                filter === "all" ? t("cor.emptyAll") : t("cor.emptyFilter")
              }
              action={
                filter === "all" ? (
                  <Link href="/browse" className={buttonClasses()}>
                    {t("cor.order")}
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
