import "server-only";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * The three master channel switches — one answer per person, every role.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHERE THIS SITS IN THE PREFERENCE STACK.
 *
 *  Two tables already answered "which notifications reach me":
 *    · notification_preferences (0012) — the manager's per-branch, per-event
 *      grid;
 *    · customer_preferences (0014)     — the customer's per-topic switches.
 *
 *  Neither answered "which CHANNELS are open at all", and admins had no
 *  answer of any kind — lib/notify.ts hardcoded all-on for them. This table
 *  (0027) is that layer, and lib/notify.ts ANDs it with the per-event
 *  answer: a delivery needs both to say yes.
 *
 *  IN-APP AND REALTIME ARE ONE SWITCH, on purpose. The live toast and the
 *  bell badge are the same database row seen twice — one as it arrives, one
 *  when you go looking. Offering them separately would promise a split the
 *  delivery path cannot make.
 *
 *  FAILS SOFT, like fetchNotificationPreferences: if 0027 has not been
 *  applied to the database this build points at, every read returns the
 *  defaults rather than throwing. The defaults are what the notifier would
 *  have used before this table existed, so nothing goes quiet on a database
 *  that is one migration behind.
 * ─────────────────────────────────────────────────────────────────────────
 */

export interface NotificationChannels {
  /** The bell row — and therefore the realtime toast and sound. */
  inApp: boolean;
  email: boolean;
  /** Native web push. Needs a subscribed browser as well as this switch. */
  push: boolean;
}

/** A missing row means all three on — nobody is silenced by never visiting. */
export const NOTIFICATION_CHANNELS_DEFAULT: NotificationChannels = {
  inApp: true,
  email: true,
  push: true,
};

function fromRow(row: { in_app: boolean; email: boolean; push: boolean }): NotificationChannels {
  return { inApp: row.in_app, email: row.email, push: row.push };
}

/** One person's master switches, or the defaults when nothing is stored. */
export async function fetchNotificationChannels(
  profileId: string,
): Promise<NotificationChannels> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("notification_channels")
    .select("in_app, email, push")
    .eq("profile_id", profileId)
    .maybeSingle();

  if (error) {
    console.error("[notify:fetchNotificationChannels]", error.message);
    return NOTIFICATION_CHANNELS_DEFAULT;
  }
  if (!data) return NOTIFICATION_CHANNELS_DEFAULT;

  return fromRow(data as { in_app: boolean; email: boolean; push: boolean });
}

/**
 * The same, for a whole recipient list — one query, not one per person.
 * Callers should fall back to the default for ids missing from the map.
 */
export async function fetchNotificationChannelsFor(
  profileIds: string[],
): Promise<Map<string, NotificationChannels>> {
  const out = new Map<string, NotificationChannels>();
  if (profileIds.length === 0) return out;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("notification_channels")
    .select("profile_id, in_app, email, push")
    .in("profile_id", profileIds);

  if (error) {
    console.error("[notify:fetchNotificationChannelsFor]", error.message);
    return out;
  }

  for (const row of (data ?? []) as {
    profile_id: string;
    in_app: boolean;
    email: boolean;
    push: boolean;
  }[]) {
    out.set(row.profile_id, fromRow(row));
  }
  return out;
}

/** Store one person's answers. Upsert — the profile id is the primary key. */
export async function saveNotificationChannels(
  profileId: string,
  channels: NotificationChannels,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = createAdminClient();

  const { error } = await supabase.from("notification_channels").upsert(
    {
      profile_id: profileId,
      in_app: Boolean(channels.inApp),
      email: Boolean(channels.email),
      push: Boolean(channels.push),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "profile_id" },
  );

  if (error) {
    console.error("[notify:saveNotificationChannels]", error.message);
    return { ok: false, error: "Could not save your notification settings." };
  }
  return { ok: true };
}
