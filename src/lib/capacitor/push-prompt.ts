/**
 * Whether the native app should offer push notifications, and how.
 *
 * Nobody opens their settings to look for a notifications switch, so without
 * an offer almost every installed app stayed silent — and a restaurant that
 * does not hear its orders is the costliest version of that. The offer comes
 * as soon as someone is signed in, and stays quiet for anyone who has already
 * decided: registered, switched push off in their account, or switched this
 * device off in the notification settings.
 *
 * Pure, so the rules are tested without a phone.
 */

/** "Not now" holds for an hour — the same retry the website's banners use. */
export const NATIVE_PROMPT_COOLDOWN_MS = 60 * 60 * 1000;

/**
 * `ask` offers the button that opens Android's permission dialog. `blocked`
 * means Android will no longer show that dialog, so the offer explains where
 * the phone setting is instead.
 */
export type NativePushOffer = "ask" | "blocked" | null;

export function nativePushOffer(input: {
  signedIn: boolean;
  /** The account-level preference; off means they said no everywhere. */
  wantsPush: boolean;
  /** This device is already registered for push. */
  enabled: boolean;
  /** The OS permission: "granted", "denied", "prompt" or "prompt-with-rationale". */
  permission: string;
  /** This device was switched off in the notification settings. */
  optedOut: boolean;
  /** When "Not now" was last pressed, in ms since the epoch. */
  dismissedAt: number | null;
  now: number;
}): NativePushOffer {
  if (!input.signedIn || !input.wantsPush || input.optedOut) return null;
  if (input.enabled && input.permission === "granted") return null;
  if (input.dismissedAt !== null && input.now - input.dismissedAt < NATIVE_PROMPT_COOLDOWN_MS) return null;
  return input.permission === "denied" ? "blocked" : "ask";
}
