"use client";

import { useState, useTransition } from "react";
import { Lock, Pause, Play } from "lucide-react";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Switch, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { setAcceptingOrders } from "@/lib/data/manager-actions";
import { saveNotificationPreferences } from "@/lib/data/settings-actions";
import { NotificationSettings } from "@/components/notifications/notification-settings";
import { useLocale } from "@/lib/i18n/use-locale";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import type { NotificationEventKey, NotificationPreference } from "@/lib/data/settings";
import { ReservationDurationPanel } from "./reservation-duration-panel";

/**
 * Settings, on stored values.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE RULE THIS SCREEN EXISTS TO STOP BREAKING: a settings screen whose
 *  switches do nothing is worse than no settings screen, because it makes
 *  people stop trusting the ones that do work. Every control here writes.
 *
 *  The most useful switch on the page is not a notification — it is the
 *  service pause. A kitchen that is swamped needs to stop the queue in one
 *  tap, and until now that had no home in the interface at all.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function SettingsView({
  preferences,
  acceptingOrders,
  pausedReason,
  reservationDuration,
}: {
  preferences: NotificationPreference[];
  acceptingOrders: boolean;
  pausedReason: string | null;
  /** Minutes a booking holds its table (0060). */
  reservationDuration: number;
}) {
  const { t } = useLocale();
  const { toast } = useToast();
  const [saving, startSaving] = useTransition();
  const [switching, startSwitching] = useTransition();

  /*
   * A DRAFT, not a mirror. It is seeded once on purpose — the switches must
   * hold what the person is currently choosing, not snap back every time the
   * page re-reads the server. The branch id keys this component in page.tsx,
   * so changing branch remounts it rather than carrying one branch's answers
   * into another.
   */
  const [draft, setDraft] = useState(preferences);

  const [pauseOpen, setPauseOpen] = useState(false);
  const [reason, setReason] = useState("");

  const dirty = draft.some((d) => {
    const saved = preferences.find((p) => p.key === d.key);
    return !saved || saved.inApp !== d.inApp || saved.email !== d.email || saved.push !== d.push;
  });

  function setChannel(key: NotificationEventKey, channel: "inApp" | "email" | "push", value: boolean) {
    setDraft((current) =>
      current.map((p) => {
        // Locked events refuse the change here too, so the draft can never
        // even hold a silenced value to post.
        if (p.key !== key || p.locked) return p;
        if (channel === "inApp") return { ...p, inApp: value };
        if (channel === "email") return { ...p, email: value };
        return { ...p, push: value };
      }),
    );
  }

  function save() {
    startSaving(async () => {
      const result = await saveNotificationPreferences(
        draft.map((p) => ({ key: p.key, inApp: p.inApp, email: p.email, push: p.push })),
      );
      // The action's own message is server-side English. Both failures here are
      // "it did not save", with no per-case detail worth surfacing, so the
      // translated sentence carries the same information in the right language.
      if (!result.ok) return toast(t("mset.notif.failed"), "error");
      toast(t("mset.notif.saved"), "success");
    });
  }

  function changeService(accepting: boolean) {
    startSwitching(async () => {
      const result = await setAcceptingOrders(accepting, accepting ? undefined : reason);
      if (!result.ok) return toast(t("mset.service.failed"), "error");
      setPauseOpen(false);
      toast(
        accepting ? t("mset.service.resumedDone") : t("mset.service.pausedDone"),
        accepting ? "success" : "warning",
      );
    });
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {/* ── Service ────────────────────────────────────────────────────── */}
      <Panel title={t("mset.service.title")} description={t("mset.service.description")}>
        <div className="flex flex-col gap-4 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={acceptingOrders ? "success" : "warning"}>
              <span>
                {acceptingOrders ? t("mset.service.accepting") : t("mset.service.paused")}
              </span>
            </Badge>
            <p className="min-w-0 flex-1 text-sm text-text-secondary">
              <span>
                {acceptingOrders
                  ? t("mset.service.acceptingBody")
                  : t("mset.service.pausedBody")}
              </span>
            </p>
          </div>

          {!acceptingOrders && pausedReason && (
            <p className="rounded-md bg-surface-2 px-3.5 py-2.5 text-sm text-text-secondary italic">
              <span>{t("mset.service.reasonShown", { reason: pausedReason })}</span>
            </p>
          )}

          {/* Full width on a phone: the one action on this card must never sit
              off the side of the screen. */}
          {acceptingOrders ? (
            <Button
              variant="danger"
              fullWidth
              className="sm:w-auto sm:self-start"
              disabled={switching}
              onClick={() => {
                setReason(pausedReason ?? "");
                setPauseOpen(true);
              }}
            >
              <Pause className="size-4" aria-hidden />
              <span>{t("mset.service.pause")}</span>
            </Button>
          ) : (
            <Button
              fullWidth
              className="sm:w-auto sm:self-start"
              loading={switching}
              disabled={switching}
              onClick={() => changeService(true)}
            >
              <Play className="size-4" aria-hidden />
              <span>{t("mset.service.resume")}</span>
            </Button>
          )}

          <p className="text-xs text-text-light">
            <span>{t("mset.service.note")}</span>
          </p>
        </div>
      </Panel>

      {/* ── Reservations: how long a booking holds its table (0060) ─────── */}
      <ReservationDurationPanel durationMin={reservationDuration} />

      {/* ── Channels — the master switches, above the per-event grid ───── */}
      <NotificationSettings />

      {/* ── Notifications ──────────────────────────────────────────────── */}
      <Panel title={t("mset.notif.title")} description={t("mset.notif.description")}>
        {/* The column headers only exist once the row IS a row. Below md each
            switch carries its own word instead. */}
        <div
          className="hidden border-b border-border px-5 py-3 md:grid md:grid-cols-[minmax(0,1fr)_6.5rem_6.5rem_6.5rem] md:items-center md:gap-4"
          aria-hidden
        >
          <span className="text-[11px] font-bold tracking-[0.08em] text-text-light uppercase">
            {t("mset.notif.event")}
          </span>
          <span className="text-center text-[11px] font-bold tracking-[0.08em] text-text-light uppercase">
            {t("mset.notif.inApp")}
          </span>
          <span className="text-center text-[11px] font-bold tracking-[0.08em] text-text-light uppercase">
            {t("mset.notif.email")}
          </span>
          <span className="text-center text-[11px] font-bold tracking-[0.08em] text-text-light uppercase">
            {t("mset.notif.push")}
          </span>
        </div>

        <ul className="divide-y divide-border">
          {draft.map((pref) => {
            const name = t(`mset.evt.${pref.key}` as TranslationKey);

            return (
              <li
                key={pref.key}
                className="grid gap-3.5 p-4 sm:p-5 md:grid-cols-[minmax(0,1fr)_6.5rem_6.5rem_6.5rem] md:items-center md:gap-4"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    <span>{name}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-text-light">
                    <span>{t(`mset.evtBody.${pref.key}` as TranslationKey)}</span>
                  </p>
                  {pref.locked && (
                    <Badge tone="neutral" className="mt-2">
                      <Lock className="size-3" aria-hidden />
                      <span>{t("mset.notif.locked")}</span>
                    </Badge>
                  )}
                </div>

                {/* Below md the two channels sit side by side under the event,
                    each spelling out which one it is. `contents` from md up
                    dissolves this wrapper so the grid drops them straight into
                    the header's columns — same DOM, no remount on resize. */}
                <div className="flex flex-wrap gap-x-7 gap-y-3 md:contents">
                  <ChannelSwitch
                    label={t("mset.notif.inApp")}
                    ariaLabel={t("mset.notif.channel", {
                      event: name,
                      channel: t("mset.notif.inApp"),
                    })}
                    checked={pref.inApp}
                    disabled={pref.locked || saving}
                    onChange={(value) => setChannel(pref.key, "inApp", value)}
                  />
                  <ChannelSwitch
                    label={t("mset.notif.email")}
                    ariaLabel={t("mset.notif.channel", {
                      event: name,
                      channel: t("mset.notif.email"),
                    })}
                    checked={pref.email}
                    disabled={pref.locked || saving}
                    onChange={(value) => setChannel(pref.key, "email", value)}
                  />
                  <ChannelSwitch
                    label={t("mset.notif.push")}
                    ariaLabel={t("mset.notif.channel", {
                      event: name,
                      channel: t("mset.notif.push"),
                    })}
                    checked={pref.push}
                    disabled={pref.locked || saving}
                    onChange={(value) => setChannel(pref.key, "push", value)}
                  />
                </div>
              </li>
            );
          })}
        </ul>

        <div className="flex flex-col gap-3 border-t border-border p-5">
          <p className="text-xs text-text-light">
            <span>{t("mset.notif.lockedBody")}</span>
          </p>
          <Button
            fullWidth
            className="sm:w-auto sm:self-start"
            loading={saving}
            disabled={saving || !dirty}
            title={dirty ? undefined : t("mset.notif.nothingToSave")}
            onClick={save}
          >
            <span>{t("common.save")}</span>
          </Button>
        </div>
      </Panel>

      {/* Push moved up into the channels panel above — the browser
          permission and the "I want push" preference are one decision, and
          splitting them across two cards was how a switch could read ON
          while this device had never been subscribed. */}

      {/* ── Appearance ─────────────────────────────────────────────────── */}
      <Panel title={t("mset.appearance.title")}>
        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="min-w-0">
            <p className="text-sm font-medium">
              <span>{t("mset.appearance.theme")}</span>
            </p>
            <p className="mt-0.5 text-sm text-text-secondary">
              <span>{t("mset.appearance.themeBody")}</span>
            </p>
          </div>
          <ThemeToggle />
        </div>
      </Panel>

      {/* Pausing asks for the sentence customers will read. Optional, because a
          kitchen in the weeds should not be held up by a text box — but asked
          for, because an order button that vanishes without a word reads as a
          broken website rather than a closed restaurant. */}
      <Dialog
        open={pauseOpen}
        onClose={() => setPauseOpen(false)}
        title={t("mset.service.pauseTitle")}
        description={t("mset.service.pauseBody")}
        size="sm"
        footer={
          <>
            <Button variant="outline" disabled={switching} onClick={() => setPauseOpen(false)}>
              <span>{t("common.cancel")}</span>
            </Button>
            <Button
              variant="danger"
              loading={switching}
              disabled={switching}
              onClick={() => changeService(false)}
            >
              <span>{t("mset.service.pause")}</span>
            </Button>
          </>
        }
      >
        <Field
          label={t("mset.service.reason")}
          htmlFor="pause-reason"
          hint={t("mset.service.reasonHint")}
        >
          <Textarea
            id="pause-reason"
            rows={3}
            value={reason}
            placeholder={t("mset.service.reasonPlaceholder")}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      </Dialog>
    </div>
  );
}

/**
 * One channel toggle.
 *
 * Its word is visible while the row is a stacked card and hidden once the
 * column header above says the same thing — CSS only, so the input is never
 * remounted and never loses focus at a breakpoint.
 */
function ChannelSwitch({
  label,
  ariaLabel,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Switch
      label={label}
      aria-label={ariaLabel}
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      className="gap-2.5 md:justify-center md:gap-0 md:[&>span:last-child]:hidden"
    />
  );
}
