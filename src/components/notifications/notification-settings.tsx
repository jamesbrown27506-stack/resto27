"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { AlertTriangle, Bell, BellRing, Mail, Smartphone } from "lucide-react";
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
  removePushSubscription,
  saveMyNotificationChannels,
  savePushSubscription,
  sendTestPush,
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
  const [testReport, setTestReport] = useState<Awaited<ReturnType<typeof sendTestPush>> | null>(null);

  async function runTest() {
    setTesting(true);
    setTestReport(null);
    const report = await sendTestPush().catch(() => null);
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
        if (subscription && Notification.permission === "granted") {
          const key = configuredVapidKey();
          if (key) {
            const repaired = await ensurePushSubscription(registration, key);
            await savePushSubscription(
              serializePushSubscription(repaired.subscription, repaired.previousEndpoint),
            ).catch(() => {});
            if (!cancelled) setDeviceSubscribed(true);
          }
        }
        if (!subscription && Notification.permission === "denied") setBlock("denied");
      } catch (error) {
        console.error("[push] state check failed", error);
      }
    })();

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

  async function disablePush() {
    if (!channels) return;
    touched.current = true;
    setBusy(true);

    const previous = channels;
    const next = { ...channels, push: false };
    setChannels(next);

    try {
      if ("serviceWorker" in navigator) {
        const registration = await navigator.serviceWorker.getRegistration("/sw.js");
        const subscription = await registration?.pushManager.getSubscription();
        if (subscription) {
          await removePushSubscription(subscription.endpoint).catch(() => {});
          await subscription.unsubscribe().catch(() => {});
        }
      }
      setDeviceSubscribed(false);
      setBlock(null);

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
                    {testReport.devices.length === 0 ? (
                      <p className="flex items-start gap-2 text-xs text-warning">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                        <span>{t("nset.push.testNoDevices")}</span>
                      </p>
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
