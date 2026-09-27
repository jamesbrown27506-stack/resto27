import type { Metadata } from "next";
import QRCode from "qrcode";
import { BadgeCheck, CalendarClock, CircleAlert, Ticket, Users } from "lucide-react";
import { getVoucherView } from "@/lib/data/vouchers";
import { absoluteUrl } from "@/lib/site-url";
import { getLocale, getTranslator } from "@/lib/i18n/locale-server";
import { formatMoney } from "@/lib/format/currency";
import type { VoucherState } from "@/lib/reservations/voucher";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { VoucherRedeem } from "./voucher-redeem";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Bon de réservation", robots: { index: false, follow: false } };

const STATE_KEY: Record<VoucherState, TranslationKey> = {
  valid: "ons.c.state.valid",
  tooEarly: "ons.c.state.tooEarly",
  used: "ons.c.state.used",
  expired: "ons.c.state.expired",
  cancelled: "ons.c.state.cancelled",
  refunded: "ons.c.state.refunded",
  notConfirmed: "ons.c.state.notConfirmed",
};

const STATE_TONE: Record<VoucherState, string> = {
  valid: "border-success/30 bg-success-light text-success",
  tooEarly: "border-info/30 bg-info-light text-info",
  used: "border-border bg-surface-2 text-text-secondary",
  expired: "border-error/25 bg-error-light text-error",
  cancelled: "border-error/25 bg-error-light text-error",
  refunded: "border-border bg-surface-2 text-text-secondary",
  notConfirmed: "border-warning/30 bg-warning-light text-warning",
};

/**
 * /v/<code> — the booking voucher (0068). Scanned at the door from the
 * customer's phone, or opened from their confirmation. What it shows
 * depends on who looks (lib/data/vouchers.ts); only staff of the booked
 * restaurant get the Redeem button.
 */
export default async function VoucherPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const [view, t, locale] = await Promise.all([getVoucherView(decodeURIComponent(raw)), getTranslator(), getLocale()]);

  if (view.kind === "notFound") {
    return (
      <main className="mx-auto grid min-h-[60dvh] max-w-md place-items-center px-4 py-16 text-center">
        <div>
          <CircleAlert className="mx-auto size-10 text-error" aria-hidden />
          <h1 className="mt-4 font-display text-2xl font-bold">{t("ons.err.voucherNotFound")}</h1>
        </div>
      </main>
    );
  }

  const state = view.kind === "public" ? view.state : view.booking.state;
  const code = view.kind === "public" ? view.code : view.booking.code;
  const restaurantName = view.kind === "public" ? view.restaurantName : view.booking.restaurantName;
  const qr = view.kind === "public"
    ? null
    : await QRCode.toDataURL(await absoluteUrl(`/v/${code}`), { errorCorrectionLevel: "M", margin: 1, width: 320 });
  const when = view.kind === "public" ? null : new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "fr-FR", {
    timeZone: "Africa/Douala", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  }).format(new Date(view.booking.reservedFor));

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <div className="rounded-xl border border-border bg-surface p-6 text-center shadow-sm">
        <p className="flex items-center justify-center gap-2 text-sm font-semibold text-primary"><Ticket className="size-4" aria-hidden />{t("ons.c.voucherTitle")}</p>
        <h1 className="mt-1 font-display text-2xl font-bold">{restaurantName}</h1>
        <p className={`mt-4 inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-semibold ${STATE_TONE[state]}`}>
          {state === "valid" && <BadgeCheck className="size-4" aria-hidden />}{t(STATE_KEY[state])}
        </p>

        {qr && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr} alt={t("ons.c.qrAlt")} width={240} height={240} className="mx-auto mt-5 rounded-md bg-white p-2" />
        )}
        <p className="tnum mt-3 font-mono text-lg font-bold tracking-widest">{code}</p>

        {view.kind !== "public" && (
          <dl className="mt-5 space-y-2 border-t border-border pt-4 text-left text-sm">
            <div className="flex items-center gap-2"><CalendarClock className="size-4 text-text-light" aria-hidden /><dt className="sr-only">{t("ons.c.when")}</dt><dd className="capitalize">{when}</dd></div>
            <div className="flex items-center gap-2"><Users className="size-4 text-text-light" aria-hidden /><dt className="sr-only">{t("ons.c.party")}</dt><dd>{view.booking.guestName} · {t("ons.c.people", { count: view.booking.partySize })}</dd></div>
            {view.booking.tableNumbers.length > 0 && <div className="flex justify-between"><dt className="text-text-secondary">{t("ons.c.tables")}</dt><dd>{view.booking.tableNumbers.join(", ")}</dd></div>}
            <div className="flex justify-between"><dt className="text-text-secondary">{t("ons.c.reference")}</dt><dd className="tnum">{view.booking.reference}</dd></div>
            {view.booking.credit > 0 && (
              <div className="flex justify-between font-semibold text-success"><dt>{t("ons.c.depositOnBill")}</dt><dd className="tnum">{formatMoney(view.booking.credit)}</dd></div>
            )}
            {view.booking.depositPercent > 0 && (
              <p className="text-xs text-text-secondary">{t("ons.c.percentDeposit", { pct: view.booking.depositPercent })}</p>
            )}
          </dl>
        )}

        {view.kind === "owner" && (
          <p className="mt-4 text-xs leading-relaxed text-text-secondary">{t("ons.c.ownerHint")}</p>
        )}
        {view.kind === "public" && (
          <p className="mt-4 text-xs leading-relaxed text-text-secondary">{t("ons.c.publicHint")}</p>
        )}
      </div>

      {view.kind === "staff" && (
        <VoucherRedeem
          code={view.booking.code}
          state={view.booking.state}
          canRedeem={view.canRedeem}
          credit={view.booking.credit}
          tableService={view.tableService}
          openBills={view.openBills}
          tables={view.tables}
        />
      )}
    </main>
  );
}
