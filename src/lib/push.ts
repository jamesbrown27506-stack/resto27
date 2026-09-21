import "server-only";
import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/server";
import { sendFirebasePush, firebaseDeliveryConfigured } from "@/lib/firebase/server";
import { notificationProvider } from "@/lib/notification-provider";

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
  /**
   * Collapse key — banners sharing a tag REPLACE each other instead of
   * stacking. Per-event tags are what stop a new order from erasing an
   * unread chat reply on the lock screen.
   */
  tag?: string;
  /** Severity, forwarded to the page toast by sw.js (colour + semantics). */
  tone?: "info" | "success" | "warning" | "error";
  /** The recipient's own language ("fr"/"en") — the OS renders it. */
  lang?: string;
  /**
   * Keep the banner on screen until dismissed. sw.js applies it only when
   * no window is visible, so it never traps a banner someone is looking at.
   */
  requireInteraction?: boolean;
  /**
   * Buttons on the banner (Android/desktop Chrome; ignored where the
   * platform has none, iOS included). Each carries its own deep link —
   * sw.js routes the tap through `data.actionUrls`. Two at most: that is
   * the ceiling every Chromium platform actually renders.
   */
  actions?: { action: string; title: string; href: string }[];
  /** Branded full-colour artwork shown beside the notification. */
  icon?: string;
  /** Monochrome Android status-bar glyph. */
  badge?: string;
}

/**
 * THE WIRE FORMAT, IN EXACTLY ONE PLACE.
 *
 * Both send paths used to serialise the payload themselves, and the copies
 * had already started drifting — sw.js grew support for `tag` and `tone`
 * that the server never sent. Every field the worker understands is built
 * here or nowhere.
 */
