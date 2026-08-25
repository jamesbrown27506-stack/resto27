import { notificationSoundUrl } from "@/lib/notification-sound";

/**
 * The notification sound, playable from a TAB THAT IS NOT BEING LOOKED AT.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY THIS IS A SINGLETON AND NOT `new Audio()` PER DING.
 *
 *  This is how WhatsApp Web can ding while you are in another application:
 *  the tab is still open, its JavaScript still runs, and a WebSocket message
 *  still arrives — a background tab is throttled, not frozen. The part that
 *  stops most apps is the browser's autoplay policy, and the way through it
 *  is not a permission, it is a HABIT the browser records about this page.
 *
 *  Chrome and Safari both track whether audio on this origin has ever played
 *  as the result of a real interaction. `new Audio(url).play()`, constructed
 *  fresh at the moment a notification lands, asks a cold element to start
 *  playing in a tab nobody has touched in ten minutes — which is precisely
 *  the pattern the policy was written to refuse.
 *
 *  So: ONE element, created once, played once through while the user's very
 *  first click is still on the stack — muted, so they never hear it. From
 *  then on the element is a known quantity that has already played, and
 *  `play()` on it is allowed whether or not the tab is in front.
 *
 *  Reusing it also means the file is fetched and decoded once. A cold
 *  element has to download the sound before it can play it, so the first
 *  ding of a session arrives late — exactly when someone is deciding whether
 *  the feature works.
 * ─────────────────────────────────────────────────────────────────────────
 */

let element: HTMLAudioElement | null = null;
let currentUrl = "";
let unlocked = false;

/** Volume for every notification. Loud enough to hear across a room, not a jump-scare. */
const VOLUME = 0.6;

function ensureElement(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (element) return element;

  element = new Audio();
  element.preload = "auto";
  element.volume = VOLUME;
  // Never let the sound hold a screen-wake or show media controls: this is a
  // notification, not media the user chose to play.
  element.setAttribute("playsinline", "");
  return element;
}

function setSource(audio: HTMLAudioElement, soundName: string | null | undefined) {
  const url = notificationSoundUrl(soundName);
  if (url === currentUrl) return;
  currentUrl = url;
  audio.src = url;
  audio.load();
}

/**
 * Bless the audio element with the user's first interaction.
 *
 * Called from a real `pointerdown` / `keydown` handler, which is the only
 * moment `play()` is guaranteed to be granted. It plays MUTED and stops
 * immediately, so the user hears nothing — the point is not the sound, it is
 * that this element has now played once with permission.
 *
 * Safe to call repeatedly; it does its work once.
 */
export function unlockNotificationSound(soundName?: string | null): void {
  const audio = ensureElement();
  if (!audio || unlocked) return;

  setSource(audio, soundName);

  const previousMuted = audio.muted;
  audio.muted = true;

  const attempt = audio.play();
  if (attempt === undefined) {
    unlocked = true;
    audio.muted = previousMuted;
    return;
  }

  void attempt
    .then(() => {
      audio.pause();
      audio.currentTime = 0;
      unlocked = true;
    })
    .catch(() => {
      // Not fatal. The element stays usable, `play()` is simply still subject
      // to the policy — the next real interaction gets another chance.
    })
    .finally(() => {
      audio.muted = previousMuted;
    });
}

/** True once the browser has let the element play. Drives the "sound is blocked" hint. */
export function isNotificationSoundUnlocked(): boolean {
  return unlocked;
}

export type SoundResult = "played" | "blocked" | "failed" | "unsupported";

/**
 * Play the notification sound, wherever the tab happens to be.
 *
 * Deliberately does NOT check `document.hidden`. A hidden tab is the entire
 * reason this exists: the sound's job is to reach someone who is looking at
 * something else, and a restaurant that misses an order because it had a
 * different tab in front is exactly the failure being fixed.
 *
 * `currentTime = 0` before every play so two notifications a second apart are
 * two audible dings rather than one, which is how a busy service sounds
 * different from a quiet one.
 */
export async function playNotificationSound(
  soundName?: string | null,
): Promise<SoundResult> {
  const audio = ensureElement();
  if (!audio) return "unsupported";

  try {
    setSource(audio, soundName);
    audio.volume = VOLUME;
    audio.muted = false;
    audio.currentTime = 0;
    await audio.play();
    unlocked = true;
    return "played";
  } catch (error) {
    // NotAllowedError means the page has not been interacted with yet — the
    // expected, harmless case, and not worth a console warning on every ding.
    if ((error as Error)?.name === "NotAllowedError") return "blocked";
    console.warn("[notify] sound failed", currentUrl, error);
    return "failed";
  }
}
