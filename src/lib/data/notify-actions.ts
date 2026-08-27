"use server";

import { revalidatePath } from "next/cache";
import { capProfileSubscriptions, sendPushWithReport, type PushDeviceResult } from "@/lib/push";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, requireUser } from "@/lib/auth/session";
import { notify, type NotifyTone } from "@/lib/notify";
import {
  fetchNotificationChannels,
  saveNotificationChannels,
  type NotificationChannels,
} from "@/lib/data/notification-channels";

/**
 * Notification actions shared by every shell — bell state, mark-read, nav
 * counts, and push subscription persistence.
 *
 * Every one is scoped to `profile.id` from the SESSION, never to an id from
 * the URL or the body: a crafted action call must not be able to read or
 * mark another person's notifications, or register a push subscription under
 * someone else's profile.
 */

/* ── PWA prompts ───────────────────────────────────────────────────────── */

/**
 * The install/notification banners need to know whether anyone is signed in —
 * web push subscriptions are stored under a profile, so the notification
 * prompt only makes sense for a signed-in user. getCurrentProfile (no
 * redirect) rather than requireUser: this runs on every page, including
 * public ones, and must never bounce a guest to /login.
 */
export async function getPromptUserState(): Promise<{ signedIn: boolean }> {
  return { signedIn: (await getCurrentProfile()) !== null };
}

/* ── Push self-repair ──────────────────────────────────────────────────── */

/**
 * What the on-open push sync needs to decide whether to act.
 *
 * `wantsPush` is the stored PREFERENCE, which is a different fact from
 * whether this browser currently holds a live subscription — and the gap
 * between those two is the whole bug PushSync exists to close. Like
 * getPromptUserState this must never redirect: it runs on every page,
 * including the public ones a guest is browsing.
 */
export async function getPushSyncState(): Promise<{ signedIn: boolean; wantsPush: boolean }> {
  const profile = await getCurrentProfile();
  if (!profile) return { signedIn: false, wantsPush: false };

  const channels = await fetchNotificationChannels(profile.id).catch(() => null);
  return { signedIn: true, wantsPush: channels?.push ?? true };
}

/* ── Bell state ────────────────────────────────────────────────────────── */

export interface NotificationState {
  /** Null when nobody is signed in — the bell stays hidden. */
  profileId: string | null;
  unread: number;
  /** File name (no extension) of the platform-wide notification sound. */
  sound: string;
}

export async function getNotificationState(): Promise<NotificationState> {
  const supabase = createAdminClient();
  const profile = await requireUser();

  const [unread, sound] = await Promise.all([
    supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("profile_id", profile.id)
      .is("read_at", null),
    supabase.from("settings").select("value").eq("key", "notification_sound").maybeSingle(),
  ]);

  return {
    profileId: profile.id,
    unread: unread.count ?? 0,
    sound: (sound.data as { value: string | null } | null)?.value ?? "chime",
  };
}

export interface RecentNotification {
  id: string;
  title: string;
  body: string;
  tone: NotifyTone;
  href: string | null;
  readAt: string | null;
  createdAt: string;
}

export async function listRecentNotifications(limit = 30): Promise<RecentNotification[]> {
  const profile = await requireUser();
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("notifications")
    .select("id, title, body, tone, href, read_at, created_at")
    .eq("profile_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[notify:listRecentNotifications]", error.message);
    return [];
  }

  return ((data ?? []) as {
    id: string;
    title: string;
    body: string;
    tone: NotifyTone;
    href: string | null;
    read_at: string | null;
    created_at: string;
  }[]).map((n) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    tone: n.tone,
    href: n.href,
    readAt: n.read_at,
    createdAt: n.created_at,
  }));
}

export async function markNotificationRead(id: string): Promise<{ ok: boolean; error?: string }> {
  const profile = await requireUser();
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("profile_id", profile.id);

  if (error) return { ok: false, error: "Could not mark it read." };
  return { ok: true };
}

export async function markAllNotificationsRead(): Promise<{ ok: boolean; error?: string }> {
  const profile = await requireUser();
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("profile_id", profile.id)
    .is("read_at", null);

  if (error) return { ok: false, error: "Could not mark them read." };
  revalidatePath("/a/notifications");
  return { ok: true };
}

/* ── Nav badges — "how many of these need me right now" ────────────────── */

