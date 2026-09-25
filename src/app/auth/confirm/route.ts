import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/auth/safe-next";

/**
 * Where the links in Supabase's own emails land — confirming an account,
 * resetting a password — when the templates in supabase/email-templates are
 * installed.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY NOT /auth/callback.
 *
 *  /auth/callback exchanges a PKCE `code`, and that exchange needs a secret
 *  the requesting browser stored when the reset was asked for. Open the email
 *  anywhere else — the Gmail app, another phone, Chrome instead of the
 *  Android app that asked — and the secret is not there: the link "expires"
 *  on first use. It also only arrives at all if the address is on Supabase's
 *  redirect allow-list; otherwise Supabase drops people on the Site URL, the
 *  landing page, with nothing to do there.
 *
 *  A `token_hash` is verified server-side with nothing but itself, so the
 *  link works in any browser on any device, and the template builds it from
 *  {{ .SiteURL }} — no redirect allow-list involved.
 * ─────────────────────────────────────────────────────────────────────────
 */

const TYPES: EmailOtpType[] = ["recovery", "email", "signup", "invite", "magiclink", "email_change"];

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  /*
    WHERE TO LAND AFTER CONFIRMING.

    An explicit `next` wins. Otherwise the signup template passes Supabase's
    {{ .RedirectTo }} — the emailRedirectTo the sign-up action set, which
    carries `next=/checkout` for someone who signed up mid-order — as
    `redirect_to`. Only its `next` PATH is taken, through the same
    safeNextPath() guard as sign-in; the URL itself is never followed.
  */
  let requested = searchParams.get("next");
  if (!requested) {
    const redirectTo = searchParams.get("redirect_to");
    if (redirectTo) {
      try {
        requested = new URL(redirectTo, origin).searchParams.get("next");
      } catch {
        requested = null;
      }
    }
  }
  const safeNext = safeNextPath(requested) ?? (type === "recovery" ? "/reset-password" : "/account");
  const failed = type === "recovery" ? `${origin}/reset-password/expired` : `${origin}/login?reason=invalid`;

  if (!tokenHash || !type || !TYPES.includes(type)) return NextResponse.redirect(failed);

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  // Expired, already used, or tampered with.
  if (error) return NextResponse.redirect(failed);

  return NextResponse.redirect(`${origin}${safeNext}`);
}
