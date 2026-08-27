"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { AlertTriangle, Bell, BellRing, Mail, Moon, Pause, RotateCcw, Smartphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import { Switch } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useLocale } from "@/lib/i18n/use-locale";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import {
  configuredVapidKey,
  ensurePushSubscription,
  iosInstallRequired,
  isIOSDevice,
  registerPushWorker,
  serializePushSubscription,
} from "@/lib/notifications/web-push-client";
import {
  announcePushEnabled,
  getMyNotificationChannels,
  listPushDevices,
  removePushDevice,
  removePushSubscription,
  saveMyNotificationChannels,
  resetPushSubscriptions,
  savePushSubscription,
  sendTestPush,
  snoozeMyPush,
  type PushDeviceRow,
} from "@/lib/data/notify-actions";

/**
 * Declared here rather than imported: the canonical interface lives in
 * lib/data/notification-channels, which is `server-only`. Structural typing
 * matches the two, and this file stays free of any path into server code.
 */
interface NotificationChannels {
  inApp: boolean;
  email: boolean;
  push: boolean;
  quietStart?: number | null;
  quietEnd?: number | null;
  snoozedUntil?: string | null;
}

/**
 * "Push is off ON THIS DEVICE" — remembered by this browser, because that is
 * what the fact is about. Without it, the background repair (PushSync, and
 * this panel's own mount effect) saw granted permission + account preference
 * on and silently re-subscribed a device the person had just switched off.
 */
const DEVICE_OPT_OUT_KEY = "restolink:pushDeviceOptOut";

export function pushDeviceOptedOut(): boolean {
  try {
    return localStorage.getItem(DEVICE_OPT_OUT_KEY) !== null;
  } catch {
    return false;
  }
}

function setPushDeviceOptOut(on: boolean): void {
  try {
    if (on) localStorage.setItem(DEVICE_OPT_OUT_KEY, new Date().toISOString());
    else localStorage.removeItem(DEVICE_OPT_OUT_KEY);
  } catch {
    // Private mode etc. — the repair stays as eager as before, nothing worse.
  }
}

/**
 * "How do we reach you" — the same panel for the customer, the manager and
 * the administrator.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THREE SWITCHES, AND WHAT EACH ONE ACTUALLY CONTROLS.
 *
 *   · In the app — the notifications row. The bell badge and the live toast
 *     are the same row seen twice (as it lands, and when you go looking), so
 *     they are one switch and not two: the delivery path cannot split them.
 *   · Email     — trySendMail.
 *   · Push      — web push, and it is the only one with a second half. The
 *     preference says "I want push"; the browser subscription says "this
 *     device can receive it". The switch drives BOTH, because a preference
 *     that is on while the device was never subscribed is a switch that lies.
 *
 *  TURNING PUSH ON IS THE PERMISSION PROMPT. Flipping the switch calls
 *  Notification.requestPermission() there and then — that is the browser
 *  dialog people expect to see — subscribes the browser, stores the
 *  endpoint, and finishes by sending a REAL notification back through
 *  lib/notify (announcePushEnabled). The confirmation arriving on the device
 *  is the proof; there is nothing else to test afterwards.
 *
 *  WHEN IT CANNOT BE TURNED ON, IT SAYS WHICH REASON. Unsupported browser,
 *  insecure origin, server key not configured, permission blocked and
 *  permission dismissed are five different problems with five different
 *  fixes, and one shared "could not enable notifications" sent people
 *  hunting through browser settings for a missing server key.
 * ─────────────────────────────────────────────────────────────────────────
 */

const HOURS = Array.from({ length: 24 }, (_, i) => i);

/** Why push is unavailable or was refused — each maps to its own sentence. */
type PushBlock =
  | null
  | "unsupported"
  | "insecure"
  | "iosInstall"
  | "notConfigured"
  | "denied"
  | "dismissed"
  | "failed";

