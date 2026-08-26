import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase session on every request.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE `getUser()` CALL BELOW IS THE ENTIRE POINT OF THIS FILE.
 *
 *  The dashboard boilerplate builds the client and returns the response
 *  without ever calling it. That version compiles, runs, and does nothing:
 *  access tokens expire after an hour and are never refreshed, so users are
 *  silently signed out mid-session with no error in any log.
 *
 *  Server Components cannot write cookies. Middleware can. So this is the only
 *  place a refreshed token can actually be persisted.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Write to the request first so anything downstream in this same
          // pass sees the new token, then rebuild the response so the cookies
          // actually reach the browser.
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          supabaseResponse = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            supabaseResponse.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  /*
    Do not remove, and do not put code between createServerClient and here.
    getUser() verifies the token against the auth server (getSession() only
    decodes the cookie, which can be forged) and triggers the refresh.

    ─────────────────────────────────────────────────────────────────────────
     FENCED, BECAUSE THIS RUNS ON EVERY REQUEST ON THE PLATFORM.

     `getUser()` is a network call. supabase-js reports auth problems in
     `error` rather than by throwing, but a FETCH failure — DNS, a TLS reset, a
     Supabase blip — rejects. Unfenced, that rejection propagates out of the
     proxy and every request on the site answers 500 until the auth host comes
     back: not the signed-in pages, ALL of them, including the marketing
     homepage that needs no session and the service worker script that needs
     no session either.

     Treating a failed verification as "nobody is signed in" degrades exactly
     as far as it should. A visitor still gets the public site; a signed-in
     user is bounced to /login by the guard below, which is the correct
     outcome when the platform genuinely cannot verify who they are. The log
     line is what tells whoever is on call which of the two happened.
    ─────────────────────────────────────────────────────────────────────────
  */
  let user = null;
  try {
    const result = await supabase.auth.getUser();
    user = result.data.user;
  } catch (error) {
    console.error("[proxy] session verification failed —", (error as Error)?.message ?? error);
  }

  return { supabaseResponse, user };
}
