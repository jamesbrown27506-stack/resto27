import "server-only";
import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Web push delivery — the closed-tab / closed-app layer.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  HOW THE PIECES FIT.
 *
 *  The browser (Chrome, Edge, Firefox — one VAPID keypair serves them all)
 *  subscribes through the Push API, handing back an endpoint plus two
 *  encryption keys. The endpoint is a URL on the browser vendor's own push
 *  service (FCM for Chrome, Windows Push for Edge); the keys let us encrypt
 *  a message only that browser can read.
 *
 *  We store that trio in push_subscriptions, and on every notification this
 *  module encrypts the payload with web-push and POSTs it to the endpoint.
 *  The browser wakes its service worker, which shows the OS-level
 *  notification.
 *
 *  NOTHING HERE THROWS, and it is fenced twice: the platform master switch
 *  (settings.push_enabled) and whether VAPID keys are configured at all. A
 *  push failure must never affect the order being recorded.
 * ─────────────────────────────────────────────────────────────────────────
 */

export interface PushPayload {
  title: string;
  body?: string;
  href?: string | null;
}

/** True when the VAPID keys are present and not placeholders. */
export function pushConfigured(): boolean {
  const pub = process.env.VAPID_PUBLIC_KEY?.trim();
  const priv = process.env.VAPID_PRIVATE_KEY?.trim();
  const subj = process.env.VAPID_SUBJECT?.trim();
  if (!pub || !priv || !subj) return false;
  if (pub.includes("REPLACE_ME") || priv.includes("REPLACE_ME")) return false;
  return true;
}

async function platformPushEnabled(): Promise<boolean> {
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "push_enabled")
      .maybeSingle();
    return data?.value !== "false";
  } catch {
    return false;
  }
}

function setVapidDetails() {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
}

/**
 * Deliver one message to one person's browser(s). Never throws.
 *
 * A subscription whose endpoint the push service no longer recognises
 * (status 404/410 — the browser was uninstalled, the site was blocked, the
 * endpoint expired) is deleted here so it never spams the log again. That
 * cleanup is the "expiry handling" every Web Push guide warns about.
 */
export async function sendPush(profileId: string, payload: PushPayload): Promise<void> {
  try {
    if (!pushConfigured()) return;
    if (!(await platformPushEnabled())) return;

    const supabase = createAdminClient();
    const { data: subs, error } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("profile_id", profileId);

    if (error || !subs || subs.length === 0) return;

    setVapidDetails();
    const body = JSON.stringify({
      title: payload.title,
      body: payload.body ?? "",
      href: payload.href ?? "/",
    });

    for (const sub of subs as { id: string; endpoint: string; p256dh: string; auth: string }[]) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
        );
      } catch (pushError) {
        const status = (pushError as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) {
          await supabase.from("push_subscriptions").delete().eq("id", sub.id);
        } else {
          console.error("[push] delivery failed", status ?? "", (pushError as Error)?.message);
        }
      }
    }
  } catch (error) {
    console.error("[push] send failed", error);
  }
}