export function NotificationSettings({ className }: { className?: string }) {
  const { t } = useLocale();
  const { toast } = useToast();
  const [, startTransition] = useTransition();

  const [channels, setChannels] = useState<NotificationChannels | null>(null);
  const [deviceSubscribed, setDeviceSubscribed] = useState(false);
  const [block, setBlock] = useState<PushBlock>(null);
  // Only the push flow blocks the panel: it opens a browser dialog and talks
  // to the push service, and flipping another switch underneath it would race
  // two writes of the same row.
  const [busy, setBusy] = useState(false);

  /** The real-path push test — see the button in the device box below. */
  const [testing, setTesting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [testReport, setTestReport] = useState<Awaited<ReturnType<typeof sendTestPush>> | null>(null);

  /** The stored devices, with the delivery health the send path records. */
  const [devices, setDevices] = useState<PushDeviceRow[] | null>(null);

  async function refreshDevices() {
    const result = await listPushDevices().catch(() => null);
    if (result?.ok) setDevices(result.devices);
  }

  /**
   * Full reset: forget this browser's subscription AND every row the server
   * holds, unregister the worker, then subscribe again from nothing.
   *
   * Ordered deliberately. The server rows go LAST — if the browser half fails
   * we stop before destroying the only record of the other devices. And the
   * worker is unregistered rather than reused, because a worker evicted or
   * half-updated is one of the states this is here to escape; `register`
   * afterwards installs a clean one.
   */
  async function runReset() {
    setResetting(true);
    setTestReport(null);
    try {
      const key = configuredVapidKey();
      if (!key) {
        toast(t("nset.push.notConfigured"), "warning");
        return;
      }

      // 1. Drop the browser's current subscription, if any.
      const existing = await navigator.serviceWorker
        .getRegistration("/sw.js")
        .catch(() => null);
      const sub = await existing?.pushManager.getSubscription().catch(() => null);
      if (sub) await sub.unsubscribe().catch(() => false);

      // 2. Throw the worker away so the next one is installed fresh.
      if (existing) await existing.unregister().catch(() => false);

      // 3. Now the server's rows — every device, see resetPushSubscriptions.
      const cleared = await resetPushSubscriptions();
      if (!cleared.ok) {
        toast(cleared.error ?? t("nset.saveFailed"), "error");
        return;
      }

      // 4. Rebuild this device from scratch.
      const registration = await registerPushWorker();
      const { subscription } = await ensurePushSubscription(registration, key);
      const saved = await savePushSubscription(serializePushSubscription(subscription));
      if (!saved.ok) {
        toast(saved.error ?? t("nset.saveFailed"), "error");
        return;
      }

      setDeviceSubscribed(true);
      setBlock(null);
      setPushDeviceOptOut(false);
      toast(t("nset.push.resetDone", { count: cleared.removed }), "success");

      /*
        THE RESET ENDS WITH PROOF, LIKE THE ENABLE FLOW DOES. This is the
        control people reach for precisely when push is suspect — ending it
        with local state and a toast left "did it actually work?" exactly as
        open as before. A real notification through the real writer on the
        just-rebuilt endpoint is the answer.
      */
      await announcePushEnabled().catch(() => null);
      void refreshDevices();
    } catch (error) {
      console.error("[push] reset failed", error);
      setBlock("failed");
      toast(t("nset.push.resetFailed"), "error");
    } finally {
      setResetting(false);
    }
  }

  async function runTest() {
    setTesting(true);
    setTestReport(null);
    // Hand the server this browser's own endpoint so the report can say which
    // line is this device — the only line that answers the actual question.
    const mine = await navigator.serviceWorker
      .getRegistration("/sw.js")
      .then((r) => r?.pushManager.getSubscription())
      .catch(() => null);

    const report = await sendTestPush(mine?.endpoint).catch(() => null);
    setTesting(false);
    if (!report) return toast(t("nset.saveFailed"), "error");
    setTestReport(report);
    toast(t(report.ok ? "nset.push.testSent" : "nset.push.testFailed"), report.ok ? "success" : "error");
  }

  // A late resolve from the mount effect must not overwrite a switch the
  // person has already flipped.
  const touched = useRef(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const stored = await getMyNotificationChannels().catch(() => null);
      if (cancelled || touched.current) return;
      setChannels(stored ?? { inApp: true, email: true, push: true });
    })();

    void (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        if (!cancelled) setBlock("unsupported");
        return;
      }
      if (!window.isSecureContext) {
        if (!cancelled) setBlock("insecure");
        return;
      }
      if (iosInstallRequired()) {
        if (!cancelled) setBlock("iosInstall");
        return;
      }
      try {
        const registration = await registerPushWorker();
        const subscription = await registration.pushManager.getSubscription();
        if (cancelled) return;
        setDeviceSubscribed(Boolean(subscription));

        // Re-sync a subscription the server may have lost (data wiped, first
        // visit since push existed) so the stored endpoint matches reality.
        // Never on a device whose owner explicitly switched it off — that is
        // the opt-out the repair used to silently undo.
        if (subscription && Notification.permission === "granted" && !pushDeviceOptedOut()) {
          const key = configuredVapidKey();
          if (key) {
            const repaired = await ensurePushSubscription(registration, key);
            await savePushSubscription(
              serializePushSubscription(repaired.subscription, repaired.previousEndpoint),
            ).then(
        (saved) => {
          /*
            A REPAIR THAT DID NOT STORE IS NOT A REPAIR.

            This swallowed everything, so the device could subscribe
            perfectly, fail to hand the endpoint to the server, and report
            nothing — leaving push exactly as broken as before with the
            switch still reading "on". Nothing is shown to the person (this
            is a background repair; there is no question to answer), but a
            log line is the difference between a diagnosable fault and a
            mystery.
          */
          if (!saved?.ok) console.warn("[push] endpoint not stored", saved?.error ?? "");
        },
        (error) => console.warn("[push] endpoint not stored", error),
      );
            if (!cancelled) setDeviceSubscribed(true);
          }
        }
        if (!subscription && Notification.permission === "denied") setBlock("denied");
      } catch (error) {
        console.error("[push] state check failed", error);
      }
    })();

    void refreshDevices();

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Persist all three, reverting the optimistic switch if the write fails.
   *
   * No Save button: three switches whose only job is to be on or off do not
   * need a second decision, and a settings screen that silently loses a
   * toggle because nobody scrolled to the bottom is the failure this avoids.
   */
  function persist(next: NotificationChannels, previous: NotificationChannels) {
    startTransition(async () => {
      const result = await saveMyNotificationChannels(next).catch(() => ({ ok: false as const }));
      if (!result.ok) {
        setChannels(previous);
        toast(t("nset.saveFailed"), "error");
        return;
      }
      toast(t("nset.saved"), "success");
    });
  }

  function toggleSimple(field: "inApp" | "email", value: boolean) {
    if (!channels) return;
    touched.current = true;
    const previous = channels;
    const next = { ...channels, [field]: value };
    setChannels(next);
    persist(next, previous);
  }

  /* ── Quiet hours + snooze — the push-only mutes ──────────────────────── */

  function saveQuietHours(startHour: number | null, endHour: number | null) {
    if (!channels) return;
    touched.current = true;
    const previous = channels;
    const next = {
      ...channels,
      quietStart: startHour === null ? null : startHour * 60,
      quietEnd: endHour === null ? null : endHour * 60,
    };
    setChannels(next);
    persist(next, previous);
  }

  async function snooze(hours: number | null) {
    touched.current = true;
    const result = await snoozeMyPush(hours).catch(() => null);
    if (!result?.ok) {
      toast(t("nset.saveFailed"), "error");
      return;
    }
    setChannels((current) =>
      current ? { ...current, snoozedUntil: result.snoozedUntil } : current,
    );
    toast(t(hours === null ? "nset.snooze.resumed" : "nset.snooze.saved"), "info");
  }

  /* ── Push: the switch that also owns this browser's subscription ────── */

  async function enablePush() {
    if (!channels) return;
    touched.current = true;
    setBusy(true);
    setBlock(null);

    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setBlock("unsupported");
        return;
      }
      if (!window.isSecureContext) {
        setBlock("insecure");
        return;
      }
      if (iosInstallRequired()) {
        setBlock("iosInstall");
        return;
      }
      const key = configuredVapidKey();
      if (!key) {
        // Nothing the person can do about this one — it is a server env var.
        setBlock("notConfigured");
        return;
      }

      // THE PROMPT. Shown by the browser whenever the answer is still
      // "default"; once granted it resolves silently, which is the browser's
      // rule and not something the page can re-ask.
      const permission = await Notification.requestPermission();
      if (permission === "denied") {
        setBlock("denied");
        return;
      }
      if (permission !== "granted") {
        setBlock("dismissed");
        return;
      }

      const registration = await registerPushWorker();
      const { subscription, previousEndpoint } = await ensurePushSubscription(registration, key);
      const saved = await savePushSubscription(
        serializePushSubscription(subscription, previousEndpoint),
      );
      if (!saved.ok) {
        await subscription.unsubscribe().catch(() => {});
        setBlock("failed");
        return;
      }

      const previous = channels;
      const next = { ...channels, push: true };
      setChannels(next);
      setDeviceSubscribed(true);
      setPushDeviceOptOut(false);
      void refreshDevices();

      const stored = await saveMyNotificationChannels(next).catch(() => ({ ok: false as const }));
      if (!stored.ok) {
        setChannels(previous);
        toast(t("nset.saveFailed"), "error");
        return;
      }

      // The receipt: a real notification, through the real writer, over the
      // channel that was just switched on.
      const announced = await announcePushEnabled().catch(() => ({ ok: false as const }));
      toast(t(announced.ok ? "nset.push.enabled" : "nset.push.enabledNoSend"), "success");
    } catch (error) {
      console.error("[push] enable failed", error);
      setBlock("failed");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Turn push off HERE — and only clear the account-wide switch if this was
   * the last device.
   *
   * ─────────────────────────────────────────────────────────────────────────
   *  THIS SWITCH SAID "THIS DEVICE" AND ACTED ON THE WHOLE ACCOUNT.
   *
   *  Everything around it is per-device: the badge reads "Push is on for this
   *  device", `pushOnHere` is the preference AND a live subscription, and the
   *  reset control talks about this browser. But turning it off wrote
   *  `notification_channels.push = false`, which is the account's master
   *  switch — so switching push off on a phone silenced the laptop, the
   *  kitchen tablet and every other browser the person had ever enabled.
   *
   *  Worse, it is silent and it is exactly what someone does while trying to
   *  fix push: toggling off and on is the folk remedy this whole area has
   *  been chasing, and each "off" was quietly disarming every other device.
   *
   *  So the two intentions are now told apart by what is LEFT. On the only
   *  device it owns, "off" means stop sending me push, and the master switch
   *  goes with it. With others still registered it means not on this one, and
   *  the master switch is left alone — the toast says which happened, because
   *  a switch that does less than you expected must say so.
   * ─────────────────────────────────────────────────────────────────────────
   */
  async function disablePush() {
    if (!channels) return;
    touched.current = true;
    setBusy(true);

    const previous = channels;

    try {
      let remaining = 0;
      if ("serviceWorker" in navigator) {
        const registration = await navigator.serviceWorker.getRegistration("/sw.js");
        const subscription = await registration?.pushManager.getSubscription();
        if (subscription) {
          const removed = await removePushSubscription(subscription.endpoint).catch(() => null);
          /*
            AN UNANSWERABLE REMOVAL MUST NOT SYNTHESIZE ZERO. The server
            action deliberately never returns remaining:0 on a failed count
            — zero is the value that flips the ACCOUNT master switch off —
            and `?? 0` here was manufacturing exactly the answer the server
            refuses to give. A rejected call (network drop, expired session)
            now stops the flow with the browser subscription intact: the
            server still targets this endpoint, so pretending it is off
            would just make the switch lie in the other direction.
          */
          if (!removed || !removed.ok) {
            toast(t("nset.saveFailed"), "error");
            return;
          }
          remaining = removed.remaining;
          await subscription.unsubscribe().catch(() => {});
        }
      }
      setDeviceSubscribed(false);
      setBlock(null);
      setPushDeviceOptOut(true);
      void refreshDevices();

      // Other devices are still listening: this one goes quiet, the account
      // preference stays as it was.
      if (remaining > 0) {
        toast(t("nset.push.disabledHere", { count: remaining }), "info");
        return;
      }

      const next = { ...channels, push: false };
      setChannels(next);

      const stored = await saveMyNotificationChannels(next).catch(() => ({ ok: false as const }));
      if (!stored.ok) {
        setChannels(previous);
        toast(t("nset.saveFailed"), "error");
        return;
      }
      toast(t("nset.push.disabled"), "info");
    } catch (error) {
      console.error("[push] disable failed", error);
      setChannels(previous);
      toast(t("nset.saveFailed"), "error");
    } finally {
      setBusy(false);
    }
  }

  if (!channels) {
    return (
      <Panel title={t("nset.title")} description={t("nset.subtitle")} className={className}>
        <p className="p-5 text-sm text-text-light">
          <span>{t("common.loading")}</span>
        </p>
      </Panel>
    );
  }

  // Honest reading: push reaches this browser only when BOTH the preference
  // and a live subscription say so.
  const pushOnHere = channels.push && deviceSubscribed;
  const snoozeActive = Boolean(
    channels.snoozedUntil && Date.parse(channels.snoozedUntil) > Date.now(),
  );
  const quietStartHour =
    channels.quietStart == null ? null : Math.floor(channels.quietStart / 60);
  const quietEndHour = channels.quietEnd == null ? null : Math.floor(channels.quietEnd / 60);
  const pushElsewhere = channels.push && !deviceSubscribed && block === null;
  const hardBlocked =
    block === "unsupported" ||
    block === "insecure" ||
    block === "iosInstall" ||
    block === "notConfigured";
  const allOff = !channels.inApp && !channels.email && !channels.push;

  return (
    <Panel title={t("nset.title")} description={t("nset.subtitle")} className={className}>
      <div className="divide-y divide-border">
        <ChannelRow
          icon={<Bell className="size-4" aria-hidden />}
          label={t("nset.inApp.label")}
          body={t("nset.inApp.body")}
          checked={channels.inApp}
          disabled={busy}
          onChange={(value) => toggleSimple("inApp", value)}
        />

        <ChannelRow
          icon={<Mail className="size-4" aria-hidden />}
          label={t("nset.email.label")}
          body={t("nset.email.body")}
          checked={channels.email}
          disabled={busy}
          onChange={(value) => toggleSimple("email", value)}
        />

        <div className="p-5">
          <ChannelRow
            bare
            icon={<BellRing className="size-4" aria-hidden />}
            label={t("nset.push.label")}
            body={t("nset.push.body")}
            checked={pushOnHere}
            disabled={busy || hardBlocked}
            onChange={(value) => void (value ? enablePush() : disablePush())}
          />

          <div className="mt-3 flex flex-col gap-2 rounded-md bg-surface-2 p-3.5">
            <p className="flex items-center gap-2 text-xs font-semibold text-text-secondary">
              <Smartphone className="size-3.5 shrink-0" aria-hidden />
              <span>{t("nset.push.device")}</span>
            </p>

            {pushOnHere ? (
              <Badge tone="success" className="self-start">
                <span>{t("nset.push.deviceOn")}</span>
              </Badge>
            ) : (
              <Badge tone="neutral" className="self-start">
                <span>{t("nset.push.deviceOff")}</span>
              </Badge>
            )}

            {pushElsewhere && (
              <p className="text-xs text-text-light">
                <span>{t("nset.push.deviceOther")}</span>
              </p>
            )}

            {/*
              EVERY STORED DEVICE, WITH ITS HEALTH. The send path has been
              recording last-success and failure counts on each row since
              0042 and nothing ever read them back — this is where they
              answer the actual question: which of my devices does the
              server believe in, and is any of them silently failing? The
              per-row remove is how a lost phone leaves the account without
              the nuclear reset.
            */}
            {devices !== null && devices.length > 0 && (
              <div className="flex flex-col gap-1.5 border-t border-border pt-3">
                <p className="text-xs font-semibold text-text-secondary">
                  <span>{t("nset.devices.title")}</span>
                </p>
                {devices.map((device) => (
                  <div key={device.id} className="flex items-start justify-between gap-2">
                    <p className="min-w-0 text-xs text-text-light">
                      <span className="font-medium text-text-secondary">{device.label}</span>
                      <span className="font-mono"> …{device.endpointTail}</span>
                      <br />
                      <span
                        className={
                          device.failureCount > 0
                            ? "text-warning"
                            : device.lastSuccessAt
                              ? "text-success"
                              : undefined
                        }
                      >
                        {device.failureCount > 0
                          ? t("nset.devices.healthFailing", {
                              count: device.failureCount,
                              code: device.lastFailureCode ?? "?",
                            })
                          : device.lastSuccessAt
                            ? t("nset.devices.healthOk", {
                                when: new Date(device.lastSuccessAt).toLocaleString(),
                              })
                            : t("nset.devices.healthNever")}
                      </span>
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy || resetting}
                      onClick={() =>
                        void (async () => {
                          const removed = await removePushDevice(device.id).catch(() => null);
                          if (!removed?.ok) return toast(t("nset.saveFailed"), "error");
                          toast(t("nset.devices.removed"), "info");
                          void refreshDevices();
                        })()
                      }
                      className="shrink-0"
                    >
                      <span>{t("nset.devices.remove")}</span>
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/*
              THE TEST THAT GOES THROUGH THE REAL PATH.

              "It works on my laptop but not my phone" is three different
              problems — no subscription stored for that handset, the push
              service rejecting it, or Android accepting it and showing
              nothing — and they have three different fixes. This sends a real
              push down the same road an order takes and reports what each
              device did, so the answer is read rather than guessed.

              CLOSE THE APP FIRST is the instruction that matters: a
              notification that arrives with the app in front proves almost
              nothing, because that is the case that already worked.
            */}
            {pushOnHere && (
              <div className="flex flex-col gap-2 border-t border-border pt-3">
                <Button
                  variant="outline"
                  size="sm"
                  loading={testing}
                  disabled={testing}
                  onClick={() => void runTest()}
                  className="self-start"
                >
                  <BellRing className="size-3.5" aria-hidden />
                  <span>{t("nset.push.test")}</span>
                </Button>

                <p className="text-xs leading-relaxed text-text-light">
                  <span>{t("nset.push.testHint")}</span>
                </p>

                {testReport && (
                  <div className="flex flex-col gap-1.5">
                    {/*
                      THE LINE THAT ANSWERS THE QUESTION. Every other result
                      can be a green tick for a browser that no longer exists;
                      this one says whether the handset in your hand is even
                      on the list. If it is not, no amount of retrying will
                      deliver anything here — the fix is Reset, below.
                    */}
                    {/*
                      The gate the test itself steps over. It sends because you
                      asked; a real order would be stopped here, so a page of
                      green ticks with this switch off is a lie by omission.
                    */}
                    {!testReport.masterPushOn && (
                      <p className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-light p-2.5 text-xs leading-relaxed text-warning">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                        <span>{t("nset.push.masterOff")}</span>
                      </p>
                    )}

                    {/* A failed READ of the device list is not "no devices" —
                        sending someone to re-pair a phone over a database
                        blip is the wrong errand. */}
                    {testReport.queryFailed && (
                      <p className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-light p-2.5 text-xs leading-relaxed text-warning">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                        <span>{t("nset.push.queryFailed")}</span>
                      </p>
                    )}

                    {testReport.devices.length > 0 && !testReport.thisDeviceRegistered && (
                      <p className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-light p-2.5 text-xs leading-relaxed text-warning">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                        <span>{t("nset.push.notThisDevice")}</span>
                      </p>
                    )}

                    {testReport.devices.length === 0 ? (
                      !testReport.queryFailed && (
                        <p className="flex items-start gap-2 text-xs text-warning">
                          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                          <span>{t("nset.push.testNoDevices")}</span>
                        </p>
                      )
                    ) : (
                      testReport.devices.map((d) => (
                        <p
                          key={d.endpointTail}
                          className={`flex items-start gap-2 text-xs ${
                            d.status === "sent" ? "text-success" : "text-warning"
                          }`}
                        >
                          <span className="mt-0.5 shrink-0">
                            {d.status === "sent" ? "✓" : "✗"}
                          </span>
                          <span className="min-w-0 break-words">
                            <span className="font-mono">
                              {d.service} …{d.endpointTail}
                            </span>
                            {" — "}
                            {t(`nset.push.result.${d.status}` as TranslationKey)}
                            {d.code ? ` (${d.code})` : ""}
                            {d.isThisDevice && (
                              <strong> — {t("nset.push.thisDevice")}</strong>
                            )}
                          </span>
                        </p>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}

            {block && (
              <p className="flex items-start gap-2 text-xs text-warning">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>{t(`nset.push.${block}` as TranslationKey)}</span>
              </p>
            )}

            {!pushOnHere && !hardBlocked && (
              <p className="text-xs text-text-light">
                <span>{t("nset.push.grantHint")}</span>
              </p>
            )}

            {/*
              THE LAST RESORT, AND DELIBERATELY OUTSIDE THE `pushOnHere` GATE.

              Every other control here assumes the two halves of push agree:
              the browser holds a subscription and the server holds a row that
              describes it. This is for when they do not — and in that state
              the switch above often reads "off" on the very device you are
              trying to repair, so hiding the repair behind "on" would hide it
              exactly when it is needed.

              Destructive enough to warrant the warning underneath: it clears
              EVERY device on the account, not just this one, because a stale
              row on a handset you no longer own is invisible from here and is
              precisely the kind of thing that makes "sent" mean nothing.
            */}
            {!hardBlocked && (
              <div className="flex flex-col gap-2 border-t border-border pt-3">
                <Button
                  variant="outline"
                  size="sm"
                  loading={resetting}
                  disabled={resetting || testing}
                  onClick={() => void runReset()}
                  className="self-start"
                >
                  <RotateCcw className="size-3.5" aria-hidden />
                  <span>{t("nset.push.reset")}</span>
                </Button>
                <p className="text-xs leading-relaxed text-text-light">
                  <span>{t("nset.push.resetHint")}</span>
                </p>
              </div>
            )}

            {/* Apple's rule, and the single most common "it just does not
                work" on a phone: Safari only delivers push to an installed
                PWA, never to a normal tab. */}
            {!pushOnHere && typeof navigator !== "undefined" && isIOSDevice() && block !== "iosInstall" && (
              <p className="text-xs text-text-light">
                <span>{t("nset.push.iosHint")}</span>
              </p>
            )}
          </div>
        </div>

        {/* Pause — the temporary mute that saves people from "turn it off
            and forget to turn it back on". Expiry is implicit server-side. */}
        <div className="flex items-start gap-3 p-5">
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
            <Pause className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              <span>{t("nset.snooze.title")}</span>
            </p>
            <p className="mt-0.5 text-xs text-text-light">
              <span>{t("nset.snooze.body")}</span>
            </p>
            {snoozeActive ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge tone="warning">
                  <span>
                    {t("nset.snooze.active", {
                      time: new Date(channels.snoozedUntil as string).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      }),
                    })}
                  </span>
                </Badge>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => void snooze(null)}>
                  <span>{t("nset.snooze.cancel")}</span>
                </Button>
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                <Button variant="outline" size="sm" disabled={busy} onClick={() => void snooze(1)}>
                  <span>{t("nset.snooze.hour1")}</span>
                </Button>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => void snooze(8)}>
                  <span>{t("nset.snooze.hour8")}</span>
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Do not disturb — a nightly window with no push, Douala time.
            Essential alerts are exempt server-side; nothing is lost, the
            bell and email still land. */}
        <div className="flex items-start gap-3 p-5">
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
            <Moon className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              <span>{t("nset.quiet.title")}</span>
            </p>
            <p className="mt-0.5 text-xs text-text-light">
              <span>{t("nset.quiet.body")}</span>
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <label className="flex items-center gap-1.5">
                <span>{t("nset.quiet.from")}</span>
                <select
                  aria-label={t("nset.quiet.from")}
                  className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
                  disabled={busy}
                  value={quietStartHour ?? ""}
                  onChange={(e) => {
                    const value = e.target.value === "" ? null : Number(e.target.value);
                    saveQuietHours(value, value === null ? null : (quietEndHour ?? 7));
                  }}
                >
                  <option value="">{t("nset.quiet.off")}</option>
                  {HOURS.map((h) => (
                    <option key={h} value={h}>{`${String(h).padStart(2, "0")}h00`}</option>
                  ))}
                </select>
              </label>
              {quietStartHour !== null && (
                <label className="flex items-center gap-1.5">
                  <span>{t("nset.quiet.to")}</span>
                  <select
                    aria-label={t("nset.quiet.to")}
                    className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
                    disabled={busy}
                    value={quietEndHour ?? 7}
                    onChange={(e) => saveQuietHours(quietStartHour, Number(e.target.value))}
                  >
                    {HOURS.map((h) => (
                      <option key={h} value={h}>{`${String(h).padStart(2, "0")}h00`}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-border p-5">
        {allOff && (
          <p className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-light p-3 text-xs text-warning">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>{t("nset.allOff")}</span>
          </p>
        )}
        <p className="text-xs text-text-light">
          <span>{t("nset.footnote")}</span>
        </p>
      </div>
    </Panel>
  );
}

/** One channel: icon, name, one line of what it means, and its switch. */
function ChannelRow({
  icon,
  label,
  body,
  checked,
  disabled,
  onChange,
  bare,
}: {
  icon: React.ReactNode;
  label: string;
  body: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
  /** Skip the padding — the push row supplies its own wrapper. */
  bare?: boolean;
}) {
  return (
    <div className={bare ? "flex items-start gap-3" : "flex items-start gap-3 p-5"}>
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          <span>{label}</span>
        </p>
        <p className="mt-0.5 text-xs text-text-light">
          <span>{body}</span>
        </p>
      </div>
      <Switch
        label={label}
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        // The name is already the row's heading; repeating it beside the
        // switch would read it twice on every line.
        className="shrink-0 [&>span:last-child]:hidden"
      />
    </div>
  );
}
