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

  const options = {
    body: data.body || "",
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    // Renamed (data.href → data.url) because `data.href` is a native
    // Notification property that some browsers drop or overwrite.
    data: { url: data.href || "/" },
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

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