function payloadBody(payload: PushPayload): string {
  return JSON.stringify({
    title: payload.title,
    body: payload.body ?? "",
    href: payload.href ?? "/",
    ...(payload.tag ? { tag: payload.tag } : {}),
    ...(payload.tone ? { tone: payload.tone } : {}),
    ...(payload.lang ? { lang: payload.lang } : {}),
    ...(payload.requireInteraction ? { requireInteraction: true } : {}),
    ...(payload.actions?.length ? { actions: payload.actions.slice(0, 2) } : {}),
    ...(payload.icon ? { icon: payload.icon } : {}),
    ...(payload.badge ? { badge: payload.badge } : {}),
  });
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

/*
  The public key exists twice: VAPID_PUBLIC_KEY signs on the server and
  NEXT_PUBLIC_VAPID_PUBLIC_KEY is what browsers subscribe with. When they
  drift apart, every send is rejected 403 by the push service — a failure
  that looks exactly like "push is broken on my phone". Warned once per
  process, not fatal: a deliberate rotation window must not become a kill
  switch.
*/
let warnedVapidDrift = false;

/** True when the VAPID keys are present and not placeholders. */
export function pushConfigured(): boolean {
  const pub = process.env.VAPID_PUBLIC_KEY?.trim();
  const priv = process.env.VAPID_PRIVATE_KEY?.trim();
  const subj = process.env.VAPID_SUBJECT?.trim();
  if (!pub || !priv || !subj) return false;
  if (pub.includes("REPLACE_ME") || priv.includes("REPLACE_ME")) return false;

  const clientPub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  if (!warnedVapidDrift && clientPub && !clientPub.includes("REPLACE_ME") && clientPub !== pub) {
    warnedVapidDrift = true;
    console.error(
      "[push] VAPID_PUBLIC_KEY and NEXT_PUBLIC_VAPID_PUBLIC_KEY disagree — browsers are subscribing with a key the server does not sign with, and every send to them will be refused (403).",
    );
  }
  return true;
}

/*
  THE MASTER SWITCH IS READ ON EVERY PUSH TO EVERY PERSON.

  A broadcast to every customer on the platform used to become one identical
  settings query PER RECIPIENT, all within the same second. A thirty-second
  cache turns that into one query for the whole burst while still picking up
  an admin's kill switch within half a minute — the right trade-off for a
  switch that exists to stop noise, not to gate emergencies.
*/
const PLATFORM_PUSH_TTL_MS = 30_000;
let platformPushCache: { value: boolean; at: number } | null = null;

async function platformPushEnabled(): Promise<boolean> {
  if (platformPushCache && Date.now() - platformPushCache.at < PLATFORM_PUSH_TTL_MS) {
    return platformPushCache.value;
  }
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "push_enabled")
      .maybeSingle();

    /*
      A FAILED READ IS NOT A KILL SWITCH.

      This returned false on any error, so an unreachable settings table
      silently dropped EVERY push on the platform — no notification, no log,
      nothing anywhere to connect the silence to a database blip. The one
      failure mode a notification system must not have is going quiet without
      saying so.

      The switch exists to stop noise, not to gate emergencies, and its stored
      default is on. So an unanswerable question resolves the way a missing row
      already does — enabled — and the log line is what tells whoever is on
      call that the answer was assumed rather than read.
    */
    if (error) {
      console.error("[push] could not read the platform switch, assuming enabled —", error.message);
      return true;
    }

    const value = data?.value !== "false";
    // Only a successful read is cached. A transient error must not pin an
    // assumed answer for thirty seconds — falling through re-reads next call.
    platformPushCache = { value, at: Date.now() };
    return value;
  } catch (thrown) {
    console.error("[push] platform switch lookup threw, assuming enabled —", (thrown as Error)?.message ?? thrown);
    return true;
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
  /**
   * True for the browser that asked for the test.
   *
   * Without this the report is unreadable in the exact situation it exists
   * for: "sent to 6 devices" says nothing when what you need to know is
   * whether THIS handset is one of the six. An account accumulates endpoints
   * from browsers that no longer exist, and the push service returns 201 for
   * them long after nobody is listening — so a page of green ticks can mean
   * six deliveries into the void.
   */
  isThisDevice?: boolean;
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
export async function sendWebPushWithReport(
  profileId: string,
  payload: PushPayload,
  /** The caller's own endpoint, so its row can be marked in the report. */
  currentEndpoint?: string,
): Promise<{
  configured: boolean;
  platformEnabled: boolean;
  devices: PushDeviceResult[];
  /**
   * True when the subscriptions could not be READ. Distinct from "no
   * devices": a caller showing 'no devices registered' for a database blip
   * would send someone chasing a phone problem that does not exist.
   */
  queryFailed?: boolean;
}> {
  const configured = pushConfigured();
  const platformEnabled = configured ? await platformPushEnabled() : false;
  if (!configured || !platformEnabled) {
    return { configured, platformEnabled, devices: [] };
  }

  const supabase = createAdminClient();
  const { data: subs, error: subsError } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("profile_id", profileId);

  /*
    A FAILED READ IS NOT "NO DEVICES" — same rule as the platform switch
    above. Without this, a PostgREST blip silently dropped every push for
    the recipient, with nothing anywhere connecting the silence to it.
  */
  if (subsError) {
    console.error(`[push] could not read subscriptions for ${profileId} —`, subsError.message);
    return { configured, platformEnabled, devices: [], queryFailed: true };
  }

  const rows = (subs ?? []) as { id: string; endpoint: string; p256dh: string; auth: string }[];
  if (rows.length === 0) return { configured, platformEnabled, devices: [] };

  setVapidDetails();
  const body = payloadBody(payload);

  const sendToDevice = async (sub: (typeof rows)[number]): Promise<PushDeviceResult> => {
    let service = "unknown";
    try {
      service = new URL(sub.endpoint).host;
    } catch {
      // A malformed endpoint is itself worth seeing in the report.
    }
    const endpointTail = sub.endpoint.slice(-12);
    const isThisDevice = currentEndpoint ? sub.endpoint === currentEndpoint : undefined;

    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
        PUSH_OPTIONS,
      );
      const { error: healthError } = await supabase
        .from("push_subscriptions")
        .update({
          last_success_at: new Date().toISOString(),
          last_failure_code: null,
          failure_count: 0,
        })
        .eq("id", sub.id);
      reportHealthWriteError(healthError);
      return { service, endpointTail, status: "sent", isThisDevice };
    } catch (pushError) {
      const code = (pushError as { statusCode?: number })?.statusCode;
      if (code === 404 || code === 410) {
        await supabase.from("push_subscriptions").delete().eq("id", sub.id);
        return {
          service,
          endpointTail,
          status: "expired",
          code,
          isThisDevice,
          detail: "Endpoint gone — the row has been deleted. Re-enable push on that device.",
        };
      } else {
        const { data: failureCount, error: rpcError } = await supabase.rpc("record_push_failure", {
          p_subscription_id: sub.id,
          p_failure_code: code ?? null,
        });
        reportHealthWriteError(rpcError);

        /*
          RETIRE AN ENDPOINT THE SERVICE KEEPS REFUSING OUTRIGHT.

          403 after a VAPID rotation, 401, 400, 413 — permanent-class
          refusals that a retry cannot fix, unlike a network blip or a 5xx.
          After enough of them in a row (any success resets the counter to
          zero above), the row is dead weight: one doomed encrypt + POST per
          notification, forever. Deleting it is safe by construction — a
          device that is actually alive re-registers through PushSync on its
          next open, the same argument the reset flow documents. A null
          count (pre-0044 RPC shape, or the RPC itself failing) never
          prunes: when the answer is unknowable, keep the row.
        */
        const permanent = code === 400 || code === 401 || code === 403 || code === 413;
        const count = typeof failureCount === "number" ? failureCount : null;
        if (permanent && count !== null && count >= 8) {
          await supabase.from("push_subscriptions").delete().eq("id", sub.id);
          return {
            service,
            endpointTail,
            status: "expired",
            code,
            isThisDevice,
            detail: `Retired after ${count} consecutive refusals (HTTP ${code}). The device re-registers on its next app open.`,
          };
        }
        return {
          service,
          endpointTail,
          status: "failed",
          code,
          isThisDevice,
          detail: (pushError as Error)?.message?.slice(0, 200),
        };
      }
    }
  };

  /*
    Bounded fan-out. Promise.all over every row lets one bloated account turn
    a checkout lambda into dozens of concurrent sockets; ten at a time keeps
    the worst case at PUSH_OPTIONS.timeout × ceil(n/10) with no visible
    change for the honest 1–3-device account.
  */
  const devices: PushDeviceResult[] = [];
  const CONCURRENCY = 10;
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    devices.push(...(await Promise.all(rows.slice(i, i + CONCURRENCY).map(sendToDevice))));
  }

  return { configured, platformEnabled, devices };
}

