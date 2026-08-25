"use server";

import { revalidatePath } from "next/cache";
import { sendPushWithReport, type PushDeviceResult } from "@/lib/push";
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
}): Promise<{ ok: boolean; error?: string }> {
  const profile = await requireUser();

  const endpoint = input.endpoint.trim();
  const p256dh = input.p256dh.trim();
  const auth = input.auth.trim();

  if (!endpoint.startsWith("https://") || !p256dh || !auth) {
    return { ok: false, error: "Invalid subscription." };
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      profile_id: profile.id,
      endpoint,
      p256dh,
      auth,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" },
  );

  if (error) {
    console.error("[notify:savePushSubscription]", error.message);
    return { ok: false, error: "Could not save the subscription." };
  }
  return { ok: true };
}

export async function removePushSubscription(endpoint: string): Promise<{ ok: boolean }> {
  const profile = await requireUser();
  const supabase = createAdminClient();

  await supabase
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint)
    .eq("profile_id", profile.id);

  return { ok: true };
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
  });
  if (!result.ok) return result;

  // The three screens that render the panel.
  revalidatePath("/settings");
  revalidatePath("/m/settings");
  revalidatePath("/a/notifications");
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
export async function sendTestPush(): Promise<{
  ok: boolean;
  configured: boolean;
  platformEnabled: boolean;
  devices: PushDeviceResult[];
}> {
  const profile = await requireUser();

  const href =
    profile.role === "admin" ? "/a/diagnostics" : profile.role === "manager" ? "/m/settings" : "/settings";

  const report = await sendPushWithReport(profile.id, {
    title: "Test notification",
    body: "If you can read this with the app closed, push is working on this device.",
    href,
  });

  return { ok: report.devices.some((d) => d.status === "sent"), ...report };
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
