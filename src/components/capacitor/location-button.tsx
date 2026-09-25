"use client";

import { useState, useSyncExternalStore } from "react";
import { LocateFixed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNativeApp } from "@/lib/capacitor/native";
import { useLocale } from "@/lib/i18n/use-locale";

const MAP_LINK = /https:\/\/maps\.google\.com\/\?q=-?[\d.]+,-?[\d.]+/g;
const noSubscribe = () => () => {};

/** Geolocation exists in this browser — false on the server and while hydrating. */
function useWebGeolocation(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => typeof navigator !== "undefined" && "geolocation" in navigator && window.isSecureContext,
    () => false,
  );
}

/** The browser's own geolocation, as a promise, with a bounded wait. */
function webPosition(): Promise<{ latitude: number; longitude: number; accuracy: number }> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy }),
      reject,
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  });
}

/**
 * Adds a rider-readable map link to the existing landmark, only on request.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  IT USED TO EXIST ONLY IN THE ANDROID/iOS APP.
 *
 *  The button returned null outside Capacitor, so the majority of customers
 *  — ordering from a phone browser — never got the one tool that tells a
 *  rider exactly which gate. Browsers have had navigator.geolocation for a
 *  decade; it produces the same coordinates and therefore the same
 *  maps.google.com link. The native plugin stays first where it exists,
 *  because it can ask for the OS permission properly.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function LocationButton({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const native = useNativeApp();
  const web = useWebGeolocation();
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  if (!native && !web) return null;

  async function locate() {
    setBusy(true);
    setStatus("");
    try {
      let coords: { latitude: number; longitude: number; accuracy: number };
      if (native) {
        const { nativeDevice } = await import("@/lib/capacitor/device-apis");
        coords = (await nativeDevice.currentLocation()).coords;
      } else {
        coords = await webPosition();
      }
      const link = `https://maps.google.com/?q=${coords.latitude.toFixed(6)},${coords.longitude.toFixed(6)}`;
      // Replace only the previous map link; never silently truncate the landmark.
      const text = value.replace(MAP_LINK, "").replace(/\s*·\s*$/, "").trim();
      const next = [text, link].filter(Boolean).join(" · ");
      if (next.length > 120) {
        setStatus(t("sui.loc.tooLong"));
        return;
      }
      onChange(next);
      setStatus(t("sui.loc.added", { meters: Math.round(coords.accuracy) }));
    } catch (cause) {
      // GeolocationPositionError.PERMISSION_DENIED === 1: say how to fix it,
      // rather than the generic message that suggests trying again.
      const denied = typeof cause === "object" && cause !== null && (cause as { code?: number }).code === 1;
      setStatus(denied ? t("sui.loc.denied") : t("sui.loc.failed"));
    } finally {
      setBusy(false);
    }
  }

  return <div className="mt-2 space-y-1">
    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void locate()}>
      <LocateFixed className="size-4" aria-hidden />
      {busy ? t("sui.loc.busy") : t("sui.loc.add")}
    </Button>
    <p role="status" className="text-xs text-text-secondary">{status}</p>
  </div>;
}
