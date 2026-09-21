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

/*
 * ───────────────────────────────────────────────────────────────────────────
 *  A NEW WORKER TAKES OVER AT ONCE, INSTEAD OF WHENEVER THE APP IS NEXT SHUT.
 *
 *  By default a freshly installed service worker sits in `waiting` until
 *  every tab and window using the old one has CLOSED. An installed PWA on a
 *  phone is almost never closed — it is swiped away and resumed — so a fix
 *  shipped to this file could sit unused on the one platform that needed it
 *  most, for days, while the app appeared to be up to date.
 *
 *  `skipWaiting` promotes it immediately; `clients.claim` puts existing
 *  windows under it without a reload. Safe here because this worker holds no
 *  cache and serves no assets: there is no half-old, half-new state for a
 *  page to be caught between. It only receives pushes, and receiving them
 *  with the newest code is always the right answer.
 * ───────────────────────────────────────────────────────────────────────────
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = { title: "RestoLink", body: "", href: "/" };
  try {
    const parsed = event.data ? event.data.json() : {};
    data = { ...data, ...parsed };
  } catch {
    // Unparseable payload — show the title with nothing else rather than
    // dropping the notification entirely.
  }

  /*
    THE CATCH IS NOT DECORATION.

    A push handler whose waitUntil rejects is, to Chrome, a worker that took a
    push and showed nothing: it posts "This site has been updated in the
    background" over the top and counts the origin as misbehaving. So every
    failure inside `deliver` falls back to the plainest banner that can still
    be built — the title alone, no tag, no options that can throw.
  */
  event.waitUntil(
    deliver(data).catch((error) => {
      console.error("[sw] deliver failed", error);
      return self.registration.showNotification(data.title, {
        body: data.body || "",
        icon: data.icon || "/app-icon-192.png",
        data: { url: data.href || "/" },
      });
    }),
  );
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

  /*
    THE BANNER MUST NEVER WAIT ON THIS.

    On a phone the worker is started cold, by a push, on a device that was
    asleep a second ago — and Chrome gives it a short budget to show something
    before deciding it misbehaved and posting "This site has been updated in
    the background" over the top. `matchAll` is normally instant, but a cold
    start is exactly when it might not be, and the client list is only needed
    to decide whether the banner should be SILENT. That is a refinement; the
    banner itself is the point.

    So it is raced against a short timer: if the answer is not back quickly,
    carry on as though no tab is open, which is the safe assumption — it makes
    a sound rather than staying quiet.
  */
  let clients = [];
  try {
    clients = await Promise.race([
      self.clients.matchAll({ type: "window", includeUncontrolled: true }),
      new Promise((resolve) => setTimeout(() => resolve([]), 800)),
    ]);
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

  /*
    ────────────────────────────────────────────────────────────────────────
     `silent` AND `vibrate` CANNOT BOTH BE PRESENT. THE SPEC THROWS.

     The Notifications spec is explicit: creating a notification with
     options["silent"] true while options["vibrate"] exists raises a
     TypeError. So a banner built with a vibration pattern AND silent:true —
     which is exactly what a VISIBLE tab produced here — never showed at all.
     showNotification rejected, waitUntil rejected with it, and Chrome posted
     its own "This site has been updated in the background" over the top.

     The pattern is therefore attached only when the banner will make noise.
     A silent banner has nothing to vibrate for anyway: the tab in front of
     the person has already said the same thing.
    ────────────────────────────────────────────────────────────────────────
  */
  /*
    Buttons on the banner (Android + desktop Chromium; platforms without
    notification actions simply ignore them). Each button is a DEEP LINK —
    the titles come from the server in the recipient's language, and the
    per-action URLs ride in `data.actionUrls` for the click handler. No
    mutation happens from the notification itself.
  */
  const actionUrls = {};
  let actions;
  if (Array.isArray(data.actions) && data.actions.length > 0 && "actions" in Notification.prototype) {
    actions = [];
    for (const a of data.actions.slice(0, 2)) {
      if (!a || typeof a.action !== "string" || typeof a.title !== "string") continue;
      actions.push({ action: a.action, title: a.title });
      if (typeof a.href === "string") actionUrls[a.action] = a.href;
    }
    if (actions.length === 0) actions = undefined;
  }

  const options = {
    body: data.body || "",
    /*
      THE RECIPIENT'S LANGUAGE, NOT THE DEVICE'S. The server builds each
      push in the person's own chosen language; passing it here means the
      OS renders — and screen readers read — the banner correctly even
      when that differs from the phone's system language.
    */
    lang: data.lang || undefined,
    /*
      STICKY ONLY WHERE IT EARNS ITS KEEP. The server marks critical
      operational events (a new order, a chat message) requireInteraction,
      which keeps the banner up until dismissed on desktop. It is applied
      here only when no window is visible: a banner nobody is looking at
      must wait for them; one sitting under their eyes must not trap them.
    */
    requireInteraction: Boolean(data.requireInteraction) && !anyVisible,
    /*
      A REAL ICON, NOT THE FAVICON. Android draws the notification icon at
      64dp and the .ico is 16–32px: it arrived as a smear, or as Chrome's
      default globe when the decode failed outright. app-icon-192.png is the
      same file the installed app uses, so the banner matches the home screen.
    */
    icon: data.icon || "/app-icon-192.png",
    badge: data.badge || "/notification-badge.png",
    tag,
    renotify: true,
    // Survive a device that wakes, shows, and sleeps again before it is read.
    timestamp: Date.now(),
    // Silent only when a tab is in FRONT and has already announced it. A tab
    // that is merely open — the case this whole change is about — still gets
    // the OS sound, because the user is looking somewhere else entirely.
    silent: anyVisible,
    // Renamed (data.href → data.url) because `data.href` is a native
    // Notification property that some browsers drop or overwrite.
    data: { url, actionUrls },
  };

  if (actions) options.actions = actions;

  if (!anyVisible) {
    // A phone in a pocket is the case this whole change is about, and a
    // pocket cannot see a screen. Ignored on desktop.
    options.vibrate = [200, 100, 200];
  }

  await self.registration.showNotification(data.title, options);

  /*
    THE LAUNCHER BADGE, FROM THE WORKER. The page mirrors the unread count
    while a tab lives; a push arriving with the app fully closed used to
    leave the badge frozen at whatever some tab last wrote. Fetched after
    the banner — the banner must never wait on a network round trip — and
    every failure (signed out, offline, no Badging API) degrades to nothing.
  */
  await refreshAppBadge();
}

