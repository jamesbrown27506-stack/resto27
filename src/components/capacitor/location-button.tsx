"use client";

import { useState } from "react";
import { LocateFixed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNativeApp } from "@/lib/capacitor/native";
import { useLocale } from "@/lib/i18n/use-locale";

/** Adds a rider-readable map link to the existing landmark, only on request. */
export function LocationButton({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const native = useNativeApp();
  const { locale } = useLocale();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  if (!native) return null;
  async function locate() {
    setBusy(true);
    setStatus("");
    try {
      const { nativeDevice } = await import("@/lib/capacitor/device-apis");
      const { coords } = await nativeDevice.currentLocation();
      const link = `https://maps.google.com/?q=${coords.latitude.toFixed(6)},${coords.longitude.toFixed(6)}`;
      // Replace only the previous map link; never silently truncate the landmark.
      const text = value.replace(/https:\/\/maps\.google\.com\/\?q=-?[\d.]+,-?[\d.]+/g, "").trim();
      const next = [text, link].filter(Boolean).join(" · ");
      if (next.length > 120) {
        setStatus(locale === "fr" ? "Raccourcissez le repère avant d'ajouter votre position." : "Shorten the landmark before adding your location.");
        return;
      }
      onChange(next);
      setStatus(locale === "fr"
        ? `Position ajoutée (précision : ${Math.round(coords.accuracy)} m). Vérifiez aussi votre adresse.`
        : `Location added (accuracy: ${Math.round(coords.accuracy)} m). Check your street address too.`);
    } catch {
      setStatus(locale === "fr" ? "Position indisponible. Vérifiez les autorisations ou saisissez votre repère." : "Location unavailable. Check permissions or enter your landmark manually.");
    } finally { setBusy(false); }
  }
  return <div className="mt-2 space-y-1">
    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void locate()}>
      <LocateFixed className="size-4" aria-hidden />
      {busy ? (locale === "fr" ? "Localisation…" : "Locating…") : (locale === "fr" ? "Ajouter ma position au repère" : "Add my location to landmark")}
    </Button>
    <p role="status" className="text-xs text-text-secondary">{status}</p>
  </div>;
}
