# Resto237 mobile release guide

Resto237 uses Capacitor 8 with application ID/bundle ID `online.resto237.app`.
Treat that identifier as permanent once either store accepts the first build.

The native application loads the production Next.js deployment at
`https://resto237.online`. Next.js Server Components, Server Actions, webhooks,
cron routes, Supabase service-role operations, and email continue to run on the
server. Capacitor supplies the native runtime and device APIs.

### Architecture and review limitations

This is an **online, hosted-content native integration**, not a bundled/offline
Next.js export. Capacitor documents `server.url` as a live-reload/development
facility, not its recommended production architecture. It is used here to
preserve the existing Server Actions and server-rendered application without a
separate mobile-client rewrite. A conventional bundled release requires a
separate static mobile frontend and authenticated API layer. Do not describe
this build as an offline app or assume store acceptance: assess this hosted
architecture against current store review requirements before submission.

Only the configured HTTPS origin receives the native bridge. Treat production
web deployments as native application code: an XSS on that origin could access
enabled plugins. Do not allow untrusted origins in `allowNavigation`.
Changing the host also requires updating deep-link rules, association files,
the fallback page and signing configuration.

## Implemented native capabilities

- Android and iOS projects tracked in source control
- Firebase Cloud Messaging tokens on both platforms
- Native foreground/background notification handling and notification taps
- A high-priority Android channel for orders and reservations
- HTTPS App Links, Universal Links, and the `resto237://` fallback URL scheme
- Android back-button handling and app resume events
- Native network state, status bar, splash screen, keyboard, and lifecycle
- Camera/photo library in existing image pickers; restaurant sharing
- Optional location capture in checkout and saved-address landmark fields;
  adds a map link without replacing the required street address
- Typed filesystem, preferences, device, haptics, local-notification, and
  external-browser APIs ready for feature use (not all have dedicated UI).
  Preferences are ordinary app storage, **not an encrypted credential vault**.
- Android battery-settings access through a first-party Capacitor plugin
- Store-resolution icons, adaptive Android icons, and splash screens

## Required before any native push test

These values belong to the store/Firebase accounts and are intentionally not
committed.

1. In Firebase project `resto237-da372`, add an Android app with package name
   `online.resto237.app` and download `google-services.json` to
   `android/app/google-services.json`.
2. Add an iOS app with bundle ID `online.resto237.app` and download
   `GoogleService-Info.plist` to `ios/App/App/GoogleService-Info.plist`.
3. In Apple Developer, create an APNs authentication key and upload it in
   Firebase Console under Cloud Messaging for the iOS app.
4. Apply `supabase/migrations/0048_capacitor_devices.sql` before deploying the
   web code. It distinguishes web, Android, and iOS registrations.
5. Confirm the existing server-side `FIREBASE_PROJECT_ID`,
   `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY` variables are present in
   the production Vercel environment.

Run `npm run mobile:check` to check these files without printing their contents.
The build commands run this check automatically. The iOS Firebase SDK initializes
at app startup and can terminate the app if its configuration is absent, so do
not distribute or test a native binary without its matching Firebase file.

## Verified links

After Google Play creates the app-signing certificate, copy its SHA-256
fingerprint into the Vercel variable
`ANDROID_APP_LINK_SHA256_CERT_FINGERPRINTS`. Include the upload certificate too
when locally signed builds should open verified links; separate fingerprints
with commas.

Set `APPLE_TEAM_ID` in Vercel to the ten-character Apple Developer Team ID.
Redeploy, then verify:

- `https://resto237.online/.well-known/assetlinks.json`
- `https://resto237.online/.well-known/apple-app-site-association`

Both endpoints deliberately return empty association lists until their signing
values are configured.

## Android / Google Play

Before any upload: a Google Play developer account (25 USD, one time, with
identity verification). A new *personal* account must run a closed test with
at least 12 testers for 14 consecutive days before it can publish to
production; an *organization* account (requires a D-U-N-S number) is exempt.
Play accepts only an Android App Bundle: build it with
`android\gradlew.bat -p android bundleRelease` (signed by the same release
key) and upload `android/app/build/outputs/bundle/release/app-release.aab`.
Reviewers need a test account, because the app requires sign-in.

1. Install Android Studio, its current Android SDK (the generated project
   targets API 36), and the JDK required by that Android Studio/Gradle version.
2. Add `android/app/google-services.json`.
3. Run `npm install` and `npm run mobile:sync`.
4. Run `npm run mobile:android` and test a debug build on a physical Android
   13+ device, including denied and granted notification permissions.
5. In Android Studio, create an upload key and keep it outside the repository.
   Enrol in Play App Signing and keep both the upload key and recovery material
   backed up securely.
6. Increment `versionCode` for every upload and update `versionName` in
   `android/app/build.gradle` for public releases.
7. Build a signed Android App Bundle (`.aab`), upload it to Internal testing,
   and complete the Play Console Data safety, content rating, ads, target
   audience, privacy policy, account deletion, and app access sections.
8. Test the Play-installed build. Its signing fingerprint differs from a local
   debug build and is the one required for production App Links.