async function refreshAppBadge() {
  if (!("setAppBadge" in self.navigator)) return;
  try {
    const response = await fetch("/api/push/sync", { credentials: "include" });
    if (!response.ok) return;
    const { unread } = await response.json();
    if (typeof unread !== "number") return;
    if (unread > 0) await self.navigator.setAppBadge(unread);
    else await self.navigator.clearAppBadge();
  } catch {
    // The badge is a refinement; the banner already showed.
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw =
    (event.action && event.notification.data?.actionUrls?.[event.action]) ||
    event.notification.data?.url || "/";
  let target;
  try {
    target = new URL(raw, self.location.origin);
    if (target.origin !== self.location.origin) target = new URL("/", self.location.origin);
  } catch {
    target = new URL("/", self.location.origin);
  }
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const key = target.pathname + target.search;
    for (const client of windows) {
      try {
        const current = new URL(client.url);
        if (current.origin === target.origin && current.pathname + current.search === key) {
          await client.focus();
          await refreshAppBadge();
          return;
        }
      } catch {
        // A stale or invalid tab must not swallow the notification click.
      }
    }
    for (const client of windows) {
      try {
        if (new URL(client.url).origin !== target.origin) continue;
        const navigated = await client.navigate(target.href);
        if (navigated) {
          await navigated.focus();
          await refreshAppBadge();
          return;
        }
      } catch {
        // An installed browser window may reject navigation. Open the exact
        // product URL in a new window instead of leaving the click unhandled.
      }
    }
    await self.clients.openWindow(target.href);
    await refreshAppBadge();
  })());
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
        expirationTime:
          subscription.expirationTime == null
            ? null
            : new Date(subscription.expirationTime).toISOString(),
        userAgent: self.navigator.userAgent.slice(0, 500),
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
