"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/lib/i18n/use-locale";
import { isVoucherCode, normaliseVoucherCode } from "@/lib/reservations/voucher";

/**
 * "Vérifier un bon" — for the guest who reads the code aloud or shows it
 * without a camera to scan it. Opens /v/<code>, the same page the QR opens,
 * where staff of this restaurant can redeem it.
 */
export function VoucherCheck() {
  const { t } = useLocale();
  const router = useRouter();
  const [code, setCode] = useState("");
  const valid = isVoucherCode(code);

  return (
    <form
      className="mb-6 flex min-w-0 flex-wrap items-end gap-2 rounded-lg border border-border bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) router.push(`/v/${normaliseVoucherCode(code)}`);
      }}
    >
      <label className="min-w-0 flex-1 text-sm font-semibold">
        <span className="flex items-center gap-2"><ScanLine className="size-4" aria-hidden />{t("ons.m.checkVoucher")}</span>
        <Input className="mt-1 font-mono uppercase" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="R237-XXXX-XXXX" />
      </label>
      <Button type="submit" variant="outline" disabled={!valid}>{t("ons.m.checkVoucherGo")}</Button>
      <p className="basis-full text-xs text-text-light">{t("ons.m.checkVoucherHint")}</p>
    </form>
  );
}
