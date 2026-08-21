import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";

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
 *  Both are gated on the session cookie (the worker sends it with
 *  `credentials: "include"`), so a subscription can only ever be attached to
 *  whoever is actually signed in on that device.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** The session cookie is per-request; nothing here may be cached. */
export const dynamic = "force-dynamic";

function vapidPublicKey(): string | null {
  const key = (process.env.VAPID_PUBLIC_KEY ?? process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY)?.trim();
  if (!key || key.includes("REPLACE_ME")) return null;
  return key;
}

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ key: null }, { status: 401 });

  const key = vapidPublicKey();
  if (!key) return NextResponse.json({ key: null }, { status: 503 });

  return NextResponse.json({ key });
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

  const { endpoint, p256dh, auth, previousEndpoint } = (body ?? {}) as Record<string, unknown>;

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

  return NextResponse.json({ ok: true });
}
