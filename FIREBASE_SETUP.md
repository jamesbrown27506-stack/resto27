# Firebase web setup

The Firebase SDK is installed and src/lib/firebase/client.ts contains the public web configuration for resto237-da372. FirebaseInit mounts once in the root layout, initializes the Firebase app, and starts Analytics only in supported browsers. Server rendering never imports the Analytics runtime. Repeated mounts share initialization; failures do not interrupt the app.

The Content Security Policy explicitly allows the Google Analytics script, collection endpoints, and Firebase installation/configuration endpoints. No Firebase Admin or service-account credentials are included.

## Cloud Messaging web tests

The notification settings page now has **Firebase Cloud Messaging tests**. Add the **Web Push certificate key pair** from Firebase Console → Project settings → Cloud Messaging as `NEXT_PUBLIC_FIREBASE_VAPID_KEY` in `.env.local` and Vercel, then redeploy. It must be the Firebase key, not `NEXT_PUBLIC_VAPID_PUBLIC_KEY` used by Resto237's existing Web Push service.

Once deployed, open notification settings on the test device and select **Enable Firebase tests**. Copy the resulting FCM registration token into Firebase Console → Messaging → campaign → **Send test message**. Put the app in the background before sending. The FCM worker is `public/firebase-messaging-sw.js`; it has its own narrow `/firebase-messaging/` scope, so it does not overwrite `public/sw.js` or its existing order-delivery subscription.

This adds Firebase Console campaign testing. It does not send order updates through FCM: those still use the existing Resto237 Web Push service. Sending operational notifications through FCM would require storing registration tokens and supplying Firebase Admin credentials to the backend. Native Android messaging still requires registering the actual Android package in Firebase and integrating its native SDK (or OneSignal).

After deployment, open the app in a supported browser and check Analytics Realtime for measurement G-BPRG3GNM82. Analytics collection depends on browser settings, blockers, and your Firebase/Analytics console configuration; local checks do not confirm live ingestion.

References:
- https://firebase.google.com/docs/web/setup
- https://firebase.google.com/docs/reference/js/analytics
- https://developers.google.com/tag-platform/security/guides/csp