export async function getManagerNavCounts(restaurantId: string): Promise<{
  orders: number;
  reservations: number;
  messages: number;
}> {
  const profile = await requireUser();
  const supabase = createAdminClient();

  // The caller must actually work at that branch — the count is operational
  // data, and an id from the URL must not resolve another tenant's queue.
  const { data: staff } = await supabase
    .from("restaurant_staff")
    .select("id, restaurants!inner ( status )")
    .eq("restaurant_id", restaurantId)
    .eq("profile_id", profile.id)
    .eq("status", "active")
    .eq("restaurants.status", "active")
    .maybeSingle();

  if (!staff) return { orders: 0, reservations: 0, messages: 0 };

  const [orders, reservations, messages, support] = await Promise.all([
    supabase
      .from("orders")
      .select("*", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId)
      .in("status", ["pending", "confirmed", "preparing", "shipped"]),
    supabase
      .from("reservations")
      .select("*", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId)
      .eq("status", "pending"),
    supabase
      .from("conversations")
      .select("*", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId)
      .eq("status", "open")
      .gt("staff_unread", 0),
    // The other inbox on the same screen: this person's own thread with the
    // platform, where an admin's reply is unread on the CUSTOMER counter
    // because the manager is the one who opened it. Without this the support
    // tab could hold an answer while the Messages badge stayed quiet.
    supabase
      .from("conversations")
      .select("*", { count: "exact", head: true })
      .is("restaurant_id", null)
      .eq("customer_id", profile.id)
      .eq("status", "open")
      .gt("customer_unread", 0),
  ]);

  return {
    orders: orders.count ?? 0,
    reservations: reservations.count ?? 0,
    messages: (messages.count ?? 0) + (support.count ?? 0),
  };
}

/* ── Push subscriptions ────────────────────────────────────────────────── */

/**
 * Store a browser's push subscription, or move it to this profile if it was
 * already saved under an older account. Upsert on the endpoint — a browser
 * re-registering after a data wipe is the same browser, not a second one.
 */
export async function savePushSubscription(input: {
  endpoint: string;
  p256dh: string;
  auth: string;
  expirationTime?: string | null;
  userAgent?: string;
  previousEndpoint?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const profile = await requireUser();

  const endpoint = input.endpoint.trim();
  const p256dh = input.p256dh.trim();
  const auth = input.auth.trim();

  if (!endpoint.startsWith("https://") || !p256dh || !auth) {
    return { ok: false, error: "Invalid subscription." };
  }

  const supabase = createAdminClient();
  const baseRow = {
    profile_id: profile.id,
    endpoint,
    p256dh,
    auth,
    user_agent: input.userAgent?.slice(0, 500) || null,
    updated_at: new Date().toISOString(),
  };

  /*
    ─────────────────────────────────────────────────────────────────────────
     UPSERTING ON `endpoint` REASSIGNS THE DEVICE, AND THAT IS CORRECT.

     It looks like a bug and is not. A browser holds exactly ONE push
     subscription per registration, so when a second account signs in on the
     same handset the endpoint genuinely belongs to whoever is signed in now.
     Letting two profiles share it would deliver one person's orders to
     another's lock screen, which is a privacy leak, not a feature.

     The visible consequence is worth knowing about while testing: signing in
     as the manager on a phone that was signed in as a customer moves the row,
     and the customer account's device count drops by one. That account's
     settings panel then reads "on for another device", which is true.
    ─────────────────────────────────────────────────────────────────────────
  */
  let { error } = await supabase.from("push_subscriptions").upsert(
    { ...baseRow, expiration_time: input.expirationTime ?? null },
    { onConflict: "endpoint" },
  );

  // Code and migration can be deployed in either order. Until 0042 reaches
  // the database, keep subscription repair working with the old row shape.
  if (
    error &&
    (error.code === "42703" || error.code === "PGRST204") &&
    error.message.includes("expiration_time")
  ) {
    ({ error } = await supabase
      .from("push_subscriptions")
      .upsert(baseRow, { onConflict: "endpoint" }));
  }

  if (error) {
    console.error("[notify:savePushSubscription]", error.message);
    return { ok: false, error: "Could not save the subscription." };
  }

  if (input.previousEndpoint && input.previousEndpoint !== endpoint) {
    await supabase
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", input.previousEndpoint)
      .eq("profile_id", profile.id);
  }

  await capProfileSubscriptions(profile.id);
  return { ok: true };
}

/**
 * Forget ONE device, and report how many the account has left.
 *
 * The count is what lets the caller tell "off on this phone" apart from "off
 * everywhere". Turning push off used to do both at once — see the note in
 * notification-settings' disablePush — and the difference is invisible without
 * knowing whether anything else is still listening.
 */
export async function removePushSubscription(
  endpoint: string,
): Promise<{ ok: boolean; remaining: number }> {
  const profile = await requireUser();
  const supabase = createAdminClient();

  const { error: deleteError } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint)
    .eq("profile_id", profile.id);

  /*
    A DELETE THAT FAILED DID NOT DISABLE ANYTHING. Returning ok would let
    the client unsubscribe its browser half and report "disabled" while the
    server still targets this endpoint. remaining:1 keeps the master-switch
    guard fail-safe, same as the count fallback below.
  */
  if (deleteError) {
    console.error("[notify:removePushSubscription] delete", deleteError.message);
    return { ok: false, remaining: 1 };
  }

  const { count, error } = await supabase
    .from("push_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", profile.id);

  if (error) {
    console.error("[notify:removePushSubscription] count", error.message);
    /*
      A count we could not read must not be reported as zero. Zero is the
      value that tells the caller to switch the ACCOUNT-WIDE preference off,
      and doing that on a failed query would silence every other device the
      person owns because one SELECT timed out.
    */
    return { ok: true, remaining: 1 };
  }

  return { ok: true, remaining: count ?? 0 };
}

