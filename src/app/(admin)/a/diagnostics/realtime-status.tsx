"use client";

import { Radio, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNotifications } from "@/components/notifications/notification-provider";
import { notificationSoundUrl } from "@/lib/notification-sound";
import { cn } from "@/lib/utils";

/**
 * Is realtime actually reaching THIS browser?
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE QUESTION THE TESTER COULD NOT ANSWER.
 *
 *  Every button below sends a real notification and reports what the SERVER
 *  did — how many rows it wrote, which channels it used. None of that tells
 *  you whether the row then travelled back down the websocket to the tab you
 *  are looking at, and that is the half that breaks: a table missing from
 *  the `supabase_realtime` publication, an RLS policy the browser's token
 *  does not satisfy, a socket a sleeping laptop dropped. All three look
 *  identical from the server side — delivered, and then nothing happens.
 *
 *  This reads the live channel state straight from the provider, so
 *  "delivered but no toast" resolves into a specific fault instead of a
 *  shrug. The sound gets its own button for the same reason: a missing or
 *  autoplay-blocked audio file is a different problem from a dead channel,
 *  and hearing it here separates the two in one tap.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function RealtimeStatus() {
  const { realtime, realtimeDetail, lastEventAt, soundName, playSound } = useNotifications();

  const tone =
    realtime === "connected"
      ? "border-success/30 bg-success-light text-success"
      : realtime === "connecting"
        ? "border-border bg-surface-2 text-text-secondary"
        : "border-error/30 bg-error-light text-error";

  const label =
    realtime === "connected"
      ? "Connected — this tab will receive notifications live"
      : realtime === "connecting"
        ? "Connecting…"
        : realtime === "signed-out"
          ? "Not subscribed — no session, or the state action failed"
          : "Not connected — nothing will arrive live in this tab";

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-surface-2 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[11px] font-bold tracking-[0.08em] text-text-light uppercase">
          Realtime
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold",
            tone,
          )}
        >
          <Radio className="size-3.5" aria-hidden />
          <span>{label}</span>
        </span>
      </div>

      <dl className="grid gap-1 text-xs text-text-secondary sm:grid-cols-2">
        <div className="flex gap-2">
          <dt className="text-text-light">Channel status</dt>
          <dd className="font-mono">{realtimeDetail ?? "—"}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-text-light">Last live event</dt>
          <dd className="tnum">
            {lastEventAt ? lastEventAt.toLocaleTimeString() : "none in this tab yet"}
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={playSound}>
          <Volume2 className="size-4" aria-hidden />
          <span>Play the notification sound</span>
        </Button>
        <span className="font-mono text-[10px] text-text-light">
          {notificationSoundUrl(soundName)}
        </span>
      </div>

      <p className="text-xs leading-relaxed text-text-light">
        If this says <strong className="text-text">Not connected</strong>, the server is fine and
        the browser link is not: check that <code>notifications</code> is ticked under{" "}
        <strong className="text-text">Database → Replication → supabase_realtime</strong>, and that
        migration <code>0018</code>&apos;s RLS policy on <code>notifications</code> exists — the bell
        badge reads through the server and keeps working either way, which is what makes this
        failure so easy to miss.
      </p>
    </div>
  );
}
