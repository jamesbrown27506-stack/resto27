import Link from "next/link";
import { Gift, TrendingDown, TrendingUp } from "lucide-react";
import { AccountShell } from "@/components/layout/account-shell";
import { Card, CardBody, Panel } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatTile } from "@/components/ui/stat-tile";
import { requireUser } from "@/lib/auth/session";
import { getLoyaltyState } from "@/lib/data/cart-actions";
import { fetchLoyaltyLedger } from "@/lib/data/customer";
import { formatMoney } from "@/lib/format/currency";
import { formatDate, isoAttr } from "@/lib/format/datetime";
import { getLocale, getTranslator } from "@/lib/i18n/locale-server";
import { intlLocale } from "@/lib/i18n/use-locale";
import { cn } from "@/lib/utils";

/**
 * Loyalty is an APPEND-ONLY LEDGER (§3).
 *
 * The balance shown here is SUM(points) over the visible rows — never a stored
 * counter. That is deliberate and it is also why the full ledger is rendered
 * rather than a summary: every entry is traceable to the order that produced
 * it (§14.3), so a customer can always reconcile their own balance.
 */
export default async function LoyaltyPage() {
  const user = await requireUser();
  const [t, locale] = await Promise.all([getTranslator(), getLocale()]);
  const numbers = intlLocale(locale);

  const [entries, loyalty] = await Promise.all([
    fetchLoyaltyLedger(user.id),
    getLoyaltyState(),
  ]);

  const balance = loyalty.balance;
  const pointValue = loyalty.pointValue;
  const earned = entries.filter((e) => e.points > 0).reduce((s, e) => s + e.points, 0);
  const spent = entries.filter((e) => e.points < 0).reduce((s, e) => s + Math.abs(e.points), 0);

  return (
    <AccountShell
      user={user}
      title={t("cly.title")}
      description={t("cly.subtitle")}
    >
      <Card className="bg-primary text-primary-fg">
        <CardBody className="sm:p-8">
          <Gift className="size-6 opacity-80" aria-hidden />
          <p className="tnum mt-4 font-display text-5xl leading-none font-bold">
            {balance.toLocaleString(numbers)}
          </p>
          <p className="mt-2 opacity-75">
            {t("cly.available", { amount: formatMoney(balance * pointValue) })}
          </p>
          <Link
            href="/browse"
            className="mt-5 inline-block rounded-full bg-primary-fg px-6 py-2.5 text-sm font-semibold text-primary transition-opacity hover:opacity-90"
          >
            {t("cly.orderNow")}
          </Link>
        </CardBody>
      </Card>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <StatTile
          label={t("cly.earned")}
          value={earned.toLocaleString(numbers)}
          icon={<TrendingUp />}
          hint={t("cly.earnedHint")}
        />
        <StatTile
          label={t("cly.spent")}
          value={spent.toLocaleString(numbers)}
          icon={<TrendingDown />}
          hint={t("cly.spentHint", { amount: formatMoney(spent * pointValue) })}
        />
      </div>

      <Panel
        className="mt-6"
        title={t("cly.history")}
        description={t("cly.historyBody")}
      >
        {entries.length === 0 ? (
          <EmptyState
            icon={<Gift />}
            title={t("cly.empty")}
            description={t("cly.emptyBody")}
          />
        ) : (
          <ul className="divide-y divide-border">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <p className="font-medium">{entry.note}</p>
                  <p className="mt-0.5 text-xs text-text-light">
                    <time dateTime={isoAttr(entry.createdAt)}>{formatDate(entry.createdAt, numbers)}</time>
                    {entry.orderReference && (
                      <>
                        {" · "}
                        <Link
                          href={`/orders/${entry.orderId}`}
                          className="tnum font-medium text-primary hover:underline"
                        >
                          {entry.orderReference}
                        </Link>
                      </>
                    )}
                  </p>
                </div>

                <span
                  className={cn(
                    "tnum shrink-0 font-display text-lg font-bold",
                    entry.points > 0 ? "text-success" : "text-text-secondary",
                  )}
                >
                  {entry.points > 0 ? "+" : "−"}
                  {Math.abs(entry.points).toLocaleString(numbers)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </AccountShell>
  );
}