/* ── Master channel switches (migration 0027) ──────────────────────────── */

/**
 * MY three switches. Every role calls this one action — the settings panel is
 * the same component in the customer, manager and admin areas, and the answer
 * is per person, not per role.
 */
export async function getMyNotificationChannels(): Promise<NotificationChannels> {
  const profile = await requireUser();
  return fetchNotificationChannels(profile.id);
}

export async function saveMyNotificationChannels(
  input: NotificationChannels,
): Promise<{ ok: boolean; error?: string }> {
  const profile = await requireUser();

  const result = await saveNotificationChannels(profile.id, {
    inApp: Boolean(input.inApp),
    email: Boolean(input.email),
    push: Boolean(input.push),
    // Quiet fields pass through as given: `undefined` = leave stored value,
    // `null` = clear. The panel sends them only from the quiet-hours row.
    quietStart: input.quietStart,
    quietEnd: input.quietEnd,
    snoozedUntil: input.snoozedUntil,
  });
  if (!result.ok) return result;

  // The three screens that render the panel.
  revalidatePath("/settings");
  revalidatePath("/m/settings");
  revalidatePath("/a/notifications");
  return { ok: true };
}

/**
 * Pause push for a fixed spell — the temporary mute that stops "turn it off
 * and forget to turn it back on" from being the only option. Expiry is
 * implicit: notify() compares the timestamp, no job un-pauses anything.
 * Null clears an active pause. In-app rows and email keep landing.
 */
export async function snoozeMyPush(hours: number | null): Promise<{
  ok: boolean;
  snoozedUntil: string | null;
  error?: string;
}> {
  const profile = await requireUser();

  const clamped = hours === null ? null : Math.min(24, Math.max(1, Math.round(hours)));
  const snoozedUntil =
    clamped === null ? null : new Date(Date.now() + clamped * 60 * 60 * 1000).toISOString();

  const current = await fetchNotificationChannels(profile.id);
  const result = await saveNotificationChannels(profile.id, { ...current, snoozedUntil });
  if (!result.ok) return { ok: false, snoozedUntil: null, error: result.error };

  revalidatePath("/settings");
  revalidatePath("/m/settings");
  revalidatePath("/a/notifications");
  return { ok: true, snoozedUntil };
}

/* ── Device list — the stored subscriptions, with their health ─────────── */

export interface PushDeviceRow {
  id: string;
  /** The push service's host plus the endpoint's last characters — enough to
      tell two devices apart, never the full endpoint. */
  service: string;
  endpointTail: string;
  /** Coarse label parsed from the stored user agent ("Chrome · Android"). */
  label: string;
  createdAt: string | null;
  lastSuccessAt: string | null;
  failureCount: number;
  lastFailureCode: number | null;
}

