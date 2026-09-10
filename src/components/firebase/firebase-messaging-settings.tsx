"use client";

import { useState } from "react";
import { BellRing, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/use-locale";
import {
  firebaseMessagingConfigured,
  type FirebaseMessagingResult,
} from "@/lib/firebase/messaging";

import { syncFirebaseDevice } from "@/lib/firebase/device";
import { useNativeApp } from "@/lib/capacitor/native";

function messageFor(result: Exclude<FirebaseMessagingResult, { ok: true }>, fr: boolean): string {
  const messages = {
    unsupported: fr ? "Cloud Messaging n’est pas pris en charge par ce navigateur." : "Cloud Messaging is not supported by this browser.",
    insecure: fr ? "Ouvrez le site en HTTPS pour activer Cloud Messaging." : "Open the site over HTTPS to enable Cloud Messaging.",
    missingVapid: fr ? "Ajoutez d’abord la clé VAPID Web Push de Firebase." : "Add the Firebase Web Push VAPID key first.",
    denied: fr ? "Les notifications sont bloquées dans le navigateur." : "Notifications are blocked in this browser.",
    failed: fr ? "Firebase n’a pas pu créer le jeton de cet appareil." : "Firebase could not create a token for this device.",
  };
  return messages[result.reason];
}

export function FirebaseMessagingSettings() {
  const { locale } = useLocale();
  const fr = locale === "fr";
  const native = useNativeApp();
  const configured = native || firebaseMessagingConfigured();
  const [token, setToken] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function enable() {
    setBusy(true);
    setMessage(null);
    const result = await syncFirebaseDevice(true).catch(() => ({ ok: false as const, reason: "failed" as const }));
    setBusy(false);
    if (result.ok) {
      setToken(result.token);
      setMessage(fr ? "Cet appareil est enregistré auprès de Firebase." : "This device is registered with Firebase.");
    } else {
      setMessage(result.reason === "storage" ? result.error ?? "Device storage unavailable" : messageFor(result, fr));
    }
  }

  async function copy() {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setMessage(fr ? "Jeton copié. Collez-le dans « Send test message » sur Firebase." : "Token copied. Paste it into Firebase’s Send test message box.");
    } catch {
      setMessage(fr ? "Copiez le jeton affiché ci-dessous." : "Copy the token shown below.");
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <p className="flex items-center gap-2 text-xs font-semibold text-text-secondary">
        <BellRing className="size-4" aria-hidden />
        {fr ? "Firebase Cloud Messaging" : "Firebase Cloud Messaging"}
      </p>
      <p className="text-xs leading-relaxed text-text-light">
        {fr
          ? native
            ? "Enregistrez cette application auprès de Firebase pour recevoir les alertes natives."
            : "Enregistrez cet appareil pour recevoir les alertes lorsque l’administrateur sélectionne Firebase. Activez aussi les notifications push ci-dessus."
          : native
            ? "Register this app with Firebase to receive native alerts."
            : "Register this device to receive alerts when the administrator selects Firebase. Also enable push notifications above."}
      </p>
      {!native && !configured && (
        <p role="status" className="text-xs text-warning">
          {fr
            ? "Configuration requise : ajoutez NEXT_PUBLIC_FIREBASE_VAPID_KEY puis redéployez l’application."
            : "Setup required: add NEXT_PUBLIC_FIREBASE_VAPID_KEY, then redeploy the app."}
        </p>
      )}
      <Button variant="outline" size="sm" className="self-start" disabled={!configured} loading={busy} onClick={() => void enable()}>
        {token ? (fr ? "Actualiser le jeton Firebase" : "Refresh Firebase token") : (fr ? "Enregistrer cet appareil" : "Register this device")}
      </Button>
      {token && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-surface p-2">
          <code className="min-w-0 flex-1 break-all text-[11px] text-text-secondary">{token}</code>
          <Button variant="ghost" size="icon-sm" aria-label={fr ? "Copier le jeton Firebase" : "Copy Firebase token"} onClick={() => void copy()}>
            <Copy className="size-4" aria-hidden />
          </Button>
        </div>
      )}
      {message && <p role="status" className="text-xs text-text-light">{message}</p>}
    </div>
  );
}
