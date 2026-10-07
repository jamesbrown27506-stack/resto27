import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/auth/safe-next";
import { issueRecoveryGrant, recordMailboxProof } from "@/lib/auth/security";
import { sessionIdentity } from "@/lib/auth/security-rules";

/**
 * Where Supabase sends people back after they click a link in an email —
 * confirming a new account, or starting a password reset.
 *
 * The link carries a one-time `code`; exchanging it for a session is what
 * actually signs them in.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/account";

  /**
   * OPEN REDIRECT GUARD.
   *
   * `next` comes from a URL in an email, which means an attacker can craft
   * one. Without this check, `/auth/callback?next=https://evil.example` sends
   * a freshly authenticated user straight off our domain — a classic phishing
   * chain. Only same-site paths are allowed, and `//` is rejected because
   * `//evil.example` is a protocol-relative URL, not a path.
   */
  const safeNext = safeNextPath(next) ?? "/account";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?reason=invalid`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // Expired, already used, or tampered with. The reset screen has a dedicated
    // "this link is no longer valid" state rather than a generic failure.
    return NextResponse.redirect(`${origin}/reset-password/expired`);
  }

  const identity = data.session ? sessionIdentity(data.session.access_token) : null;
  try {
    if (identity?.recentOtp && data.user && identity.userId === data.user.id) await recordMailboxProof(data.user);
    if (safeNext === "/reset-password") {
      if (!identity?.recentOtp || !data.session) return NextResponse.redirect(`${origin}/reset-password/expired`);
      await issueRecoveryGrant(data.session);
    }
  } catch {
    return NextResponse.redirect(`${origin}/reset-password/expired`);
  }
  return NextResponse.redirect(`${origin}${safeNext}`);
}
