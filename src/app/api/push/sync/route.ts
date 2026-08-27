import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { capProfileSubscriptions } from "@/lib/push";

/**
 * Push subscription repair, over HTTP rather than a Server Action.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY A ROUTE AND NOT AN ACTION.
 *
 *  Everything else that touches `push_subscriptions` goes through
 *  lib/data/notify-actions. The one caller that CANNOT is the service worker:
 *  a Server Action is invoked by the React client runtime, which does not
 *  exist inside a worker. The worker is also the only context that learns
 *  about `pushsubscriptionchange` — the event that fires when the browser
 *  throws a subscription away — so it needs a plain endpoint to report to.
 *
 *  GET  → the VAPID public key, so the worker can re-subscribe. The key is
 *         public by design; it is the half that ships in the browser bundle
 *         already. The private half never leaves the server.
 *  POST → store this endpoint for the signed-in profile, and retire the one
 *         it replaced.
 *
 *  The POST is gated on the session cookie (the worker sends it with
 *  `credentials: "include"`), so a subscription can only ever be attached to
 *  whoever is actually signed in on that device. The GET is not — see the
 *  note on it.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** The session cookie is per-request; nothing here may be cached. */
export const dynamic = "force-dynamic";

function vapidPublicKey(): string | null {
  const key = (process.env.VAPID_PUBLIC_KEY ?? process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY)?.trim();
  if (!key || key.includes("REPLACE_ME")) return null;
  return key;
}

/**
 * The VAPID public key. DELIBERATELY UNAUTHENTICATED.
 *
 * It used to require a session, and that was a dependency with a cost and no
 * benefit. The key is public by definition — the same bytes are compiled into
 * every page's JavaScript bundle as NEXT_PUBLIC_VAPID_PUBLIC_KEY, so gating
 * this reveals nothing that curling the homepage does not.
 *
 * The cost is real: the caller is a service worker handling
 * `pushsubscriptionchange`, woken by the browser with no page in scope, on a
 * handset whose cookies may or may not travel with a worker-initiated fetch.
 * A 401 there ends the re-subscribe, and the device is left with a
 * subscription the server has never heard of until the next app open.
 *
 * The POST below stays gated, and must: it attaches an endpoint to a profile.
 */
export async function GET() {
  const key = vapidPublicKey();
  if (!key) return NextResponse.json({ key: null }, { status: 503 });

  /*
    The unread count rides along FOR A SIGNED-IN CALLER ONLY — it is what
    lets the service worker keep the launcher badge honest when a push
    arrives with every tab closed. The key half stays unauthenticated (see
    the note above); a signed-out caller simply gets no count.
  */
  let unread: number | undefined;
  try {
    const profile = await getCurrentProfile();
    if (profile) {
      const supabase = createAdminClient();
      const { count, error } = await supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("profile_id", profile.id)
        .is("read_at", null);
      if (!error) unread = count ?? 0;
    }
  } catch {
    // The key is the contract; the count is a refinement.
  }

  return NextResponse.json(unread === undefined ? { key } : { key, unread });
}

export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ ok: false }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed body." }, { status: 400 });
  }

  const { endpoint, p256dh, auth, previousEndpoint, expirationTime, userAgent } = (body ?? {}) as Record<
    string,
    unknown
  >;

  if (
    typeof endpoint !== "string" ||
    typeof p256dh !== "string" ||
    typeof auth !== "string" ||
    // The same validation savePushSubscription applies: an endpoint is always
    // an https URL on the browser vendor's push service.
    !endpoint.startsWith("https://") ||
    !p256dh ||
    !auth
  ) {
    return NextResponse.json({ ok: false, error: "Invalid subscription." }, { status: 400 });
  }

  const supabase = createAdminClient();

  const baseRow = {
    profile_id: profile.id,
    endpoint,
    p256dh,
    auth,
    user_agent: typeof userAgent === "string" ? userAgent.slice(0, 500) : null,
    updated_at: new Date().toISOString(),
  };
  const expiration =
    typeof expirationTime === "string" && !Number.isNaN(Date.parse(expirationTime))
      ? expirationTime
      : null;

  let { error } = await supabase.from("push_subscriptions").upsert(
    { ...baseRow, expiration_time: expiration },
    { onConflict: "endpoint" },
  );

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
    console.error("[api:push/sync]", error.message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  /*
    Retire the endpoint this one replaced.

    Without it a device accumulates one dead row per rotation, and every
    notification then spends a round trip on each corpse before reaching the
    live one. Scoped to this profile so a stale endpoint cannot be used to
    delete somebody else's subscription.
  */
  if (typeof previousEndpoint === "string" && previousEndpoint && previousEndpoint !== endpoint) {
    await supabase
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", previousEndpoint)
      .eq("profile_id", profile.id);
  }

  await capProfileSubscriptions(profile.id);

  return NextResponse.json({ ok: true });
}
