"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { setReservationDuration } from "@/lib/data/manager-actions";
import { useLocale } from "@/lib/i18n/use-locale";

/**
 * The sitting length a booking holds its table for (0060).
 *
 * A short list rather than a free number: restaurants think in "une heure",
 * "une heure et demie", not in 83 minutes, and a typo of 600 would silently
 * block a table all evening. The current value is always offered, so a
 * restaurant whose stored length is not in the list still sees it.
 */
const PRESETS = [30, 45, 60, 75, 90, 120, 150, 180, 240];

export function ReservationDurationPanel({ durationMin }: { durationMin: number }) {
  const { t } = useLocale();
  const { toast } = useToast();
  const [saving, startSaving] = useTransition();
  const [draft, setDraft] = useState(durationMin);

  const options = PRESETS.includes(durationMin)
    ? PRESETS
    : [...PRESETS, durationMin].sort((a, b) => a - b);

  function label(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return t("mres.set.minutes", { count: m });
    return m === 0 ? t("mres.set.hours", { h }) : t("mres.set.hoursMinutes", { h, m: String(m).padStart(2, "0") });
  }

  function save() {
    startSaving(async () => {
      const result = await setReservationDuration(draft);
      if (!result.ok) return toast(result.error ?? t("mres.set.failed"), "error");
      toast(t("mres.set.saved"), "success");
    });
  }

  return (
    <Panel title={t("mres.set.title")} description={t("mres.set.description")}>
      <div className="flex flex-col gap-4 p-5">
        <Field label={t("mres.set.duration")} htmlFor="reservation-duration" hint={t("mres.set.durationHint")}>
          <Select
            id="reservation-duration"
            value={String(draft)}
            disabled={saving}
            onChange={(e) => setDraft(Number(e.target.value))}
            className="sm:max-w-xs"
          >
            {options.map((minutes) => (
              <option key={minutes} value={minutes}>
                {label(minutes)}
              </option>
            ))}
          </Select>
        </Field>
        <Button
          fullWidth
          className="sm:w-auto sm:self-start"
          loading={saving}
          disabled={saving || draft === durationMin}
          onClick={save}
        >
          <span>{t("common.save")}</span>
        </Button>
      </div>
    </Panel>
  );
}
