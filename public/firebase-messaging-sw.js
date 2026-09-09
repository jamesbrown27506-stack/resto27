/* Separate worker scope keeps both delivery providers registered. */
function safeUrl(value) {
  try { const url = new URL(value || "/", self.location.origin); return url.origin === self.location.origin ? url.href : self.location.origin + "/"; }
  catch { return self.location.origin + "/"; }
}
// Register before the SDK; Firebase handles its own console campaign clicks.
self.addEventListener("notificationclick", (event) => {
  if (!event.notification.data?.restoFirebase) return;
  event.stopImmediatePropagation();
  event.notification.close();
  const data = event.notification.data;
  const url = safeUrl(data.actionUrls?.[event.action] || data.url);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      const navigated = await client.navigate(url);
      if (navigated) { await navigated.focus(); return; }
    }
    await self.clients.openWindow(url);
  })());
});
self.addEventListener("install", () => self.skipWaiting());
importScripts("https://www.gstatic.com/firebasejs/12.18.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.18.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDSsnrhDiwsdkUhFhO0DgTdaaGR3yFRDXI",
  authDomain: "resto237-da372.firebaseapp.com",
  projectId: "resto237-da372",
  storageBucket: "resto237-da372.firebasestorage.app",
  messagingSenderId: "1052805248703",
  appId: "1:1052805248703:web:c3aebfb283c313cc3ab80a",
});

firebase.messaging().onBackgroundMessage((message) => {
  // Console notification payloads are displayed automatically by the SDK.
  if (message.notification) return;
  let payload;
  try { payload = JSON.parse(message.data?.payload || "{}"); } catch { return; }
  if (!payload.title) return;
  const actions = Array.isArray(payload.actions) ? payload.actions.slice(0, 2) : [];
  return self.registration.showNotification(payload.title, {
    body: payload.body || "", icon: payload.icon || "/app-icon-192.png",
    badge: payload.badge || "/notification-badge.png",
    tag: payload.tag || message.messageId,
    lang: payload.lang, requireInteraction: Boolean(payload.requireInteraction),
    actions: actions.map(a => ({ action: a.action, title: a.title })),
    data: { restoFirebase: true, url: safeUrl(payload.href),
      actionUrls: Object.fromEntries(actions.map(a => [a.action, safeUrl(a.href)])) },
  });
});
