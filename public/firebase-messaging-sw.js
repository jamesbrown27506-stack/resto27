/* Firebase Cloud Messaging worker. It has a narrow scope and never replaces
   the existing /sw.js worker used by Resto237 order notifications. */
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

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const notification = payload.notification || {};
  const data = payload.data || {};
  const url = payload.fcmOptions?.link || data.href || data.url || "/";
  return self.registration.showNotification(notification.title || data.title || "Resto237", {
    body: notification.body || data.body || "",
    icon: notification.image || "/app-icon-192.png",
    badge: "/app-icon-192.png",
    tag: data.tag || "resto237-firebase",
    data: { url },
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      for (const client of clients) {
        if (!("focus" in client)) continue;
        await client.focus();
        if ("navigate" in client) await client.navigate(url);
        return;
      }
      await self.clients.openWindow(url);
    }),
  );
});
