"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Radio, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useLocale } from "@/lib/i18n/use-locale";
import { formatMoney } from "@/lib/format/currency";
import { redeemVoucher } from "@/lib/data/voucher-actions";
import type { VoucherState } from "@/lib/reservations/voucher";

/**
 * The staff half of /v/<code>: seat the booking and carry its deposit.
 *
 * With Enterprise table service the deposit lands on a bill — one already
 * open, or one opened now on the party's table. Without it, the booking is
 * seated and the screen says what to deduct from the bill by hand.
 */
export function VoucherRedeem({
  code,
  state,
  canRedeem,
  credit,
  tableService,
  openBills,
  tables,
}: {
  code: string;
  state: VoucherState;
  canRedeem: boolean;
  credit: number;
  tableService: boolean;
  openBills: { id: string; label: string | null; tableNumber: string | null }[];
  tables: { id: string; number: string; capacity: number }[];
}) {
  const { t } = useLocale();
  const { toast } = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [target, setTarget] = useState<"new" | "existing" | "seat">(tableService ? "new" : "seat");
  const [tableId, setTableId] = useState(tables[0]?.id ?? "");
  const [billId, setBillId] = useState(openBills[0]?.id ?? "");
  const [done, setDone] = useState<number | null>(null);

  if (!canRedeem) return <p className="mt-4 text-center text-sm text-text-secondary">{t("ons.c.noRedeemRight")}</p>;
  if (done !== null) {
    return (
      <div className="mt-4 rounded-xl border border-success/30 bg-success-light p-5 text-center">
        <CheckCircle2 className="mx-auto size-8 text-success" aria-hidden />
        <p className="mt-2 font-semibold">{t("ons.c.redeemed")}</p>
        {done > 0 && (
          <p className="mt-1 text-sm">{tableService && target !== "seat" ? t("ons.c.creditOnBill", { amount: formatMoney(done) }) : t("ons.c.deductByHand", { amount: formatMoney(done) })}</p>
        )}
      </div>
    );
  }
  if (state !== "valid") return null;

  function redeem() {
    start(async () => {
      const result = await redeemVoucher(code, {
        sessionId: target === "existing" ? billId : null,
        openTableId: target === "new" ? tableId : null,
      });
      if (!result.ok) return toast(result.error, "error");
      setDone(result.credit);
      router.refresh();
    });
  }

  return (
    <section className="mt-4 rounded-xl border border-border bg-surface p-5">
      <h2 className="font-display text-lg font-bold">{t("ons.c.redeemTitle")}</h2>
      {credit > 0 && <p className="mt-1 text-sm text-text-secondary">{t("ons.c.redeemCredit", { amount: formatMoney(credit) })}</p>}
      <div className="mt-4 grid gap-2">
        {tableService && (
          <>
            <Radio name="redeem" checked={target === "new"} onChange={() => setTarget("new")} label={t("ons.c.openBill")} />
            {target === "new" && (
              <Select value={tableId} onChange={(e) => setTableId(e.target.value)} aria-label={t("ons.c.tables")}>
                {tables.map((table) => <option key={table.id} value={table.id}>{t("ons.g.table", { number: table.number })} · {table.capacity}</option>)}
              </Select>
            )}
            {openBills.length > 0 && <Radio name="redeem" checked={target === "existing"} onChange={() => setTarget("existing")} label={t("ons.c.existingBill")} />}
            {target === "existing" && (
              <Select value={billId} onChange={(e) => setBillId(e.target.value)} aria-label={t("ons.c.existingBill")}>
                {openBills.map((bill) => <option key={bill.id} value={bill.id}>{t("ons.g.table", { number: bill.tableNumber ?? "?" })}{bill.label ? ` · ${bill.label}` : ""}</option>)}
              </Select>
            )}
          </>
        )}
        <Radio name="redeem" checked={target === "seat"} onChange={() => setTarget("seat")} label={t("ons.c.seatOnly")} description={credit > 0 ? t("ons.c.seatOnlyHint") : undefined} />
      </div>
      <Button fullWidth size="lg" className="mt-4" loading={pending}
        disabled={pending || (target === "new" && !tableId) || (target === "existing" && !billId)} onClick={redeem}>
        {t("ons.c.redeem")}
      </Button>
    </section>
  );
}
