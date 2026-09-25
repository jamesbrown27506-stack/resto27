"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

/**
 * "SOMETHING CHANGED AT THIS RESTAURANT" — one live channel per branch (0066).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  Replaces clock polling in the back office. Database triggers bump
 *  `restaurant_signals.version` whenever orders, bookings, table requests or
 *  chats change; this module holds ONE Supabase Realtime subscription to the
 *  active branch's row and tells every interested screen (nav badges, orders
 *  queue, kitchen, dining floor, pending-order alarm) to re-read. Realtime
 *  costs Vercel nothing; each re-read is one call made because something
 *  actually changed.
 *
 *  `useSignalLive()` says whether the channel is up AND the migration is in
 *  (the nav-count read reports `signals: true`). While it is not, every
 *  screen keeps its old polling interval — the fallback is the previous
 *  behaviour, never silence.
 * ─────────────────────────────────────────────────────────────────────────
 */

type Listener = () => void;

const EMIT_DEBOUNCE_MS = 800;
const BACKOFF_MS = [3_000, 10_000, 30_000, 60_000];

let restaurantId: string | null = null;
let channel: RealtimeChannel | null = null;
let connected = false;
let available = false; // the table exists (reported by the nav-count read)
let refs = 0;
let attempt = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let emitTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<Listener>();
const liveListeners = new Set<Listener>();

function setConnected(value: boolean) {
  if (connected === value) return;
  connected = value;
  liveListeners.forEach((l) => l());
}

function emit() {
  if (emitTimer) clearTimeout(emitTimer);
  emitTimer = setTimeout(() => {
    emitTimer = null;
    listeners.forEach((l) => {
      try {
        l();
      } catch (error) {
        console.error("[signal] listener failed", error);
      }
    });
  }, EMIT_DEBOUNCE_MS);
}

function teardown() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  const old = channel;
  channel = null;
  setConnected(false);
  if (old) void createClient().removeChannel(old);
}

async function connect() {
  const id = restaurantId;
  if (!id || !available) return;
  const supabase = createClient();
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) await supabase.realtime.setAuth(data.session.access_token);
  } catch {
    // Subscribing without a fresh token is tried anyway; a refusal retries.
  }
  if (restaurantId !== id) return;

  const next = supabase
    .channel(`restaurant-signal-${id}-${Date.now()}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "restaurant_signals", filter: `restaurant_id=eq.${id}` },
      () => emit(),
    )
    .subscribe((status) => {
      if (channel !== next) return;
      if (status === "SUBSCRIBED") {
        attempt = 0;
        setConnected(true);
        // Anything that changed while the socket was down: re-read once.
        emit();
        return;
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        setConnected(false);
        void supabase.removeChannel(next);
        channel = null;
        if (retryTimer || refs === 0) return;
        const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
        attempt += 1;
        retryTimer = setTimeout(() => {
          retryTimer = null;
          void connect();
        }, delay);
      }
    });
  channel = next;
}

/** The nav-count read tells us whether migration 0066 is in. */
export function reportSignalsAvailable(value: boolean) {
  if (available === value) return;
  available = value;
  liveListeners.forEach((l) => l());
  if (value && refs > 0 && !channel) void connect();
  if (!value) teardown();
}

function acquire(id: string) {
  refs += 1;
  if (restaurantId !== id) {
    teardown();
    restaurantId = id;
    attempt = 0;
  }
  if (!channel && available) void connect();
}

function release() {
  refs = Math.max(0, refs - 1);
  if (refs === 0) {
    teardown();
    restaurantId = null;
  }
}

/**
 * Keep the branch's channel open while mounted (the manager shell does this
 * for the active branch) and call `onChange` when the branch changes.
 */
export function useRestaurantSignalChannel(id: string | null) {
  useEffect(() => {
    if (!id) return;
    acquire(id);
    return release;
  }, [id]);
}

/** Run `onChange` (debounced) whenever the active branch signals a change. */
export function useRestaurantSignal(onChange: () => void) {
  const ref = useRef(onChange);
  useEffect(() => {
    ref.current = onChange;
  }, [onChange]);
  useEffect(() => {
    const listener = () => ref.current();
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
}

function subscribeLive(listener: Listener) {
  liveListeners.add(listener);
  return () => {
    liveListeners.delete(listener);
  };
}

/** True while changes arrive live — screens may then poll only as a safety net. */
export function useSignalLive(): boolean {
  return useSyncExternalStore(
    subscribeLive,
    () => connected && available,
    () => false,
  );
}

/** Safety-net interval while live; the old interval otherwise. */
export const LIVE_FALLBACK_MS = 5 * 60_000;
