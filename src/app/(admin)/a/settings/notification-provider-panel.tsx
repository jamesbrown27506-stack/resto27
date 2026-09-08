"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { getNotificationProviderStatus, setNotificationProvider, testNotificationProvider } from "@/lib/data/notification-provider-actions";

type Status = Awaited<ReturnType<typeof getNotificationProviderStatus>>;

export function NotificationProviderPanel({ initial }: { initial: Status }) {
  const [status, setStatus] = useState(initial);
  const [choice, setChoice] = useState(initial.provider);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function run(test?: "web_push" | "firebase") {
    setBusy(true);
    try {
      if (test) setMessage((await testNotificationProvider(test)).message);
      else {
        const result = await setNotificationProvider(choice);
        setMessage(result.ok ? "Notification provider saved." : result.error ?? "Could not save.");
      }
      setStatus(await getNotificationProviderStatus());
    } catch { setMessage("Could not complete the request. Please try again."); }
    finally { setBusy(false); }
  }
  return <section className="mb-6 space-y-3 rounded-xl border border-border bg-surface p-5">
    <h2 className="font-semibold">Notification delivery</h2>
    <p className="text-sm text-text-secondary">Choose the provider for all operational push alerts. In-app and email notifications keep their own preferences. Tests below send only to your administrator account and do not change the active provider.</p>
    <p className="text-sm">Active: <strong>{status.provider === "firebase" ? "Firebase Cloud Messaging" : "Resto237 Web Push"}</strong></p>
    <label className="flex flex-col gap-1 text-sm">Push provider
      <select className="rounded border border-border bg-surface p-2" value={choice} disabled={busy} onChange={e => setChoice(e.target.value as Status["provider"])}>
        <option value="web_push">Resto237 Web Push</option>
        <option value="firebase">Firebase Cloud Messaging</option>
      </select>
    </label>
    <p className="text-xs text-text-secondary">Registered devices: Web Push {status.webDevices} · Firebase {status.firebaseDevices}. Devices must register with Firebase before they can receive Firebase alerts; there is no automatic fallback during comparison.</p>
    {(!status.firebaseConfigured || !status.storageReady) && <p role="status" className="text-sm text-warning">
      Firebase setup pending: {!status.firebaseConfigured && "add FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY to the server environment. "}
      {!status.storageReady && "Apply Supabase migration 0045. "}Then redeploy and register a device in notification settings.
    </p>}
    <div className="flex flex-wrap gap-2">
      <Button size="sm" disabled={busy} onClick={() => void run()}>Save provider</Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void run("web_push")}>Test Web Push</Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void run("firebase")}>Test Firebase</Button>
    </div>
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}
