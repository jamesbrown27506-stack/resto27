import { registerPlugin } from "@capacitor/core";
import { nativePlatform } from "@/lib/capacitor/platform";

interface UssdDialerPlugin {
  dial(options: { code: string }): Promise<{ started: boolean; direct: boolean }>;
}

const UssdDialer = registerPlugin<UssdDialerPlugin>("UssdDialer");

/** The only codes the app will dial by itself: Orange Money's "#150*…#". */
export function isOrangeMoneyCode(code: string): boolean {
  return /^#150\*[0-9*]{3,60}#$/.test(code);
}

/**
 * Dial an Orange Money code from the Android app, without the extra tap.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  A `tel:` LINK ONLY OPENS THE DIALLER. THE APP CAN PLACE THE CALL.
 *
 *  Since Orange made the customer start every payment, the code has to be
 *  dialled on their phone. In a browser the best a page can do is open the
 *  dialler with the code typed in — the customer still presses call. The
 *  Android app has UssdDialerPlugin, which asks once for the phone permission
 *  and then runs the code directly; refused, it opens the dialler instead.
 *
 *  Returns false when nothing native handled it — a browser, an iPhone (iOS
 *  will not dial `*` or `#` from any link), or an installed APK older than
 *  the plugin — and the caller falls back to the `tel:` link.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function dialUssd(code: string): Promise<boolean> {
  if (nativePlatform() !== "android" || !isOrangeMoneyCode(code)) return false;
  try {
    return (await UssdDialer.dial({ code })).started;
  } catch {
    return false;
  }
}
