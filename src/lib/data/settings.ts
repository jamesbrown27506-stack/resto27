import "server-only";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * The notification catalogue, and one person's answers to it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  NO LABELS IN THIS FILE. Only keys.
 *
 *  A Server Component imports this module, and a Server Component cannot call
 *  useLocale — so the moment a French sentence lives here, it stays French in
 *  an English interface. The catalogue therefore carries the event KEY and its
 *  defaults; `mset.evt.<key>` and `mset.evtBody.<key>` in the dictionary carry
 *  the words, in both languages.
 *
 *  A MISSING ROW MEANS "the default", NOT "off" (migration 0012). Nobody is
 *  opted out by never having opened this screen, and an event added next month
 *  does not arrive silenced for everyone who saved their preferences today.
 * ─────────────────────────────────────────────────────────────────────────
 */

export const NOTIFICATION_EVENT_KEYS = [
  "new_order",
  "order_cancelled",
  "reservation",
  "review",
  "low_stock",
  "billing",
] as const;

export type NotificationEventKey = (typeof NOTIFICATION_EVENT_KEYS)[number];

export interface NotificationEvent {
  key: NotificationEventKey;
  /** What someone who has never touched this screen gets. */
  inApp: boolean;
  email: boolean;
  push: boolean;
  /**
   * Cannot be silenced — it is the business, not a newsletter. A locked event
   * is pinned to its defaults on read AND on write; the disabled switch is a
   * courtesy, the server action is the rule.
   */
  locked: boolean;
}

export const NOTIFICATION_EVENTS: readonly NotificationEvent[] = [
  { key: "new_order", inApp: true, email: true, push: true, locked: true },
  { key: "order_cancelled", inApp: true, email: true, push: true, locked: false },
  { key: "reservation", inApp: true, email: true, push: true, locked: false },
  { key: "review", inApp: true, email: false, push: true, locked: false },
  { key: "low_stock", inApp: true, email: false, push: true, locked: false },
  { key: "billing", inApp: true, email: true, push: true, locked: true },
];

/** One resolved answer: the stored row if there is one, the default otherwise. */
export interface NotificationPreference {
  key: NotificationEventKey;
  inApp: boolean;
  email: boolean;
  push: boolean;
  locked: boolean;
}

function defaults(): NotificationPreference[] {
  return NOTIFICATION_EVENTS.map((event) => ({
    key: event.key,
    inApp: event.inApp,
    email: event.email,
    push: event.push,
    locked: event.locked,
  }));
}

/**
 * This person's preferences at this branch, stored rows merged over defaults.
 *
 * FAILS SOFT. Migration 0012 may not have been applied to the database this
 * build is pointed at, and a settings page that 500s is strictly worse than a
 * settings page showing the defaults — the defaults are what the notifier
 * would use anyway, so the screen stays truthful either way.
 */
export async function fetchNotificationPreferences(
  restaurantId: string,
  profileId: string,
): Promise<NotificationPreference[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("notification_preferences")
    .select("event_key, in_app, email, push")
    .eq("restaurant_id", restaurantId)
    .eq("profile_id", profileId);

  if (error) {
    console.error("[settings:fetchNotificationPreferences]", error.message);
    return defaults();
  }

  const stored = new Map(
    ((data ?? []) as { event_key: string; in_app: boolean; email: boolean; push: boolean }[]).map(
      (row) => [row.event_key, row],
    ),
  );

  return NOTIFICATION_EVENTS.map((event) => {
    const row = stored.get(event.key);
    return {
      key: event.key,
      // A locked event ignores whatever is stored. A row written before an
      // event was locked, or by a client that lied, cannot silence it.
      inApp: event.locked ? event.inApp : (row?.in_app ?? event.inApp),
      email: event.locked ? event.email : (row?.email ?? event.email),
      push: event.locked ? event.push : (row?.push ?? event.push),
      locked: event.locked,
    };
  });
}

/**
 * Why the branch stopped taking orders, if it has.
 *
 * `is_accepting_orders` already rides on the branch context; only the sentence
 * behind it needs a read. It is shown back to the manager and pre-fills the
 * pause dialog, so resuming and re-pausing does not lose the explanation.
 */
export async function fetchPausedReason(restaurantId: string): Promise<string | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("restaurants")
    .select("paused_reason")
    .eq("id", restaurantId)
    .maybeSingle();

  if (error) {
    console.error("[settings:fetchPausedReason]", error.message);
    return null;
  }

  return (data as { paused_reason: string | null } | null)?.paused_reason ?? null;
}
