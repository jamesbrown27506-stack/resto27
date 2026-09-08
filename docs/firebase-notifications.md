# Notification providers

Administrator control: **Platform settings → Notification delivery** (`/a/settings`).
Web Push remains the default. The selector controls the shared `sendPushWithReport`
dispatcher, including new-order reachability reports. It does not enable disabled
notification preferences or send through both providers simultaneously.

All existing `notify()` events use that dispatcher: orders and order status,
payments/refunds, reservations and reminders, customer/staff messages, reviews,
restaurant applications/approval/moderation, account events, subscription billing,
support and administrator broadcasts. Cron and payment-webhook notifications use
the same path. In-app and email delivery remain independent.

## Firebase setup

1. Apply `supabase/migrations/0045_firebase_notification_provider.sql` using the
   Supabase SQL editor or an authorized database connection. The migration is
   additive and keeps Web Push selected. Token storage has RLS enabled with no
   public policies; authenticated server actions manage each user's registrations.
2. For Firebase project `resto237-da372`, provision a service account authorized
   to send FCM messages. Set `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` and
   `FIREBASE_PRIVATE_KEY` in the Vercel server environment, then redeploy. The key
   accepts real newlines or escaped `\n`. Never use a `NEXT_PUBLIC_` prefix for
   the private key or commit service-account JSON. Browser Firebase configuration
   and the public VAPID key are not server credentials.
3. Open the HTTPS application while signed in and enable push notifications.
   Existing permitted devices automatically register on app open/navigation/focus.
   Notification settings also have a **Register this device** Firebase control.
4. In the admin panel, use **Test Web Push** and **Test Firebase**. Each sends only
   to your administrator account and leaves the selected provider unchanged.
   An accepted send confirms provider acceptance, not actual display on a handset.
5. Check receipt on your device, then save the selected provider. Firebase is
   unavailable until credentials, storage and a registered device exist. All
   intended recipients need Firebase registration before switching; there is no
   silent fallback to Web Push during comparison.

## Behavior

- Both browser subscriptions are retained for switching back and forth.
- Operational FCM messages use data payloads and one custom background display.
  Firebase Console notification payloads use the SDK display, avoiding duplicates.
- Foreground FCM messages enter the existing toast/sound deduplication handler.
- Deep links and action buttons are restricted to this application's origin.
- Device opt-out removes both subscriptions; account preferences still apply.
- FCM tokens are refreshed on subsequent app use, capped at ten per account,
  transferred on account changes and detached on the normal logout paths.
- Only explicit FCM `UNREGISTERED` responses delete a rejected token. Other
  failures appear in delivery reports. Requests have a ten-second timeout.

This integration registers web/PWA devices. A future native wrapper must register
through its native Firebase SDK; wrapping a website alone does not grant native
background execution or bypass the device's notification/battery settings.

Reference: https://firebase.google.com/docs/cloud-messaging/web/receive-messages