/*
  The 0042/0044 health columns are written on every send, and code and
  migration can deploy in either order. A missing column/function is warned
  once per process (naming the migration), not once per device per send;
  every other error is logged each time — the file's own rule about silence.
*/
let warnedHealthSchemaMissing = false;

function reportHealthWriteError(
  error: { code?: string; message?: string } | null | undefined,
): void {
  if (!error) return;
  const schemaMissing =
    error.code === "42703" || error.code === "PGRST204" || error.code === "PGRST202" || error.code === "42883";
  if (schemaMissing) {
    if (!warnedHealthSchemaMissing) {
      warnedHealthSchemaMissing = true;
      console.error(
        "[push] delivery-health writes are failing — run migrations 0042 and 0044 in the SQL editor. First error:",
        error.message,
      );
    }
    return;
  }
  console.error("[push] delivery-health write failed —", error.message);
}

/**
 * At most 10 stored devices per profile — evict beyond the 10 most recently
 * updated. Honest browsers hold one subscription each, so a real household
 * never hits this; what it caps is fabricated endpoints, each of which
 * would otherwise cost one doomed encrypt-and-POST on EVERY notification to
 * the profile, forever. An evicted real device re-registers through
 * PushSync on its next open. Never throws.
 */
export async function capProfileSubscriptions(profileId: string): Promise<void> {
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("push_subscriptions")
      .select("id")
      .eq("profile_id", profileId)
      .order("updated_at", { ascending: false, nullsFirst: false })
      .range(10, 200);
    const surplus = ((data ?? []) as { id: string }[]).map((r) => r.id);
    if (surplus.length > 0) {
      await supabase.from("push_subscriptions").delete().in("id", surplus);
      console.warn(`[push] evicted ${surplus.length} surplus subscriptions for ${profileId}`);
    }
  } catch (thrown) {
    console.error("[push] subscription cap failed —", (thrown as Error)?.message ?? thrown);
  }
}

