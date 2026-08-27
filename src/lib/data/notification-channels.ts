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
  /**
   * Quiet hours (0044): minutes since midnight, Africa/Douala. Null = none.
   * Gates only the push — the bell row and email still land.
   */
  quietStart?: number | null;
  quietEnd?: number | null;
  /** Push paused until this instant (0044). Expiry is implicit — no job. */
  snoozedUntil?: string | null;
}

/** A missing row means all three on — nobody is silenced by never visiting. */
export const NOTIFICATION_CHANNELS_DEFAULT: NotificationChannels = {
  inApp: true,
  email: true,
  push: true,
  quietStart: null,
  quietEnd: null,
  snoozedUntil: null,
};

interface ChannelsRow {
  in_app: boolean;
  email: boolean;
  push: boolean;
  quiet_start?: number | null;
  quiet_end?: number | null;
  snoozed_until?: string | null;
}

function fromRow(row: ChannelsRow): NotificationChannels {
  return {
    inApp: row.in_app,
    email: row.email,
    push: row.push,
    quietStart: row.quiet_start ?? null,
    quietEnd: row.quiet_end ?? null,
    snoozedUntil: row.snoozed_until ?? null,
  };
}

/*
  Code and migration deploy in either order (0044 adds the quiet columns).
  PostgREST fails a select over ONE missing column, so the wide select gets
  one retry with the pre-0044 shape — the same pattern savePushSubscription
  uses. The verdict is remembered per process to save the doomed first try.
*/
const WIDE_COLUMNS = "in_app, email, push, quiet_start, quiet_end, snoozed_until";
const NARROW_COLUMNS = "in_app, email, push";
let quietColumnsMissing = false;

function isMissingColumn(error: { code?: string; message?: string } | null): boolean {
  return Boolean(
    error &&
      (error.code === "42703" || error.code === "PGRST204") &&
      /quiet_start|quiet_end|snoozed_until/.test(error.message ?? ""),
  );
}

/** One person's master switches, or the defaults when nothing is stored. */
export async function fetchNotificationChannels(
  profileId: string,
): Promise<NotificationChannels> {
  const supabase = createAdminClient();

  let { data, error } = await supabase
    .from("notification_channels")
    .select(quietColumnsMissing ? NARROW_COLUMNS : WIDE_COLUMNS)
    .eq("profile_id", profileId)
    .maybeSingle();

  if (isMissingColumn(error)) {
    quietColumnsMissing = true;
    ({ data, error } = await supabase
      .from("notification_channels")
      .select(NARROW_COLUMNS)
      .eq("profile_id", profileId)
      .maybeSingle());
  }

  if (error) {
    console.error("[notify:fetchNotificationChannels]", error.message);
    return NOTIFICATION_CHANNELS_DEFAULT;
  }
  if (!data) return NOTIFICATION_CHANNELS_DEFAULT;

  return fromRow(data as unknown as ChannelsRow);
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
  const wide = await supabase
    .from("notification_channels")
    .select(`profile_id, ${quietColumnsMissing ? NARROW_COLUMNS : WIDE_COLUMNS}`)
    .in("profile_id", profileIds);
  let data: unknown = wide.data;
  let error = wide.error;

  if (isMissingColumn(error)) {
    quietColumnsMissing = true;
    const narrow = await supabase
      .from("notification_channels")
      .select(`profile_id, ${NARROW_COLUMNS}`)
      .in("profile_id", profileIds);
    data = narrow.data;
    error = narrow.error;
  }

  if (error) {
    console.error("[notify:fetchNotificationChannelsFor]", error.message);
    return out;
  }

  for (const row of (data ?? []) as unknown as ({ profile_id: string } & ChannelsRow)[]) {
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

  const baseRow = {
    profile_id: profileId,
    in_app: Boolean(channels.inApp),
    email: Boolean(channels.email),
    push: Boolean(channels.push),
    updated_at: new Date().toISOString(),
  };

  /*
    Quiet fields ride along ONLY when the caller passed them — an upsert
    updates just the columns it names, so the master-switch panel saving
    {inApp, email, push} cannot wipe a stored quiet window. `undefined`
    means "leave it"; `null` means "clear it". A window is stored whole or
    not at all — one edge is not a window.
  */
  const clamp = (v: number | null | undefined) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(1439, Math.max(0, Math.round(v))) : null;
  const quietRow: Record<string, unknown> = {};
  if (channels.quietStart !== undefined || channels.quietEnd !== undefined) {
    const quietStart = clamp(channels.quietStart);
    const quietEnd = clamp(channels.quietEnd);
    const whole = quietStart !== null && quietEnd !== null;
    quietRow.quiet_start = whole ? quietStart : null;
    quietRow.quiet_end = whole ? quietEnd : null;
  }
  if (channels.snoozedUntil !== undefined) {
    quietRow.snoozed_until = channels.snoozedUntil;
  }

  let { error } = await supabase
    .from("notification_channels")
    .upsert(quietColumnsMissing ? baseRow : { ...baseRow, ...quietRow }, { onConflict: "profile_id" });

  if (isMissingColumn(error)) {
    quietColumnsMissing = true;
    ({ error } = await supabase
      .from("notification_channels")
      .upsert(baseRow, { onConflict: "profile_id" }));
  }

  if (error) {
    console.error("[notify:saveNotificationChannels]", error.message);
    return { ok: false, error: "Could not save your notification settings." };
  }
  return { ok: true };
}
