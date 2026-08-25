/**
 * Service worker — the web push receiver.
 *
 * Registered from the push toggle (settings) and the notification provider.
 * It does two things:
 *
 *   1. push event    → a message arrived from the push service → show the
 *                      OS-level notification.
 *   2. click event   → the user tapped the notification → open the deep link
 *                      it carries (or focus the existing tab and navigate).
 *
 *   3. pushsubscriptionchange
 *                    → the browser threw the subscription away and wants a
 *                      new one → re-subscribe and tell the server, see below.
 *
 * No caching here: the app is fully server-rendered, and an offline shell
 * would serve stale screens. This worker exists for push and nothing else.
 */

/* eslint-disable no-restricted-globals */

self.addEventListener("push", (event) => {
  let data = { title: "RestoLink", body: "", href: "/" };
  try {
    const parsed = event.data ? event.data.json() : {};
    data = { ...data, ...parsed };
  } catch {
    // Unparseable payload — show the title with nothing else rather than
    // dropping the notification entirely.
  }

  event.waitUntil(deliver(data));
});

/**
 * ───────────────────────────────────────────────────────────────────────────
 *  ONE PUSH, TWO DELIVERIES — and which ones fire depends on what is open.
 *
 *  This is the mechanism behind "WhatsApp Web dings while I am in another
 *  app". The tab is still open and its JavaScript still runs; what it lacks
 *  is any way to know a push arrived, because a push wakes the WORKER, not
 *  the page. So the worker tells the page.
 *
 *    · postMessage to every open tab — the page plays the restaurant's own
 *      notification sound and shows its own toast, instantly, with no OS
 *      notification needed. This is the part that was missing.
 *    · showNotification — the OS banner, which is the only thing left when
 *      no tab is open at all, and is REQUIRED on every push regardless:
 *      Chrome subscribes us `userVisibleOnly` and penalises a worker that
 *      takes a push and shows nothing.
 *
 *  When a tab is VISIBLE the banner is shown `silent`, because the page has
 *  already said the same thing in the same second and two alerts for one
 *  event is how people learn to ignore both. When every tab is hidden or
 *  closed, it makes its normal sound.
 * ───────────────────────────────────────────────────────────────────────────
 */
async function deliver(data) {
  const url = data.href || "/";
  // `tag` collapses repeats: five orders in a minute should update one banner,
  // not build a stack of five the manager has to dismiss one at a time.
  const tag = data.tag || "restolink";

  let clients = [];
  try {
    clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  } catch {
    // matchAll can reject in odd states; the banner below still gets shown.
  }

  for (const client of clients) {
    try {
      client.postMessage({
        type: "restolink:notification",
        title: data.title,
        body: data.body || "",
        href: url,
        tone: data.tone || "info",
      });
    } catch {
      // A dead client is not a reason to skip the banner.
    }
  }

  const anyVisible = clients.some((c) => c.visibilityState === "visible");

  return self.registration.showNotification(data.title, {
    body: data.body || "",
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    tag,
    renotify: true,
    // Silent only when a tab is in FRONT and has already announced it. A tab
    // that is merely open — the case this whole change is about — still gets
    // the OS sound, because the user is looking somewhere else entirely.
    silent: anyVisible,
    // Renamed (data.href → data.url) because `data.href` is a native
    // Notification property that some browsers drop or overwrite.
    data: { url },
  });
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        // Focus an existing tab, and only navigate if it is not already there
        // — navigating a tab that is already on the URL resets its scroll.
        if ("focus" in client) {
          client.focus();
          if (new URL(client.url).pathname !== new URL(url, self.location.origin).pathname) {
            client.navigate(url);
          }
          return;
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

/**
 * ───────────────────────────────────────────────────────────────────────────
 *  THE SUBSCRIPTION EXPIRED, AND NOTHING NOTICED.
 *
 *  A push subscription is not permanent. Chrome rotates it, Android drops it
 *  when the app is force-stopped or the battery optimiser reaps the process,
 *  and any browser invalidates it after a long enough silence. When that
 *  happens the browser fires `pushsubscriptionchange` — and with no listener
 *  for it, the endpoint we have stored is now dead.
 *
 *  What that looked like: notifications simply stopped. The switch in settings
 *  still read "on", because the PREFERENCE was still on; only the endpoint had
 *  died. Turning the switch off and on again fixed it, because that path
 *  subscribes from scratch — which is exactly the manual workaround people
 *  ended up performing, repeatedly, without knowing why.
 *
 *  So: re-subscribe here, with the same VAPID key, and hand the new endpoint
 *  to the server. The old one is sent along so the server can retire it rather
 *  than accumulate a dead row per rotation.
 *
 *  The key is fetched rather than inlined: this file is served as a static
 *  asset with no build-time substitution, and a key baked in by hand is a key
 *  that goes stale the first time it is rotated.
 * ───────────────────────────────────────────────────────────────────────────
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(resubscribe(event));
});

async function resubscribe(event) {
  try {
    const response = await fetch("/api/push/sync", { credentials: "include" });
    if (!response.ok) return;
    const { key } = await response.json();
    if (!key) return;

    const subscription = await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64ToUint8Array(key),
    });

    await fetch("/api/push/sync", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: subscription.endpoint,
        p256dh: arrayBufferToBase64(subscription.getKey("p256dh")),
        auth: arrayBufferToBase64(subscription.getKey("auth")),
        // Retire the dead endpoint in the same round trip.
        previousEndpoint: event.oldSubscription ? event.oldSubscription.endpoint : null,
      }),
    });
  } catch (error) {
    // Nothing to recover to. The page-side sync (components/notifications/
    // push-sync) runs on the next app open and repairs it there.
    console.error("[sw] resubscribe failed", error);
  }
}

/** URL-safe base64 → bytes, the encoding the VAPID public key arrives in. */
function base64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = self.atob(normalised);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function arrayBufferToBase64(buffer) {
  if (!buffer) return "";
  return self.btoa(String.fromCharCode.apply(null, new Uint8Array(buffer)));
}
