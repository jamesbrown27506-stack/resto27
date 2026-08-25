"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { getNotificationState } from "@/lib/data/notify-actions";
import { useToast } from "@/components/ui/toast";
import {
  playNotificationSound,
  unlockNotificationSound,
} from "@/lib/notifications/sound-player";
import type { NotifyTone } from "@/lib/notify";
import { registerPushWorker } from "@/lib/notifications/web-push-client";

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
  /**
   * True when the browser refused the last sound because nobody has clicked
   * the page yet. Actionable, so it is surfaced rather than swallowed.
   */
  soundBlocked: boolean;
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

/** How long one event stays "already announced". See `announce` below. */
const DEDUPE_WINDOW_MS = 10_000;

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

  /*
    ─────────────────────────────────────────────────────────────────────────
     THE SOUND IS UNLOCKED ONCE, ON THE FIRST INTERACTION, AND REUSED.

     Browsers refuse audio from a page the user has never interacted with, and
     they are strictest about exactly the case that matters here: a cold
     `new Audio()` asked to start playing in a tab nobody has touched for ten
     minutes. `unlockNotificationSound` plays one MUTED pass through a single
     shared element while the user's first click is still on the stack, and
     from then on that element is one the browser has already let play.

     This is the whole trick behind a web app that can ding while you are in
     another application — see lib/notifications/sound-player.
    ─────────────────────────────────────────────────────────────────────────
  */
  const [soundBlocked, setSoundBlocked] = useState(false);

  useEffect(() => {
    const unlock = () => {
      unlockNotificationSound(soundRef.current);
      setSoundBlocked(false);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  /*
    ─────────────────────────────────────────────────────────────────────────
     THE BELL DIES WITH THE TAB. THE APP ICON DOES NOT.

     On an installed PWA the taskbar / home-screen icon can carry an unread
     badge of its own (Windows taskbar, Android launcher, macOS dock). Until
     now only the in-page bell knew about unread items, so an installed app
     with three unseen orders looked exactly like an installed app with
     nothing to report. This mirrors `unread` onto the icon whenever it
     changes — including when a push arrives into a hidden tab, because
     announce() bumps the same state.

     Feature-detected and fenced: browsers without setAppBadge simply keep
     the old behaviour, and a rejection here must never break rendering.
    ─────────────────────────────────────────────────────────────────────────
  */
  useEffect(() => {
    const nav = navigator as Navigator & {
      setAppBadge?: (count?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (typeof nav.setAppBadge !== "function" || typeof nav.clearAppBadge !== "function") return;
    try {
      if (unread > 0) void nav.setAppBadge(unread).catch(() => {});
      else void nav.clearAppBadge().catch(() => {});
    } catch {
      // Unsupported platform — the bell remains the only indicator.
    }
  }, [unread]);

  /*
     NO `document.hidden` CHECK. It used to be the first thing this function
     did, and it was the bug: a hidden tab is the entire reason the sound
     exists. A restaurant with the orders tab open behind their WhatsApp is
     the normal case, not the exception, and silence there means a missed
     order.

     `force` is gone too — it only existed to bypass the hidden check for the
     settings preview, and there is nothing left to bypass.
  */
  const play = useCallback(() => {
    void playNotificationSound(soundRef.current).then((result) => {
      // Surfaced rather than swallowed: "you must click the page once before
      // it can make a sound" is something the person can act on, and the
      // diagnostics screen can now say it out loud.
      setSoundBlocked(result === "blocked");
    });
  }, []);

  /*
    ─────────────────────────────────────────────────────────────────────────
     ONE EVENT CAN ARRIVE TWICE, SO IT IS ANNOUNCED ONCE.

     A signed-in manager with the tab open AND push subscribed gets the same
     new order down two paths within about a second: the realtime row, and the
     service worker's postMessage. Without this they hear two dings and read
     two toasts for one order, which reads as a glitchy app.

     Keyed on title+body — the payloads carry no id — and remembered for ten
     seconds, which is far longer than the gap between the two paths and short
     enough that a genuinely repeated event still announces itself. Two
     identical notifications inside ten seconds collapsing to one ding is the
     better outcome anyway.
    ─────────────────────────────────────────────────────────────────────────
  */
  const seenRef = useRef(new Map<string, number>());

  const announce = useCallback(
    (title: string, body: string, tone: NotifyTone) => {
      const key = `${title}\u0000${body}`;
      const now = Date.now();

      for (const [k, at] of seenRef.current) {
        if (now - at > DEDUPE_WINDOW_MS) seenRef.current.delete(k);
      }
      if (seenRef.current.has(key)) return;
      seenRef.current.set(key, now);

      setUnread((u) => u + 1);
      setLastEventAt(new Date());
      toast(title, tone);
      play();
    },
    [toast, play],
  );

  /*
    ─────────────────────────────────────────────────────────────────────────
     THE SERVICE WORKER TELLS THE PAGE, because a push wakes the WORKER and
     not the page.

     This is the half that was missing. The tab was open the whole time and
     perfectly capable of playing a sound; it simply had no idea a push had
     landed. sw.js now posts every push to every open client, so a tab sitting
     behind another application announces the order the moment it arrives —
     with the restaurant's own chosen sound, not the generic OS blip.
    ─────────────────────────────────────────────────────────────────────────
  */
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.type !== "restolink:notification") return;
      announce(String(data.title ?? ""), String(data.body ?? ""), (data.tone ?? "info") as NotifyTone);
    };

    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [announce]);

  useEffect(() => {
    let channel: RealtimeChannel | null = null;
    let cancelled = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let profileId: string | null = null;

    // Register the service worker on every signed-in page load, not only when
    // someone toggles push in settings. A subscription saved on another device
    // — or a push the user never opted out of — must still wake the worker
    // when the message arrives; an unregistered worker silently drops it.
    if ("serviceWorker" in navigator) {
      void registerPushWorker().catch(() => {});
    }

    const supabase = createClient();

    async function refreshState() {
      const state = await getNotificationState().catch((error: unknown) => {
        console.error("[notify] could not refresh notification state", error);
        return null;
      });
      if (cancelled || !state?.profileId) return null;
      setSoundName(state.sound);
      setUnread(state.unread);
      return state;
    }

    /**
     * Realtime authorizes the channel with the access token it had when the
     * socket joined. Retrying that same channel with the same expired token is
     * not recovery. Refresh first, then explicitly put the new JWT on the
     * Realtime connection before rejoining.
     */
    async function authorizeRealtime(forceRefresh: boolean): Promise<boolean> {
      const { data, error: sessionError } = await supabase.auth.getSession();
      let error = sessionError;
      let session = data.session;
      const expiresSoon = !session?.expires_at || session.expires_at <= Date.now() / 1000 + 60;

      if (!error && session && (forceRefresh || expiresSoon)) {
        const refreshed = await supabase.auth.refreshSession();
        error = refreshed.error;
        session = refreshed.data.session;
      }

      if (error || !session?.access_token) {
        console.warn("[notify] realtime auth refresh failed", error?.message ?? "no session");
        return false;
      }

      await supabase.realtime.setAuth(session.access_token);
      return true;
    }

    function retire(target: RealtimeChannel | null) {
      if (!target) return;
      if (channel === target) channel = null;
      // Setting `channel` to null first makes the CLOSED callback from this
      // intentional removal stale, so it cannot schedule another retry.
      void supabase.removeChannel(target);
    }

    function scheduleReconnect(detail: string, forceRefresh: boolean) {
      if (cancelled || !profileId || retryTimer) return;
      setRealtime("error");
      console.warn("[notify] realtime channel", detail);

      const delay = BACKOFF[Math.min(attempt, BACKOFF.length - 1)];
      attempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void connect(forceRefresh);
      }, delay);
    }

    async function connect(forceRefresh = false) {
      const id = profileId;
      if (cancelled || !id) return;
      setRealtime("connecting");

      if (!(await authorizeRealtime(forceRefresh))) {
        if (!cancelled) scheduleReconnect("AUTH_REFRESH_FAILED", true);
        return;
      }
      if (cancelled || profileId !== id) return;

      retire(channel);
      const next = supabase
        .channel(`notifications-${id}-${Date.now()}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `profile_id=eq.${id}`,
          },
          (payload) => {
            const row = payload.new as { title: string; body: string; tone: NotifyTone };
            announce(row.title, row.body ?? "", row.tone);
          },
        )
        .subscribe((status, error) => {
          // Status callbacks from a channel we intentionally removed are not
          // failures. Ignoring them is what prevents the retry explosion that
          // previously produced hundreds of CLOSED events.
          if (cancelled || channel !== next) return;
          setRealtimeDetail(error?.message ? `${status}: ${error.message}` : status);

          if (status === "SUBSCRIBED") {
            attempt = 0;
            setRealtime("connected");
            // Any rows created while the socket was down were missed by
            // Realtime but not by the database. Re-read the exact count now.
            void refreshState();
            return;
          }

          // CHANNEL_ERROR, TIMED_OUT and an unexpected CLOSED all mean "no
          // notifications will arrive in this tab". Say so, then retry —
          // a socket dropped by a sleeping laptop must not need a reload.
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            const detail = `${status}${error?.message ? `: ${error.message}` : ""}`;
            const tokenError = /jwt|token|expired|unauthor/i.test(error?.message ?? "");
            retire(next);
            scheduleReconnect(detail, tokenError);
          }
        });
      channel = next;
    }

    void (async () => {
      const state = await refreshState();
      if (cancelled) return;

      if (!state?.profileId) {
        // Nobody signed in, or the action failed. Either way there is nothing
        // to subscribe to — and now it says which, instead of looking idle.
        setRealtime("signed-out");
        return;
      }

      profileId = state.profileId;
      void connect();
    })();

    // The Supabase client normally forwards refreshed auth tokens to Realtime.
    // Keep the channel explicit as well: this listener covers refreshes caused
    // by another tab and lets an already-open socket update in-band.
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if ((event === "TOKEN_REFRESHED" || event === "SIGNED_IN") && session?.access_token) {
        void supabase.realtime.setAuth(session.access_token);
      }
      if (event === "SIGNED_OUT") {
        retire(channel);
        setRealtime("signed-out");
      }
    });

    /*
      ─────────────────────────────────────────────────────────────────────
       A SOCKET CAN DIE QUIETLY WHILE THE TAB IS IN THE BACKGROUND.

       Chrome clamps timers in a tab hidden for more than five minutes to one
       tick a minute. Realtime's heartbeat is a timer, so a long-backgrounded
       tab can miss enough beats for the server to hang up — and the retry
       that would fix it is a timer too, so recovery crawls at the same
       throttled pace. The tab looks connected and silently is not.

       Coming back to the tab, or the network returning, is a reliable moment
       to distrust the channel and rebuild it. Cheap, and it converts "I
       reloaded and then it worked" into something that never needed a reload.

       This is belt and braces, not the main defence: web push does not depend
       on page timers at all, and now that sw.js forwards every push to the
       page, a dead channel no longer means a silent one.
      ─────────────────────────────────────────────────────────────────────
    */
    function revive() {
      if (cancelled || !profileId) return;
      if (typeof document !== "undefined" && document.hidden) return;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      attempt = 0;
      retire(channel);
      void connect();
    }

    const onVisible = () => {
      if (!document.hidden) revive();
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", revive);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", revive);
      authListener.subscription.unsubscribe();
      if (retryTimer) clearTimeout(retryTimer);
      retire(channel);
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
        soundBlocked,
        playSound: () => play(),
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}