## Website APK download (before the stores)

Every public page ends with a "Download our app" band, and the footer has
Android/iPhone links. Android visitors download the signed APK from
`/downloads/resto237.apk`; iPhone visitors get Home Screen install
instructions, because iOS cannot install apps from outside the App Store or
TestFlight. Both are hidden inside the native app.

The release key and its passwords live in `android/keystores/resto237-release.jks`
and `android/keystore.properties`. Both are gitignored. **Back both up outside
this computer.** Android only updates an installed app with an APK signed by
the same key, so losing them strands every existing install. When you later
enrol in Play App Signing, choose to upload this existing key as the app
signing key, so that Play updates can replace sideloaded installs.

To publish a new version:

1. Increase `versionCode` (always) and `versionName` in
   `android/app/build.gradle`.
2. Run `npm run mobile:apk`. It syncs Capacitor, builds the signed release
   APK with Android Studio's JDK, copies it to `public/downloads/resto237.apk`,
   and writes the version and size to `src/lib/app-release.json`.
3. Commit both files and deploy. The site's band shows the new version.

Without `android/app/google-services.json` the APK works but cannot register
for push notifications (the plugin rejects the token request; nothing
crashes). Add the file and publish again to enable push.

## iOS / App Store

iOS signing and App Store archives require macOS and Xcode; Windows can keep
the project synchronized but cannot produce a signed iOS archive.

1. On a Mac, install Xcode and open `ios/App/App.xcodeproj` through
   `npm run mobile:ios`.
2. Add `GoogleService-Info.plist` to the App target, preserving its filename.
3. Select the Apple Developer team and ensure the Push Notifications and
   Associated Domains capabilities are enabled for `online.resto237.app`.
4. Confirm `applinks:resto237.online` is present under Associated Domains.
5. Increment `CURRENT_PROJECT_VERSION` for every upload and set the public
   `MARKETING_VERSION` in the App target.
6. Run on a physical iPhone; the simulator is not sufficient proof of remote
   notification delivery.
7. Archive a Release build, validate it, upload it to App Store Connect, and
   test through TestFlight before submitting for review.
8. Complete App Privacy, age rating, review access, screenshots, support URL,
   privacy policy, and account-deletion information.
9. Review the included `PrivacyInfo.xcprivacy` (Preferences and Filesystem
   required-reason APIs) alongside all third-party SDK privacy manifests. It
   does not replace the App Store privacy disclosure. Debug uses development
   APNs; Release uses production APNs via `APS_ENVIRONMENT`.

## Release test matrix

- Customer, manager, and administrator sign-in/session persistence
- Checkout and CamerPay hand-off/return behavior
- Upload from camera and photo library
- Delivery-location permission denied, approximate, and precise
- New-order push with the app foregrounded, backgrounded, dismissed, and the
  phone locked
- Notification tap opens the exact order, reservation, or chat route
- Token rotation after reinstall and sign-in under a different account
- Android Doze/battery restrictions and the battery-settings button
- Deep links from email/messages with the app cold and already running
- Offline launch, reconnect, and interrupted mutation behavior
- Android hardware back button, iOS swipe-back, keyboard, dark mode, and safe
  areas on notched devices
- Android process termination while the camera is open: pending photo changes
  are not saved automatically; reopen the picker if the draft was lost

## Local verification and remaining gates

Automated checks: production Next.js build, TypeScript, changed-file ESLint,
unit tests (including native consent/link/payload cases), and Android/iOS
Capacitor sync. A successful web build does not prove native compilation or
notification delivery. The build's settings read logged `JWT issued at future`
and used defaults; check the local Supabase credentials/clock before relying on
data-backed local smoke tests.

No store listing, signing keys, Firebase native configuration, or production
database changes are created by this implementation. Deploy the migration and
web changes before testing the mobile binary; it loads the deployed site, not
your uncommitted local source.

A signed release APK (1.0, versionCode 1) builds on this Windows host with
Android Studio's bundled JDK through `npm run mobile:apk`. It has not yet been
run on a device or emulator. iOS compilation/archiving must be verified on
macOS/Xcode. No AAB/IPA or physical-device push test has been produced here.

The npm audit also reports existing application dependency advisories (including
Next.js) and an upstream Capacitor CLI dependency advisory. Resolve and regression
test those before public release; this integration does not automatically apply
unrelated framework upgrades.

## Icons and launch screens

Every app icon (Android launcher, round and themed icons, iOS, the web app's
Home Screen icons) and every launch screen is generated from the brand logo
in `resources/logo.png`: icons use the symbol above the name, launch screens
the whole logo. After changing the logo, run
`node scripts/generate-app-icon.mjs`, then publish a new build.

## Routine development workflow

After changing JavaScript dependencies, Capacitor plugins, configuration, or
native assets:

```bash
npm install
npm run mobile:sync
npm run mobile:doctor
```

Normal server-rendered UI changes deploy through Vercel and do not require a
new binary unless they depend on a new/changed native plugin. Native code,
permissions, icons, plugin versions, bundle metadata, or store policy changes
always require a new store release.
