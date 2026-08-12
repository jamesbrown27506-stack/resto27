import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Sign out (§14.2). Clears the session and the auth cookies.
 *
 * POST is the real one: sign-out is a state change, and a GET route can be
 * fired by any `<img src="/logout">` on a page the user visits — logging them
 * out of our app from someone else's site. GET is kept only so a plain link in
 * the nav works, and it is the reason the nav uses a form-backed button
 * wherever it can.
 */
async function handle(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}

export const POST = handle;
export const GET = handle;
