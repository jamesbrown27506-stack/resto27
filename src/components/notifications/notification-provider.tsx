"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { getNotificationState } from "@/lib/data/notify-actions";
import { useToast } from "@/components/ui/toast";
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
 *  EVERY SHELL MOUNTS ITS OWN PROVIDER (manager top bar, admin top bar,
 *  customer header). Each is a self-contained region, so there is no shared
 *  global state to leak between roles.
 * ─────────────────────────────────────────────────────────────────────────
 */

interface NotificationContextValue {
  unread: number;
  soundName: string;
  decrementUnread: () => void;
  clearUnread: () => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotifications must be used inside <NotificationProvider>");
  return ctx;
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { toast } = useToast();
  const [unread, setUnread] = useState(0);
  const [soundName, setSoundName] = useState("chime");

  const soundRef = useRef(soundName);
  soundRef.current = soundName;

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

  useEffect(() => {
    let channel: RealtimeChannel | null = null;
    let cancelled = false;

    // Register the service worker on every signed-in page load, not only when
    // someone toggles push in settings. A subscription saved on another device
    // — or a push the user never opted out of — must still wake the worker
    // when the message arrives; an unregistered worker silently drops it.
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    (async () => {
      const state = await getNotificationState().catch(() => null);
      if (cancelled) return;
      if (!state?.profileId) return;

      setSoundName(state.sound);
      setUnread(state.unread);

      const supabase = createClient();
      channel = supabase
        .channel(`notifications-${state.profileId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `profile_id=eq.${state.profileId}`,
          },
          (payload) => {
            const row = payload.new as {
              title: string;
              body: string;
              tone: NotifyTone;
            };
            setUnread((u) => u + 1);
            toast(row.title, row.tone);
            if (!document.hidden && unlockedRef.current) {
              try {
                const audio = new Audio(`/sounds/${soundRef.current}.wav`);
                audio.volume = 0.6;
                void audio.play().catch(() => {});
              } catch {
                // Audio is a convenience; a failed play must never throw up.
              }
            }
          },
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      void channel?.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <NotificationContext.Provider
      value={{
        unread,
        soundName,
        decrementUnread: () => setUnread((u) => Math.max(0, u - 1)),
        clearUnread: () => setUnread(0),
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}
