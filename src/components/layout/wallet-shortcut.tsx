"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Wallet } from "lucide-react";
import { useLocale } from "@/lib/i18n/use-locale";
import type { BranchWalletSummary } from "@/lib/wallet/summary";
import { cn } from "@/lib/utils";

/** Prominent navigation to the wallet, never a shortcut that sends money. */
export function WalletShortcut({ summary, variant, disabled = false }: {
  summary: BranchWalletSummary;
  variant: "sidebar" | "mobile";
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const active = usePathname() === "/m/wallet";
  const amount = summary.available === null ? "—" : `${summary.available.toLocaleString("fr-CM")} FCFA`;
  const label = t(summary.available === null ? "mwd.nav.unavailable" : "mwd.nav.available");
  const ariaLabel = `${t("nav.m.wallet")} · ${label} · ${amount}`;
  const content = variant === "sidebar" ? <>
    <span className="flex items-center gap-2 text-sm font-semibold text-primary">
      <Wallet className="size-4.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{t("nav.m.wallet")}</span>
      <ChevronRight className="size-4 shrink-0" aria-hidden />
    </span>
    <span className="tnum mt-2 block text-2xl leading-tight font-bold tracking-tight text-text">{amount}</span>
    <span className="mt-1 block text-xs text-text-secondary">{label}</span>
    {summary.held !== null && summary.held > 0 && <span className="mt-2 block text-[11px] text-text-light">
      {t("mwd.nav.held", { amount: `${summary.held.toLocaleString("fr-CM")} FCFA` })}
    </span>}
  </> : <>
    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-fg">
      <Wallet className="size-4.5" aria-hidden />
    </span>
    <span className="min-w-0 flex-1">
      <span className="flex flex-wrap items-baseline gap-x-2 text-xs">
        <span className="font-semibold text-primary">{t("nav.m.wallet")}</span>
        <span className="text-text-secondary">{label}</span>
      </span>
      <span className="tnum mt-0.5 block text-lg leading-tight font-bold text-text">{amount}</span>
    </span>
    <ChevronRight className="size-4 shrink-0 text-primary" aria-hidden />
  </>;
  const className = cn(
    "rounded-lg border border-primary/30 bg-primary-light/50 transition-colors",
    variant === "sidebar" ? "block p-3.5" : "flex min-h-14 items-center gap-3 px-3 py-2",
    active && "border-primary bg-primary-light",
    disabled ? "opacity-60" : "hover:border-primary hover:bg-primary-light focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:outline-none",
  );
  return disabled
    ? <div aria-label={ariaLabel} aria-disabled title={t("nav.lockedHint")} className={className}>{content}</div>
    : <Link href="/m/wallet" prefetch={false} aria-label={ariaLabel} aria-current={active ? "page" : undefined} className={className}>{content}</Link>;
}
