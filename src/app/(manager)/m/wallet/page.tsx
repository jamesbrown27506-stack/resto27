import type { Metadata } from "next";
import { ManagerPage } from "@/components/layout/manager-shell";
import { WalletClient } from "./wallet-client";
import { requireCapability } from "@/lib/auth/branch";
import { getWalletState } from "@/lib/data/wallet";
import { getWithdrawalFeeConfig } from "@/lib/data/settings";
import { paymentMode } from "@/lib/data/billing";
import { mainRestaurantId } from "@/lib/branches/account";
import {
  listPayoutAccounts,
  listWithdrawDelegates,
  pinStatus,
  resolveWithdrawRight,
  withdrawControlsReady,
  withdrawnInLast24h,
} from "@/lib/wallet/controls";
import { dailyAllowance } from "@/lib/wallet/withdraw-rules";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/locale-server";

// A balance and a list of who withdrew what: never served from a cache.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: DICTIONARIES[locale]["nav.m.wallet"] };
}

/**
 * The wallet.
 *
 * `finance.manage` (owner, manager) SEES it. Who may take money out is a
 * narrower question answered per person (lib/wallet/withdraw-rules.ts, 0073):
 * the page shows each viewer their own standing — and the owner, who decides,
 * the controls: saved numbers and which managers may withdraw.
 */
export default async function WalletPage() {
  const context = await requireCapability("finance.manage");
  const { active, profile } = context;

  const [state, fee, ready, mode, mainId] = await Promise.all([
    getWalletState(active.restaurantId),
    getWithdrawalFeeConfig(),
    withdrawControlsReady(),
    paymentMode(),
    mainRestaurantId(active.restaurantId),
  ]);

  const isOwnerHere = active.role === "owner" && !context.impersonating;
  // Saved numbers are the whole restaurant's: the MAIN's owner manages them.
  const ownsAccount =
    !context.impersonating &&
    context.branches.some((branch) => branch.restaurantId === mainId && branch.role === "owner");

  const [right, pin, accounts, delegates] = ready
    ? await Promise.all([
        resolveWithdrawRight(context),
        pinStatus(profile.id),
        listPayoutAccounts(active.restaurantId),
        isOwnerHere ? listWithdrawDelegates(active.restaurantId) : Promise.resolve([]),
      ])
    : [null, { hasPin: false, lockedUntil: null }, [], []];

  const left =
    right?.allowed && right.kind === "delegate" && right.dailyLimit !== null
      ? dailyAllowance(right.dailyLimit, await withdrawnInLast24h(active.restaurantId, profile.id))
      : null;

  return (
    <ManagerPage
      titleKey="m.wallet.title"
      description={`${state.balance.toLocaleString("fr-CM")} FCFA disponible`}
    >
      <WalletClient
        state={state}
        fee={fee}
        controls={{
          ready,
          sandbox: mode === "sandbox",
          right: right
            ? right.allowed
              ? right.kind === "owner"
                ? { kind: "owner" }
                : { kind: "delegate", dailyLimit: right.dailyLimit, left }
              : { kind: "none", reason: right.reason }
            : { kind: "none", reason: "notGranted" },
          pin,
          ownsAccount,
          isOwnerHere,
          // Delegates see which number, not the whole of it.
          accounts: accounts.map((account) => ({
            id: account.id,
            display: ownsAccount ? account.phone : account.maskedPhone,
            holderName: account.holderName,
            label: account.label,
          })),
          delegates,
        }}
      />
    </ManagerPage>
  );
}
