"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { getNotificationState } from "@/lib/data/notify-actions";
import { useToast } from "@/components/ui/toast";
import { notificationSoundUrl } from "@/lib/notification-sound";
import type { NotifyTone } from "@/lib/notify";

/**
 * The realtime engine behind the bell.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHAT THIS COMPONENT OWNS:
 *
 *   · the unread count — seeded from the server, then kept live by a
 *     Supabase Realtime subscription on new rows in the notifications table
 *     (the browser client, RLS-scoped to this person's own rows — migration
 *     0018's policy);
 *   · the platform notification sound — read from settings, played on every
 *     new row while the tab is open and audible;
 *   · the transient toast that announces a new notification without the
 *     user having to look at the bell.
 *
 *  EVERY SHELL MOUNTS ITS OWN PROVIDER (manager, admin, customer). Each is a
 *  self-contained region, so there is no shared global state to leak between
 *  roles.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  IT NO LONGER FAILS IN SILENCE, AND THAT IS THE POINT OF THIS VERSION.
 *
 *  The subscription used to be `.subscribe()` with no status callback and
 *  `.catch(() => null)` on the state fetch. So when the channel could not
 *  connect — a dropped socket, an expired token, a table missing from the
 *  realtime publication, an RLS policy that does not match — the app looked
 *  exactly like an app with nothing to report: no toast, no sound, no error,
 *  nothing in the console. "Realtime stopped working" was unfalsifiable from
 *  the outside, and the bell badge kept working because it is read on the
 *  SERVER with the service key, which hides the browser-side failure
 *  completely.
 *
 *  Now the status is captured, logged, exposed on the context (so
 *  /a/diagnostics can show it), and RETRIED with backoff. A channel that
 *  drops comes back on its own instead of staying dead until a reload.
 * ─────────────────────────────────────────────────────────────────────────
 */

export type RealtimeStatus = "connecting" | "connected" | "error" | "signed-out";

interface NotificationContextValue {
  unread: number;
  /** The stored setting: a built-in name, or the URL of an uploaded file. */
  soundName: string;
  /** Live health of the browser's realtime channel. */
  realtime: RealtimeStatus;
  /** The last status the channel reported, verbatim — for diagnostics. */
  realtimeDetail: string | null;
  /** When a realtime row last arrived in this tab, if any. */
  lastEventAt: Date | null;
  decrementUnread: () => void;
  clearUnread: () => void;
  /** Play the configured sound now — the settings preview and diagnostics. */
  playSound: () => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotifications must be used inside <NotificationProvider>");
  return ctx;
}

/** Reconnect delays, in ms. The last value repeats for every later attempt. */
const BACKOFF = [2_000, 5_000, 10_000, 30_000];

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { toast } = useToast();
  const [unread, setUnread] = useState(0);
  const [soundName, setSoundName] = useState("chime");
  const [realtime, setRealtime] = useState<RealtimeStatus>("connecting");
  const [realtimeDetail, setRealtimeDetail] = useState<string | null>(null);
  const [lastEventAt, setLastEventAt] = useState<Date | null>(null);

  // Read inside the realtime callback, which is created once and must not
  // close over a stale sound. A ref, updated by an effect — never assigned
  // during render, which would be a write to a value React is still using.
  const soundRef = useRef(soundName);
  useEffect(() => {
    soundRef.current = soundName;
  }, [soundName]);

  // Browsers block audio until the user has interacted with the page at least
  // once. A realtime ding on a tab nobody has touched yet is refused by the
  // autoplay policy — and there is nothing to announce to: the tab is not
  // even being looked at. The first pointer or key interaction unlocks sound
  // for the rest of the visit.
  const unlockedRef = useRef(false);
  useEffect(() => {
    const unlock = () => {
      unlockedRef.current = true;
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  const play = useCallback((force = false) => {
    if (!force && (document.hidden || !unlockedRef.current)) return;
    try {
      const audio = new Audio(notificationSoundUrl(soundRef.current));
      audio.volume = 0.6;
      void audio.play().catch((error) => {
        // Autoplay refusal is expected and silent; a 404 on the file is not.
        if ((error as Error)?.name !== "NotAllowedError") {
          console.warn("[notify] sound failed", soundRef.current, error);
        }
      });
    } catch {
      // Audio is a convenience; a failed play must never throw up.
    }
  }, []);

  useEffect(() => {
    let channel: RealtimeChannel | null = null;
    let cancelled = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    // Register the service worker on every signed-in page load, not only when
    // someone toggles push in settings. A subscription saved on another device
    // — or a push the user never opted out of — must still wake the worker
    // when the message arrives; an unregistered worker silently drops it.
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    const supabase = createClient();

    function connect(profileId: string) {
      if (cancelled) return;

      channel = supabase
        .channel(`notifications-${profileId}-${attempt}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `profile_id=eq.${profileId}`,
          },
          (payload) => {
            const row = payload.new as { title: string; body: string; tone: NotifyTone };
            setUnread((u) => u + 1);
            setLastEventAt(new Date());
            toast(row.title, row.tone);
            play();
          },
        )
        .subscribe((status, error) => {
          if (cancelled) return;
          setRealtimeDetail(error?.message ? `${status}: ${error.message}` : status);

          if (status === "SUBSCRIBED") {
            attempt = 0;
            setRealtime("connected");
            return;
          }

          // CHANNEL_ERROR, TIMED_OUT and an unexpected CLOSED all mean "no
          // notifications will arrive in this tab". Say so, then retry —
          // a socket dropped by a sleeping laptop must not need a reload.
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            setRealtime("error");
            console.warn("[notify] realtime channel", status, error?.message ?? "");

            const delay = BACKOFF[Math.min(attempt, BACKOFF.length - 1)];
            attempt += 1;
            retryTimer = setTimeout(() => {
              if (cancelled) return;
              const dead = channel;
              channel = null;
              if (dead) void supabase.removeChannel(dead);
              setRealtime("connecting");
              connect(profileId);
            }, delay);
          }
        });
    }

    void (async () => {
      const state = await getNotificationState().catch((error: unknown) => {
        console.error("[notify] could not read notification state", error);
        return null;
      });
      if (cancelled) return;

      if (!state?.profileId) {
        // Nobody signed in, or the action failed. Either way there is nothing
        // to subscribe to — and now it says which, instead of looking idle.
        setRealtime("signed-out");
        return;
      }

      setSoundName(state.sound);
      setUnread(state.unread);
      connect(state.profileId);
    })();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (channel) void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <NotificationContext.Provider
      value={{
        unread,
        soundName,
        realtime,
        realtimeDetail,
        lastEventAt,
        decrementUnread: () => setUnread((u) => Math.max(0, u - 1)),
        clearUnread: () => setUnread(0),
        // Forced: a preview button IS the user interaction, so the autoplay
        // and hidden-tab guards do not apply to it.
        playSound: () => play(true),
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}
