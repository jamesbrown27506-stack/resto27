"use client";

import { useState, useSyncExternalStore } from "react";
import { Battery } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/use-locale";
import { deviceSettingsAvailable, openBatterySettings } from "@/lib/notifications/device-settings";
import { useNativeApp } from "@/lib/capacitor/native";

export function BackgroundSettings() {
  const { locale } = useLocale();
  const fr = locale === "fr";
  const nativeApp = useNativeApp();
  const device = useSyncExternalStore(subscribe, getDevice, () => "desktop");
  const native = device === "native";
  const platform = native || device === "android" ? "android" : device === "ios" ? "ios" : null;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!platform) return null;
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <p className="flex items-center gap-2 text-xs font-semibold text-text-secondary">
        <Battery className="size-4" aria-hidden />
        {fr ? "Notifications en arrière-plan" : "Background notifications"}
      </p>
      <p className="text-xs leading-relaxed text-text-light">
        {platform === "android"
          ? fr
            ? "Si les alertes arrivent en retard, ouvrez Paramètres → Applications → Resto237 → Batterie, puis choisissez Sans restriction ou Autoriser l’activité en arrière-plan. Les noms varient selon le téléphone. Pour la version web, vérifiez aussi le navigateur utilisé."
            : "If alerts arrive late, open Settings → Apps → Resto237 → Battery, then choose Unrestricted or Allow background activity. Names vary by phone. For the web version, also check the browser you use."
          : nativeApp
            ? fr ? "Ouvrez Réglages → Notifications → Resto237. Vérifiez aussi les modes Concentration." : "Open Settings → Notifications → Resto237. Also check Focus modes."
          : fr
            ? "Sur iPhone, ajoutez le site à l’écran d’accueil, ouvrez-le depuis son icône et activez les notifications. Vérifiez aussi Réglages → Notifications et les modes Concentration."
            : "On iPhone, add the site to your Home Screen, open it from its icon and enable notifications. Also check Settings → Notifications and Focus modes."}
      </p>
      {native && (
        <Button variant="outline" size="sm" className="self-start" loading={busy} onClick={async () => {
          setBusy(true);
          setFailed(false);
          try { setFailed(!(await openBatterySettings())); }
          catch { setFailed(true); }
          finally { setBusy(false); }
        }}>
          {fr ? "Ouvrir les réglages de batterie" : "Open battery settings"}
        </Button>
      )}
      {failed && <p role="status" className="text-xs text-warning">{fr ? "Ouverture impossible. Suivez les étapes ci-dessus dans les paramètres du téléphone." : "Could not open settings. Follow the steps above in your phone settings."}</p>}
      <p className="text-xs leading-relaxed text-text-light">
        {fr
          ? "Vous choisissez le réglage sur votre téléphone. Cela peut augmenter la consommation de batterie et ne garantit pas une exécution continue. Revenez ensuite et envoyez une notification de test, puis testez avec l’écran verrouillé."
          : "You choose the setting on your phone. This may use more battery and does not guarantee continuous execution. Return here to send a test notification, then test with the screen locked."}
      </p>
    </div>
  );
}

// The bridge is installed before page load; the platform is stable for this document.
const subscribe = () => () => {};
function getDevice(): string {
  if (deviceSettingsAvailable()) return "native";
  if (/Android/i.test(navigator.userAgent)) return "android";
  if (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "ios";
  return "desktop";
}
