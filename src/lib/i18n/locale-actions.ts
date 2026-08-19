"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/session";
import { LOCALES, type Locale } from "./dictionaries";

/**
 * Remember which language this person reads, ON THEIR PROFILE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE COOKIE IS NOT ENOUGH, AND THE REASON IS WORTH STATING.
 *
 *  The FR/EN toggle writes a cookie, which is correct for rendering: it is
 *  per-device, it is readable during SSR, and it works before anyone has
 *  signed in.
 *
 *  But a notification is not rendered. It is COMPOSED — in an order
 *  confirmation, a review reply, the billing sweep — by server code running
 *  with no request in scope, no cookie to read and the recipient nowhere
 *  near a browser. lib/notify therefore had no way to know anyone's
 *  preference and hardcoded French for every non-admin, which is why the
 *  bell, the emails and the push notifications all stayed French however the
 *  toggle was set.
 *
 *  So the choice is written to `profiles.locale` (migration 0036) as well as
 *  to the cookie. Two stores, two jobs: the cookie renders the page in front
 *  of you, the column addresses you when you are not there.
 *
 *  FIRE AND FORGET, DELIBERATELY. Nothing about switching language should be
 *  able to fail visibly: an anonymous visitor has no profile to write to
 *  (and gets the cookie alone, which is the whole answer for them), and a
 *  failed write costs a French email, not a broken page. It never throws and
 *  its result is not awaited by the toggle.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function rememberLocale(next: Locale): Promise<void> {
  if (!(LOCALES as readonly string[]).includes(next)) return;

  try {
    // Not signed in — the cookie already carries the preference, and there is
    // no row to attach it to. Not an error.
    const profile = await getCurrentProfile();
    if (!profile) return;

    const supabase = createAdminClient();
    const { error } = await supabase
      .from("profiles")
      .update({ locale: next })
      .eq("id", profile.id);

    if (error) {
      // 42703 = the column does not exist, i.e. migration 0036 has not run.
      // Named rather than swallowed, because the symptom otherwise is
      // "notifications are still in French" with nothing to go on.
      console.error(
        "[locale:rememberLocale]",
        error.code === "42703"
          ? "profiles.locale is missing — run migration 0036"
          : error.message,
      );
    }
  } catch (error) {
    console.error("[locale:rememberLocale]", error);
  }
}
