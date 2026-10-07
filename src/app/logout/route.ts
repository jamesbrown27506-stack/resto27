import { NextResponse, type NextRequest } from "next/server";
import { removeFirebaseDevice } from "@/lib/data/firebase-actions";
import { createClient } from "@/lib/supabase/server";

/**
 * Sign out (§14.2). Clears the session and the auth cookies.
 *
 * POST is the real one: sign-out is a state change, and a GET route can be
 * fired by any `<img src="/logout">` on a page the user visits — logging them
 * out of our app from someone else's site. GET only navigates to the account.
 */
function requestOrigin(request: NextRequest): string {
  const url = new URL(request.url);
  // Next normalizes loopback IPs to localhost internally. Preserve the actual
  // HTTP Host so legitimate forms from 127.0.0.1 still pass the origin check.
  const host = request.headers.get("host");
  if (host) url.host = host;
  return url.origin;
}

async function handle(request: NextRequest) {
  const origin = requestOrigin(request);
  if (request.headers.get("origin") !== origin) {
    return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  }
  const supabase = await createClient();
  await removeFirebaseDevice();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", origin), { status: 303 });
}

export const POST = handle;
// Cross-site navigation and link prefetching must not revoke a session.
export function GET(request: NextRequest) {
  return NextResponse.redirect(new URL("/account", requestOrigin(request)), { status: 303 });
}
