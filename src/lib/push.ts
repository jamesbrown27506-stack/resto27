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

/**
 * ─────────────────────────────────────────────────────────────────────────
 *  URGENCY IS THE DIFFERENCE BETWEEN "ON MY PHONE" AND "ON MY LAPTOP ONLY".
 *
 *  Every push was sent with no options at all, and RFC 8030 says a request
 *  with no `Urgency` header is `normal`. FCM — which is what every Chrome and
 *  Edge endpoint on this platform resolves to — maps that to NORMAL PRIORITY,
 *  and a normal-priority message is explicitly allowed to WAIT until the
 *  device leaves Doze.
 *
 *  A desktop never dozes, so on a laptop everything looked perfect. A phone
 *  in a pocket dozes within minutes, so the same notification sat in FCM's
 *  queue until the person picked the handset up and opened the app — which
 *  reads exactly like "push only works when the app is already open", and was
 *  reported as such.
 *
 *  `high` is the documented value for "deliver this immediately"; it wakes
 *  the device and starts the service worker even when the app is closed. It
 *  is the correct urgency for everything this platform pushes: an order the
 *  kitchen has not seen, a booking awaiting a decision, a customer's reply.
 *  None of them are worth sending at all if they arrive an hour late.
 *
 *  TTL is a day rather than the library's four-week default. A push that has
 *  been undeliverable for twenty-four hours describes an order that is long
 *  since cooked or cancelled, and surfacing it when the phone finally comes
 *  back online is worse than dropping it.
 * ─────────────────────────────────────────────────────────────────────────
 */
const PUSH_OPTIONS = {
  urgency: "high",
  TTL: 60 * 60 * 24,
  // One dead vendor endpoint must not hold every other device behind it. The
  // sends run concurrently below, and this caps the whole batch at roughly
  // ten seconds instead of N devices × an unbounded socket wait.
  timeout: 10_000,
} as const;

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

/** What happened to one device, for the diagnostics screen. */
export interface PushDeviceResult {
  /** The push service's host — "fcm.googleapis.com" for Chrome and Edge. */
  service: string;
  /** Last characters of the endpoint, enough to tell two devices apart. */
  endpointTail: string;
  status: "sent" | "expired" | "failed";
  /** HTTP status from the push service, when there was one. */
  code?: number;
  detail?: string;
}

/**
 * Push to one person and REPORT WHAT HAPPENED TO EACH DEVICE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY THIS RETURNS SOMETHING WHEN `sendPush` DELIBERATELY DOES NOT.
 *
 *  `sendPush` is fire-and-forget on purpose: it runs after an order has been
 *  recorded and must never affect it. The cost of that is total opacity — when
 *  someone says "my phone gets nothing", there is no way to tell a subscription
 *  the server never had from one the push service rejected from one that was
 *  accepted and swallowed by the handset.
 *
 *  Those three have completely different fixes, and guessing between them is
 *  what turns a five-minute problem into an evening. This is the same delivery
 *  path, with the answers kept.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function sendPushWithReport(
  profileId: string,
  payload: PushPayload,
): Promise<{ configured: boolean; platformEnabled: boolean; devices: PushDeviceResult[] }> {
  const configured = pushConfigured();
  const platformEnabled = configured ? await platformPushEnabled() : false;
  if (!configured || !platformEnabled) {
    return { configured, platformEnabled, devices: [] };
  }

  const supabase = createAdminClient();
  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("profile_id", profileId);

  const rows = (subs ?? []) as { id: string; endpoint: string; p256dh: string; auth: string }[];
  if (rows.length === 0) return { configured, platformEnabled, devices: [] };

  setVapidDetails();
  const body = JSON.stringify({
    title: payload.title,
    body: payload.body ?? "",
    href: payload.href ?? "/",
  });

  const devices = await Promise.all(rows.map(async (sub): Promise<PushDeviceResult> => {
    let service = "unknown";
    try {
      service = new URL(sub.endpoint).host;
    } catch {
      // A malformed endpoint is itself worth seeing in the report.
    }
    const endpointTail = sub.endpoint.slice(-12);

    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
        PUSH_OPTIONS,
      );
      await supabase
        .from("push_subscriptions")
        .update({
          last_success_at: new Date().toISOString(),
          last_failure_code: null,
          failure_count: 0,
        })
        .eq("id", sub.id);
      return { service, endpointTail, status: "sent" };
    } catch (pushError) {
      const code = (pushError as { statusCode?: number })?.statusCode;
      if (code === 404 || code === 410) {
        await supabase.from("push_subscriptions").delete().eq("id", sub.id);
        return {
          service,
          endpointTail,
          status: "expired",
          code,
          detail: "Endpoint gone — the row has been deleted. Re-enable push on that device.",
        };
      } else {
        await supabase.rpc("record_push_failure", {
          p_subscription_id: sub.id,
          p_failure_code: code ?? null,
        });
        return {
          service,
          endpointTail,
          status: "failed",
          code,
          detail: (pushError as Error)?.message?.slice(0, 200),
        };
      }
    }
  }));

  return { configured, platformEnabled, devices };
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

    await Promise.allSettled((subs as { id: string; endpoint: string; p256dh: string; auth: string }[]).map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
          PUSH_OPTIONS,
        );
        await supabase
          .from("push_subscriptions")
          .update({
            last_success_at: new Date().toISOString(),
            last_failure_code: null,
            failure_count: 0,
          })
          .eq("id", sub.id);
      } catch (pushError) {
        const status = (pushError as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) {
          await supabase.from("push_subscriptions").delete().eq("id", sub.id);
        } else {
          await supabase.rpc("record_push_failure", {
            p_subscription_id: sub.id,
            p_failure_code: status ?? null,
          });
          console.error("[push] delivery failed", status ?? "", (pushError as Error)?.message);
        }
      }
    }));
  } catch (error) {
    console.error("[push] send failed", error);
  }
}
