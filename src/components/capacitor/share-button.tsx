"use client";

import { useState } from "react";
import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/use-locale";
import { isNativeApp } from "@/lib/capacitor/native";

export function ShareButton({ title, url }: { title: string; url: string }) {
  const { locale } = useLocale();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  async function share() {
    setBusy(true);
    setStatus("");
    try {
      if (isNativeApp()) {
        const { Share } = await import("@capacitor/share");
        await Share.share({ title, url, dialogTitle: title });
      } else if (navigator.share) await navigator.share({ title, url });
      else {
        await navigator.clipboard.writeText(url);
        setStatus(locale === "fr" ? "Lien copié" : "Link copied");
      }
    } catch (error) {
      if (!/cancel|abort/i.test(String(error))) setStatus(locale === "fr" ? "Partage indisponible" : "Sharing unavailable");
    } finally { setBusy(false); }
  }
  return <span className="inline-flex items-center gap-2">
    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void share()}>
      <Share2 className="size-4" aria-hidden />{locale === "fr" ? "Partager" : "Share"}
    </Button>
    <span role="status" className="text-xs text-text-secondary">{status}</span>
  </span>;
}