function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return "Navigateur inconnu";
  const ua = userAgent;
  const browser = /edg(a|ios|e)?\//i.test(ua)
    ? "Edge"
    : /opr\/|opera/i.test(ua)
      ? "Opera"
      : /samsungbrowser/i.test(ua)
        ? "Samsung Internet"
        : /firefox\//i.test(ua)
          ? "Firefox"
          : /chrome|crios/i.test(ua)
            ? "Chrome"
            : /safari/i.test(ua)
              ? "Safari"
              : "Navigateur";
  const os = /android/i.test(ua)
    ? "Android"
    : /iphone|ipad|ipod/i.test(ua)
      ? "iOS"
      : /windows/i.test(ua)
        ? "Windows"
        : /mac os x|macintosh/i.test(ua)
          ? "macOS"
          : /linux/i.test(ua)
            ? "Linux"
            : "";
  return os ? `${browser} · ${os}` : browser;
}

/**
 * Every device this account can be pushed to, with the delivery health the
 * send path has been recording (0042) and nothing was ever reading. The
 * endpoint itself stays server-side — rows are removed by id.
 */
export async function listPushDevices(): Promise<{
  ok: boolean;
  devices: PushDeviceRow[];
}> {
  const profile = await requireUser();
  const supabase = createAdminClient();

  const WIDE =
    "id, endpoint, user_agent, created_at, last_success_at, last_failure_code, failure_count";
  const NARROW = "id, endpoint, user_agent, created_at";

  const wide = await supabase
    .from("push_subscriptions")
    .select(WIDE)
    .eq("profile_id", profile.id)
    .order("created_at", { ascending: false });
  let data: unknown = wide.data;
  let error = wide.error;

  // Pre-0042 database: the health columns do not exist yet. The list still
  // works, with health unknown, rather than failing over absent columns.
  if (error && (error.code === "42703" || error.code === "PGRST204")) {
    const narrow = await supabase
      .from("push_subscriptions")
      .select(NARROW)
      .eq("profile_id", profile.id)
      .order("created_at", { ascending: false });
    data = narrow.data;
    error = narrow.error;
  }

  if (error) {
    console.error("[notify:listPushDevices]", error.message);
    return { ok: false, devices: [] };
  }

  const devices = ((data ?? []) as {
    id: string;
    endpoint: string;
    user_agent: string | null;
    created_at: string | null;
    last_success_at?: string | null;
    last_failure_code?: number | null;
    failure_count?: number | null;
  }[]).map((row) => {
    let service = "unknown";
    try {
      service = new URL(row.endpoint).host;
    } catch {
      // Shown as-is; a malformed endpoint is itself informative.
    }
    return {
      id: row.id,
      service,
      endpointTail: row.endpoint.slice(-8),
      label: deviceLabel(row.user_agent),
      createdAt: row.created_at ?? null,
      lastSuccessAt: row.last_success_at ?? null,
      failureCount: row.failure_count ?? 0,
      lastFailureCode: row.last_failure_code ?? null,
    };
  });

  return { ok: true, devices };
}

/** Forget one stored device by id — the way to drop a lost phone without
    the nuclear reset. Scoped to the caller's own rows. */
export async function removePushDevice(id: string): Promise<{ ok: boolean; error?: string }> {
  const profile = await requireUser();
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("id", id)
    .eq("profile_id", profile.id);

  if (error) {
    console.error("[notify:removePushDevice]", error.message);
    return { ok: false, error: "Could not remove the device." };
  }
  return { ok: true };
}

/**
 * "Push notifications are now on" — sent to the person who just turned them
 * on, through the channel they just turned on.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THIS IS THE TEST, AND IT IS WHY THE ADMIN TEST PAGE IS NOT.
 *
 *  Verifying push used to mean an admin opening /a/tests and firing a sample
 *  event at themselves — which tells a customer or a manager nothing about
 *  their own phone. Sending the confirmation at the moment of subscribing
 *  puts the proof where the action is: the browser prompt is accepted, the
 *  subscription is stored, and a real notification comes straight back
 *  through lib/notify — same writer, same delivery path, same preference
 *  gating as an actual order.
 *
 *  `channels` forces in-app + push for this one message: the person is
 *  standing in front of the switch, so the bell row is the on-screen half of
 *  the receipt and the push is the off-screen half. Email is deliberately
 *  off — nobody needs a mail to say a browser setting changed.
 * ─────────────────────────────────────────────────────────────────────────
 */
