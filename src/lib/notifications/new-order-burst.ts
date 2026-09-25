import "server-only";

import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { notify, type NotifyParams } from "@/lib/notify";

/**
 * Make a new order ring a phone whose app is CLOSED — a few times, not once.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  The in-app alarm rings every few seconds until someone accepts, but only
 *  while the app is open. A closed app hears exactly one push, and one short
 *  buzz in a noisy kitchen is easy to miss. So the push is re-sent twice,
 *  five seconds apart (≈ three rings in the first ten seconds). Same
 *  reference → same collapse tag → the banner is REPLACED and re-buzzes
 *  (renotify), it does not stack three copies.
 *
 *  Push only: the in-app row and the email were already written by the
 *  first notify(). Each repeat first checks the order is still `pending` —
 *  accepted or cancelled in between means silence. After that, the order-nag
 *  cron re-rings every five minutes until the time limit.
 *
 *  Runs in `after()`, once the customer's response is sent: the waits are
 *  idle time, not CPU, so this costs two small reads and two push fan-outs.
 * ─────────────────────────────────────────────────────────────────────────
 */
const REPEAT_DELAYS_MS = [5_000, 5_000];

export function scheduleNewOrderRepeats(input: {
  orderId: string;
  restaurantId: string;
  params: NotifyParams;
}): void {
  after(async () => {
    const supabase = createAdminClient();
    for (const delay of REPEAT_DELAYS_MS) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      const { data } = await supabase.from("orders").select("status").eq("id", input.orderId).maybeSingle();
      if (data?.status !== "pending") return;
      await notify({
        event: "new_order",
        tone: "success",
        restaurantId: input.restaurantId,
        href: `/m/orders/${input.orderId}`,
        params: input.params,
        channels: { inApp: false, email: false, push: true },
      });
    }
  });
}
