"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PackageCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { confirmOwnDelivery } from "@/lib/data/customer-actions";
import { useLocale } from "@/lib/i18n/use-locale";

/**
 * "I have my food" straight from the home card, for an order that is on its
 * way or ready to collect — the same action as the order page's button, so
 * closing an order never needs a detour. The server re-checks everything.
 */
export function ConfirmReceivedButton({ orderId, pickup }: { orderId: string; pickup: boolean }) {
  const { t } = useLocale();
  const { toast } = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    const result = await confirmOwnDelivery(orderId);
    setBusy(false);
    toast(result.ok ? t("cor.receivedDone") : result.error, result.ok ? "success" : "error");
    if (result.ok) router.refresh();
  }

  return (
    <Button size="lg" fullWidth loading={busy} disabled={busy} onClick={confirm}>
      <PackageCheck className="size-5" aria-hidden />
      {t(pickup ? "cor.pickupReceiptAction" : "cor.receivedAction")}
    </Button>
  );
}
