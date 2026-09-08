# Mobile background notification integration

The current Next.js app already registers public/sw.js, subscribes browsers, saves subscriptions, and sends Web Push from order events. See NOTIFICATIONS_SETUP.md for VAPID and database setup. No server secrets belong in an Android package.

The shared notification settings panel now shows Android/iPhone instructions in French and English. Desktop remains unchanged. On Android, the native settings button appears only when the wrapper supplies Resto237DeviceSettings. Opening settings is not recorded as permission granted, and there is no automatic exemption request.

## Android WebView wrapper

This repository does not contain a generated Android project. DeviceSettingsBridge.kt is integration source, not an installed or compiled Android app.

1. Copy DeviceSettingsBridge.kt into your Android app's source tree. Its package is com.resto237.integration; import that object from your Activity.
2. Add the AndroidX WebKit dependency appropriate to your Android project (the bridge uses WEB_MESSAGE_LISTENER and addWebMessageListener).
3. Call DeviceSettingsBridge.install(this, webView) on the UI thread before loading https://resto237.vercel.app. Use your Activity instance if called elsewhere.
4. If your production origin changes, update the exact HTTPS origin in the bridge. Do not use wildcard origins. Only the main frame of that origin can request settings. Keep external navigation outside the trusted WebView.
5. The bridge opens the battery optimization list, falling back to this app's details page when unavailable. Users select their app and choose the appropriate battery setting. No REQUEST_IGNORE_BATTERY_OPTIMIZATIONS manifest permission is needed.
6. The bridge reports whether Android opened a screen. The web client times out after five seconds and displays manual instructions if no reply arrives.

A plain Android WebView does not supply the browser Web Push functionality used by this website. For that wrapper, implement native FCM registration, authenticated device-token storage, backend delivery, notification permission/channels, and tap routing separately. The battery bridge alone does not enable push in a WebView.

## PWABuilder / Trusted Web Activity

A TWA uses a browser and can use the existing Web Push path. It cannot install this WebView listener. The website therefore shows manual settings instructions. Direct settings access requires a native Activity/control or a separately implemented verified TWA messaging integration in the generated project. Battery restrictions may also affect the browser that delivers Web Push.

## Device verification before release

- Enable push and send the existing test notification; verify it appears on the intended device.
- Android wrapper: tap Open battery settings; verify the system screen opens, select the app, change the setting, return, and send another test.
- Verify unsupported devices/ordinary browsers show guidance without an unusable native button.
- Lock the phone and trigger an order update from a second device. Verify notification content and tap routing. Repeat in Doze and after ordinary app dismissal. A force-stopped app may need reopening.
- iPhone: install to Home Screen and grant notifications; check Focus and notification settings. There is no Android-style unrestricted-battery toggle supplied here.

Battery exemptions do not guarantee continuous execution or delivery. Native compilation and real-device tests remain pending until a wrapper project and device are available.

References:
- https://developer.android.com/training/monitoring-device-state/doze-standby
- https://developer.android.com/reference/androidx/webkit/WebViewCompat
