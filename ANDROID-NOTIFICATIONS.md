# Android notifications setup

The browser page now supports live in-app alerts for operation/event changes and due reminders. Its optional browser notifications require permission and a running page. The Android app uses Capacitor Push Notifications and FCM, which can deliver notification messages while the app is backgrounded or closed. Android settings, force-stop, connectivity and power restrictions can delay or suppress delivery.

## Database

Run the existing scheduling/event migrations first, followed by:

1. `migrations/20260912_realtime_schedule.sql`
2. `migrations/20260912_android_push.sql`

A new database can run `supabase-schema.sql`. Existing bookings are preserved. Only active doctors can register their own device tokens. Push jobs are server-only; the server rechecks the doctor's active status before sending.

## Android app

1. Create a Firebase project and register an Android app with package ID `com.entclinic.app` (or change `appId` in `capacitor.config.json` before creating the Android platform).
2. Download the Android app's `google-services.json` from Firebase and place it at `android/app/google-services.json` The Android platform has already been generated in this workspace. This is native Firebase client configuration, not the server service-account key.
3. Install dependencies with `npm install`, build with `npm run build:mobile`, and create the platform once with `npx cap add android` only if the `android` folder is missing. Subsequent changes use `npm run sync:android`.
4. Open the `android` project in Android Studio, configure its SDK/JDK requirements, build and install on a real Android device with Google Play services. Build a signed release for distribution.
5. Sign in as a doctor, open My Schedule, and tap **Enable phone notifications**. Accept the Android permission prompt. Denied permission can be changed in Android Settings > Apps > ENT Clinic > Notifications.

The mobile build bundles Supabase and the native bridge locally, without relying on CDN JavaScript. It copies only the clinic web assets into `www`; server credentials must never be placed in these assets. The source web pages continue working without Capacitor. Normal sign-out unregisters the phone and removes its saved token.

## Server sender (required for closed-app alerts)

1. Enable Firebase Cloud Messaging HTTP v1 in the same Firebase project. Create a service account authorized to send FCM messages. Keep its private key only in server secrets.
2. In Supabase Edge Function secrets, set `FIREBASE_SERVICE_ACCOUNT` to the complete service-account JSON and `SCHEDULE_PUSH_CRON_SECRET` to a long random secret. Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to deployed functions. Do not send private keys in chat or put them in `Javascript/supabase-config.js`.
3. Deploy `supabase/functions/send-schedule-push` using `supabase functions deploy send-schedule-push`. `supabase/config.toml` disables gateway JWT checks only for this function; the handler requires a POST with a matching `x-cron-secret` header.
4. Schedule an authenticated server POST to `https://YOUR_PROJECT.supabase.co/functions/v1/send-schedule-push` every minute with the `x-cron-secret` header. Use Supabase Cron/Vault with the companion SQL template, or another trusted server scheduler. A browser timer cannot replace this step.

The database queues updates immediately, plus a reminder 15 minutes before each operation/event (or the existing booking's configured lead time). The sender runs every minute, so notification delivery is not instantaneous. Edits/cancellations replace pending jobs. Polling and Realtime keep the foreground schedule refreshed. Notification messages include a generic title/body so Android can display them without running page JavaScript. Tapping a push opens My Schedule, where the usual login/role checks apply.

Jobs use a five-minute claim lease and up to eight retries. Sent device tokens are recorded per job; a sender crash between FCM acceptance and saving progress can still retry a delivery, with an Android notification tag to replace the same tray item. Monitor unfinished `schedule_push_jobs` with `attempts >= 8` and periodically clean up finished/expired jobs. A notification already accepted by FCM cannot be recalled by cancelling a booking. Send jobs in small batches; increase worker throughput if the queue grows.

## Verification before rollout

- Apply migrations and verify doctors cannot read another doctor's tokens or push jobs.
- Enable notifications on a real Android phone and confirm its token appears for that doctor's user ID.
- With My Schedule open, create/edit/cancel an operation and verify a live alert and refreshed card. Appointments must not alert here.
- Background/close the Android app, book an operation or event as secretary, run the sender, and verify a notification. Tap it to open the schedule.
- Book an item 16 minutes ahead and verify the due reminder with the app closed. Cancel/reschedule before the reminder and verify the old pending job is removed.
- Test denied permission, offline/reconnect, sign-out, and a disabled doctor. A force-stopped Android app may need reopening before messages resume.

Local checks do not prove device delivery. Firebase configuration, database migrations, deployment, Android build/signing, and real-device notification tests remain environment setup steps.

Official references: https://capacitorjs.com/docs/apis/push-notifications and https://firebase.google.com/docs/cloud-messaging/android/receive-messages

## Build the test APK from this workspace

The project-local Java toolchain is under `.build-tools/java`. Run `./scripts/build-debug-apk.ps1` from PowerShell to rebuild web assets, sync Capacitor, and compile the debug APK. The script copies the result to `artifacts/ENT-Clinic-debug.apk`.

If `android/app/google-services.json` is absent, the build disables native push registration and displays a setup message when phone notifications are requested. Login and clinic screens remain available. Add the Firebase file and rebuild to enable native push. This guard is separate from the server setup needed for background delivery.
