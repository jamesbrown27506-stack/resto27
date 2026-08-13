import type { Metadata } from "next";
import { ManagerPage } from "@/components/layout/manager-shell";
import { WalletClient } from "./wallet-client";
import { requireCapability } from "@/lib/auth/branch";
import { getWalletState } from "@/lib/data/wallet";
import { getWithdrawalFeeConfig } from "@/lib/data/settings";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/locale-server";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: DICTIONARIES[locale]["nav.m.wallet"] };
}

export default async function WalletPage() {
  const { active } = await requireCapability("finance.manage");

  const [state, fee] = await Promise.all([
    getWalletState(active.restaurantId),
    getWithdrawalFeeConfig(),
  ]);

  return (
    <ManagerPage
      titleKey="m.wallet.title"
      description={`${state.balance.toLocaleString("fr-CM")} FCFA disponible`}
    >
      <WalletClient state={state} fee={fee} />
    </ManagerPage>
  );
}