/**
 * Send a real push to every device this person has registered, and say what
 * each one did.
 *
 * Goes through the SAME code path a new order takes — same encryption, same
 * urgency, same VAPID keys — so a pass here means an order would arrive too.
 * A test that used a different path would only prove the test worked.
 *
 * Deliberately reports per DEVICE. "Push is broken" is three different
 * problems: no subscription stored, the push service rejecting it, or the
 * handset accepting it and showing nothing. Only the third is Android's
 * battery settings, and only this can tell you which one you have.
 */
/**
 * Forget every push subscription this account has, on every device.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE ESCAPE HATCH FOR "IT IS PROBABLY MY DEVICE".
 *
 *  Push has two halves that can disagree, and nothing in the normal UI can
 *  tell you which half is wrong: the BROWSER holds a subscription, and the
 *  SERVER holds a row that is supposed to describe it. They drift apart in
 *  ways no amount of re-toggling fixes, because toggling repairs the browser
 *  half and leaves the server's stale copies behind:
 *
 *    · a re-subscribe writes a new endpoint and the old row stays, so the
 *      server keeps sending to an address nobody is listening on. Six rows
 *      for one person is six sends, five of them into the void;
 *    · a browser that was reinstalled, or a profile that was signed into on
 *      a borrowed handset, leaves rows that will never be claimed again;
 *    · an endpoint the push service still ACCEPTS (201) but whose browser is
 *      long gone looks perfectly healthy from the server, which is the worst
 *      case of all — the diagnostics say "sent" and nothing arrives.
 *
 *  Deleting every row is what makes the next repair honest. `PushSync` runs
 *  on the very next load of each real device and re-registers exactly one
 *  current endpoint per browser, so what remains afterwards is the set of
 *  devices that actually exist.
 *
 *  The other devices go quiet until each is opened once. That is the point:
 *  a silence you caused and understand beats a silence you are guessing at.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function resetPushSubscriptions(): Promise<{
  ok: boolean;
  removed: number;
  error?: string;
}> {
  const profile = await requireUser();
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("profile_id", profile.id)
    .select("id");

  if (error) {
    console.error("[notify:resetPushSubscriptions]", error.code ?? "", error.message);
    return { ok: false, removed: 0, error: "Could not clear the stored devices." };
  }

  revalidatePath("/settings");
  revalidatePath("/m/settings");
  revalidatePath("/a/notifications");
  return { ok: true, removed: (data ?? []).length };
}

export async function sendTestPush(currentEndpoint?: string): Promise<{
  ok: boolean;
  configured: boolean;
  platformEnabled: boolean;
  devices: PushDeviceResult[];
  /** True when the device list could not be READ — not the same as empty. */
  queryFailed?: boolean;
  /** False when the caller's own browser is not among the stored devices. */
  thisDeviceRegistered: boolean;
  /**
   * The person's own master push switch.
   *
   * The test deliberately bypasses it — you asked for this notification, so
   * you get it — but a REAL order would not. Without reporting it, the
   * diagnostic can show a row of green ticks to someone whose every genuine
   * notification is being suppressed one layer up, which is precisely the
   * confusion it exists to end.
   */
  masterPushOn: boolean;
}> {
  const profile = await requireUser();

  const channels = await fetchNotificationChannels(profile.id).catch(() => null);

  const href =
    profile.role === "admin" ? "/a/diagnostics" : profile.role === "manager" ? "/m/settings" : "/settings";

  const report = await sendPushWithReport(
    profile.id,
    {
      title: "Test notification",
      body: "If you can read this with the app closed, push is working on this device.",
      href,
      tag: "restolink:test",
    },
    currentEndpoint,
  );

  return {
    ok: report.devices.some((d) => d.status === "sent"),
    thisDeviceRegistered: report.devices.some((d) => d.isThisDevice),
    // Unreadable preferences default to on, matching what the notifier does
    // with a missing row — a failed read must not be reported as "you turned
    // it off".
    masterPushOn: channels?.push ?? true,
    ...report,
  };
}

export async function announcePushEnabled(): Promise<{ ok: boolean; error?: string }> {
  const profile = await requireUser();

  const href =
    profile.role === "admin" ? "/a/notifications" : profile.role === "manager" ? "/m/settings" : "/settings";

  const { delivered } = await notify({
    event: "push_enabled",
    tone: "success",
    profileId: profile.id,
    href,
    channels: { inApp: true, email: false, push: true },
  });

  if (delivered === 0) {
    return { ok: false, error: "The confirmation could not be delivered." };
  }
  return { ok: true };
}
