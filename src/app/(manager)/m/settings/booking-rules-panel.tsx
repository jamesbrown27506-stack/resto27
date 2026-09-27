"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import { Field, Input, Switch } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useLocale } from "@/lib/i18n/use-locale";
import { addClosure, removeClosure, setReservationRules, setTipsEnabled } from "@/lib/data/booking-manager-actions";
import { todayInDisplayTz } from "@/lib/reservations/slots";

/**
 * The restaurant's own booking rules (0068):
 *   · the largest party it seats itself — above it a booking is a "group
 *     request" it arranges by hand;
 *   · how many arrivals it can greet in one half-hour;
 *   · closures (holidays, private events) — no bookings, no scheduled orders;
 *   · tips on table payments (Enterprise table service), off by default.
 */
export function BookingRulesPanel({
  maxParty,
  maxArrivals,
  tipsEnabled,
  closures,
  available,
  tableService,
}: {
  maxParty: number;
  maxArrivals: number | null;
  tipsEnabled: boolean;
  closures: { id: string; startsOn: string; endsOn: string; reason: string | null }[];
  available: boolean;
  tableService: boolean;
}) {
  const { t, locale } = useLocale();
  const { toast } = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [party, setParty] = useState(String(maxParty));
  const [arrivals, setArrivals] = useState(maxArrivals ? String(maxArrivals) : "");
  const [tips, setTips] = useState(tipsEnabled);
  const today = todayInDisplayTz();
  const [closure, setClosure] = useState({ startsOn: today, endsOn: today, reason: "" });

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: string, after?: () => void) {
    start(async () => {
      const result = await fn();
      if (!result.ok) return toast(result.error ?? t("ons.err.settingsFailed"), "error");
      toast(success, "success");
      after?.();
      router.refresh();
    });
  }

  const day = (iso: string) =>
    new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "fr-FR", { weekday: "short", day: "numeric", month: "short" })
      .format(new Date(`${iso}T12:00:00+01:00`));

  return (
    <Panel title={t("ons.m.rulesTitle")} description={t("ons.m.rulesBody")}>
      <div className="flex flex-col gap-6 p-5">
        {!available && <p className="rounded-md bg-warning-light p-3 text-sm text-warning">{t("ons.err.migration0068")}</p>}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("ons.m.maxParty")} htmlFor="max-party" hint={t("ons.m.maxPartyHint")}>
            <Input id="max-party" type="number" min={1} max={200} value={party} onChange={(e) => setParty(e.target.value)} />
          </Field>
          <Field label={t("ons.m.maxArrivals")} htmlFor="max-arrivals" hint={t("ons.m.maxArrivalsHint")}>
            <Input id="max-arrivals" type="number" min={1} max={100} value={arrivals} placeholder={t("ons.m.unlimited")} onChange={(e) => setArrivals(e.target.value)} />
          </Field>
        </div>
        <Button className="sm:self-start" loading={pending} disabled={pending || !available}
          onClick={() => run(() => setReservationRules({ maxParty: Number(party), maxArrivals: arrivals ? Number(arrivals) : null }), t("ons.m.rulesSaved"))}>
          <span>{t("common.save")}</span>
        </Button>

        {tableService && (
          <Switch
            label={t("ons.m.tips")}
            description={t("ons.m.tipsHint")}
            checked={tips}
            disabled={pending || !available}
            onChange={(e) => {
              const next = e.target.checked;
              setTips(next);
              run(() => setTipsEnabled(next), t("ons.m.rulesSaved"));
            }}
          />
        )}

        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold"><CalendarOff className="size-4" aria-hidden />{t("ons.m.closures")}</h3>
          <p className="mt-1 text-xs text-text-light">{t("ons.m.closuresHint")}</p>
          {closures.length > 0 && (
            <ul className="mt-3 divide-y divide-border rounded-md border border-border">
              {closures.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 capitalize">
                    {c.startsOn === c.endsOn ? day(c.startsOn) : `${day(c.startsOn)} → ${day(c.endsOn)}`}
                    {c.reason && <span className="text-text-secondary normal-case"> · {c.reason}</span>}
                  </span>
                  <Button variant="ghost" size="icon-sm" aria-label={t("common.delete")} disabled={pending}
                    onClick={() => run(() => removeClosure(c.id), t("ons.m.closureRemoved"))}>
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 grid gap-3 sm:grid-cols-[auto_auto_1fr_auto] sm:items-end">
            <Field label={t("ons.m.from")} htmlFor="closure-from">
              <Input id="closure-from" type="date" min={today} value={closure.startsOn} onChange={(e) => setClosure((c) => ({ ...c, startsOn: e.target.value, endsOn: c.endsOn < e.target.value ? e.target.value : c.endsOn }))} />
            </Field>
            <Field label={t("ons.m.to")} htmlFor="closure-to">
              <Input id="closure-to" type="date" min={closure.startsOn} value={closure.endsOn} onChange={(e) => setClosure((c) => ({ ...c, endsOn: e.target.value }))} />
            </Field>
            <Field label={t("ons.m.closureReason")} htmlFor="closure-reason">
              <Input id="closure-reason" maxLength={120} value={closure.reason} onChange={(e) => setClosure((c) => ({ ...c, reason: e.target.value }))} placeholder={t("ons.m.closureReasonPh")} />
            </Field>
            <Button variant="outline" disabled={pending || !available || !closure.startsOn || !closure.endsOn}
              onClick={() => run(() => addClosure(closure), t("ons.m.closureAdded"), () => setClosure({ startsOn: today, endsOn: today, reason: "" }))}>
              {t("ons.m.addClosure")}
            </Button>
          </div>
        </div>
      </div>
    </Panel>
  );
}