/**
 * Deliver one message to one person's browser(s). Never throws.
 *
 * ONE DELIVERY PATH, NOT TWO.
 *
 * This used to carry its own full copy of the send / 404-410 cleanup /
 * record_push_failure logic, parallel to sendPushWithReport's. The copies
 * had already drifted once, and anything fixed in one silently stayed
 * broken in the other. This now delegates to the reporting path and throws
 * away the answer: same encryption, same urgency, same expiry handling,
 * one place to fix.
 */
export async function sendPushWithReport(
  profileId: string, payload: PushPayload, currentEndpoint?: string,
  providerOverride?: "web_push" | "firebase",
): Promise<Awaited<ReturnType<typeof sendWebPushWithReport>>> {
  const provider = providerOverride ?? await notificationProvider();
  if (provider === "web_push") {
    const web = await sendWebPushWithReport(profileId, payload, currentEndpoint);
    // The provider selector controls browsers. Native installations always
    // use FCM; an explicit admin comparison remains a single-provider test.
    if (providerOverride || !firebaseDeliveryConfigured() || !await platformPushEnabled()) return web;
    const native = await sendFirebasePush(profileId, payload, currentEndpoint, true);
    return {
      configured: web.configured || firebaseDeliveryConfigured(),
      platformEnabled: true,
      devices: [...web.devices, ...native.devices],
      queryFailed: web.queryFailed || native.queryFailed,
    };
  }
  const configured = firebaseDeliveryConfigured();
  const platformEnabled = await platformPushEnabled();
  if (!configured || !platformEnabled) return { configured, platformEnabled, devices: [] };
  return { configured, platformEnabled, ...await sendFirebasePush(profileId, payload, currentEndpoint) };
}

export async function sendPush(profileId: string, payload: PushPayload): Promise<void> {
  try {
    await sendPushWithReport(profileId, payload);
  } catch (error) {
    // sendPushWithReport fences every device individually and never throws,
    // but this is the fire-and-forget entry point - it stays fenced too.
    console.error("[push] send failed", error);
  }
}

/** Push to a temporary QR-table guest without creating a customer account. */
export async function sendGuestDiningPush(guestId: string, payload: PushPayload): Promise<void> {
  if (!pushConfigured() || !(await platformPushEnabled())) return;
  const db = createAdminClient();
  const { data, error } = await db.from("dining_guest_push_subscriptions")
    .select("id,endpoint,p256dh,auth").eq("guest_id", guestId);
  if (error) {
    console.error("[push:guest] subscriptions", error.message);
    return;
  }
  if (!data?.length) return;
  setVapidDetails();
  await Promise.allSettled(data.map(async (row) => {
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        payloadBody(payload),
        PUSH_OPTIONS,
      );
    } catch (cause) {
      const status = (cause as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await db.from("dining_guest_push_subscriptions").delete().eq("id", row.id);
      } else {
        console.error("[push:guest] delivery", status ?? (cause as Error).message);
      }
    }
  }));
}
