# Reminders, calendar, alarms, notes and health: what is built, and how far it was checked

Written 15 October 2026. Platform rules change; anything here that depends on Apple's, Google's or a plugin's current behaviour should be
re-checked before a release. Where something could **not** be checked in this environment, it says so.

## Three words used throughout

| Word | Meaning here |
|---|---|
| **Source-implemented** | The code is written and is covered by unit tests that use a fake of the platform. |
| **Build-verified** | The native project compiles. **Nothing native has been built**: this environment has no Xcode and no Android SDK (see "What could not be done here"). The web build (`npm run build`) is verified. |
| **Device-tested** | It was run on a real phone. **Nothing has been.** |

## The four different things

People say "reminder" for four different things, and the app keeps them apart on screen:

| Thing | What it is | In CleanFlow |
|---|---|---|
| **Notification** | A message from an app, scheduled with the operating system or shown by the page while it is open. | Yes. Derived from the plan, one per planned occurrence, cancelled when the occurrence is done, moved, archived, deleted or the section is switched off. |
| **Calendar event** | An entry in the person's calendar app. Once added it belongs to the calendar. | Yes, as a downloaded `.ics` file with the calendar's own alert. CleanFlow cannot change or remove events afterwards, and says so. |
| **Apple Reminder** | An item in Apple's Reminders app. | **Not implemented.** |
| **Alarm** | A clock alarm that rings through silent mode and Focus. | **Not implemented.** A notification is not an alarm, and the app says so. |

## What was checked in the platform documentation (and what could not be)

Fetched and read in full from the vendors' own pages on 15 Oct 2026:

- **Apple, local notifications** (`developer.apple.com/documentation/usernotifications/scheduling-a-notification-locally-from-your-app`): a local notification is created with a trigger (calendar, time interval, location) and added to `UNUserNotificationCenter`; "Typically, you cancel a request when conditions change… if the user completes a reminder, you'd cancel any active requests associated with that reminder", using `removePendingNotificationRequests(withIdentifiers:)`. The page, and the class page, state **no limit** on pending requests. (I recall a limit of 64 pending local notifications; **I could not confirm that from Apple's pages**, so the app looks only 7 days ahead and hands the device at most the 60 nearest reminders. Check this before shipping.)
- **Apple, AlarmKit** (`…/alarmkit/scheduling-an-alarm-with-alarmkit`): iOS 26.0+. "It overrides both a device's focus and silent mode, if necessary." Needs `NSAlarmKitUsageDescription` in Info.plist or "apps can't schedule alarms"; authorization via `AlarmManager.requestAuthorization()` (or asked automatically when the first alarm is added); one-time and weekly schedules, and timers; "AlarmKit expects a widget extension if an app supports a countdown presentation. Otherwise, the system may unexpectedly dismiss alarms and fail to alert."
- **Apple, EventKit** (`…/eventkit/accessing-the-event-store`): "Your app can't request read-only access to either events or reminders. To read events or reminders from the event store, your app needs full access." Reminders: `requestFullAccessToReminders` with `NSRemindersFullAccessUsageDescription`. Events: write-only or full. On iOS 17+, "if your app doesn't include usage description keys… iOS automatically denies any access request."
- **Apple, HealthKit privacy** (`…/healthkit/protecting-user-privacy`): the user grants read and write permission "separately for each type of data". "An app isn't aware when the user denies permission to read data. From the app's point of view, no data of that type exists." Needs `NSHealthShareUsageDescription` (read), and `NSHealthUpdateUsageDescription` (write). The store is encrypted while the device is locked, so "your app may not be able to read data from the store when it runs in the background". Health data may not be used for advertising, may not be disclosed to a third party without permission, and a privacy policy is required.
- **Android, alarms** (`developer.android.com/develop/background-work/services/alarms`): "It's highly recommended that you create an inexact alarm whenever possible." Exact alarms are for apps whose "core functionality depends on a precisely-timed alarm—such as for an alarm clock app or a calendar app". `SCHEDULE_EXACT_ALARM` is user-granted and revocable, and is "not pre-granted to fresh installs" targeting Android 13+. `USE_EXACT_ALARM` is automatic, limited to specific use cases and subject to a Google Play policy (the page does not list which). "By default, all alarms are canceled when a device shuts down." "Alarms don't fire when the device is in Doze mode."
- **Android, Health Connect** (`developer.android.com/health-and-fitness/guides/health-connect…`): framework module on Android 14+, a separate Play Store app on Android 13 and lower. Permissions are per data type and read or write, and "your app needs to check for permissions every time before using them". Background reads need an extra permission (`READ_HEALTH_DATA_IN_BACKGROUND`). By default an app can read only the 30 days before its first permission grant. For cumulative data like steps, "use `aggregate()` instead of `readRecords()` to avoid double counting from multiple sources". The aggregate API removes duplicates **only for Activity and Sleep data, and only by the user's own app priority**; "for other types of data, the aggregated results combine all data of the type… from all apps which wrote the data." A privacy-policy screen is required, and the declared permissions "should match the data types you declared in the Play Console."
- **Capacitor Local Notifications** README (`github.com/ionic-team/capacitor-plugins`, documenting 8.2.1; the plugin now lives in its own repository at 8.3.1): Android 13+ needs the notification permission to be requested; Android 12+ needs `SCHEDULE_EXACT_ALARM` for exact timing; "if a user disables this setting, the app will restart and any notification scheduled with an exact alarm will be deleted"; a notification on a channel that does not exist "won't fire"; `allowWhileIdle` notifications "can only fire once per 9 minutes, per app".
- **`@capgo/capacitor-health` 8.11.11** README and type definitions (a **community** plugin, not Apple's or Google's): `queryAggregated` with `bucket: 'day'` and `aggregation: 'sum'`; `queryWorkouts` (duration in seconds, with `sourceName`); `dietaryWater` in litres; `exerciseTime` is "Apple Exercise Time (iOS only)"; reading workouts needs `workouts` requested explicitly; read and write permissions are separate.
- **npm registry**: `@capacitor/core` 8.5.3, `@capacitor/local-notifications` 8.3.1, `@capacitor/share` 8.0.3 and `@capgo/capacitor-health` 8.11.11 exist and match Capacitor 8.

**Not verified, so not relied on:** the MDN pages for the Notifications API and Push API and the Notification Triggers API (the host could not be reached). The statement that **a web page cannot schedule a notification for later without a push server** is therefore from memory; the app is built on it (a browser tab reminds only while open), and it is shown to the person in those words. Apple/WebKit's page on Web Push could not be fetched either; a web search summarised it as: Web Push on iPhone works for web apps added to the Home Screen from iOS and iPadOS 16.4, and the permission request must come from a tap. CleanFlow has no push server, so none of that is used. The Android `AlarmClock` intents and the Capacitor documentation site were also unreachable.

## Why a Capacitor shell (the evaluation)

| Option | Reminders when the app is closed | Health data | Cost to this codebase | Verdict |
|---|---|---|---|---|
| Stay a web app (PWA) | No: a page can show a notification only while open, and a push server would be needed to do more (none exists, and the key and data rules here argue against adding one just for this) | No | None | Fine for everything else; used as the fallback, with honest wording |
| **Capacitor** (the same built web app inside a native shell) | Yes, via the operating system's local notifications (`@capacitor/local-notifications`, an official plugin) | Yes, via a community plugin over HealthKit and Health Connect | Small: the plugins are loaded only in the phone app, behind a platform interface (`ReminderPlatform`, `HealthAdapter`) that the web app also satisfies | **Chosen**, and wired through those interfaces |
| Rewrite natively (Swift, Kotlin) | Yes | Yes | A second codebase for every feature | Not justified |

Capacitor is chosen because it keeps one codebase and one set of rules, and everything native sits behind two small interfaces, so the web app is unchanged when no phone app exists. What it does **not** give is Apple Reminders or alarms, which need custom native code (see the table below). Two things to know: the plugins add manifest permissions the app does not want (see "What the plugins add"), and the community health plugin is not maintained by Apple or Google, so its behaviour on each OS version needs the device checks listed at the end.

## What exists

| Capability | Implemented | Build-verified | Device-tested | Notes |
|---|---|---|---|---|
| Reminder planning from the plan (occurrence-linked, quiet hours, snooze, per-activity lead or off, time zones) | Yes (`src/domain/reminders/`) | Web build and unit tests | n/a (pure code) | One reminder per occurrence, derived each time, so completing, moving, archiving or deleting an activity cancels it. Quiet hours skip rather than delay. Snooze moves one occurrence only. |
| In a browser: in-app reminder with Snooze, browser notification if allowed (the in-app check runs once a minute, so it can be up to a minute late) | Yes | Web build | **Browser-tested in Chromium** (the in-app reminder, status wording, snooze, settings). A real OS notification banner was **not** observed (headless browser). | Honest limit shown in the UI: only while CleanFlow is open. |
| Calendar file (.ics) | Yes | Web build | Format unit-tested; **not opened in a real calendar app** | Floating local times, stable UIDs, CRLF, folded lines, escaped text, `VALARM`. |
| Native local notifications (Capacitor) | Yes, as an adapter (`createNativePlatform`) with a snooze action and a channel | **No** | **No** | Unit-tested against a fake of the plugin's API. Inexact scheduling on purpose (no exact-alarm permission requested: not an alarm app). Reminders on Android may arrive a few minutes late, and a phone that has been travelling across time zones without opening the app keeps the old absolute times until the app is opened. |
| Apple Reminders | **No** | – | – | Would need a custom Swift Capacitor plugin using EventKit with `requestFullAccessToReminders` (full access, no read-only option). Cannot be compiled here. |
| Alarms (iOS AlarmKit, Android alarm clock) | **No** | – | – | AlarmKit is iOS 26+, needs a usage string and a widget extension for countdowns. Not built: a notification is not an alarm, and the app says so instead. |
| Notes | **No direct write** | – | – | I found no documented way for a third-party app to write into Apple Notes. The route is the system share sheet from the existing "Share" on lists and recipes (`@capacitor/share` exists). The app does not claim a Notes connection. |
| Health (HealthKit / Health Connect), read-only | Yes, as an adapter (`createCapgoAdapter`) plus status, read, merge, and display | **No** | **No** | Unit-tested against a fake of the plugin's API. Daily totals come from the platform's own aggregate query. Read-only: nothing is written to Health. Foreground reads only (the background-read permission is not requested). Reads 14 days (inside Health Connect's default 30). |

## How the health data is kept honest

- Optional and off. In a browser the screen says it is not available there and offers no switch.
- "Connected" needs a device with the health service, at least one allowed kind of data, and a read that did not fail. The switch alone says "Waiting for your permission".
- On iPhone, "denied" and "nothing there" look the same to an app (Apple says so), and the screen says so.
- It is stored apart from the person's own records, labelled with its source, and never completes a planned activity, never uses up the day's minutes, never edits the water log, and has nowhere to go in any AI request (tests check the request shapes).
- Provenance and double counting: the adapter asks the platform for **daily totals**, and stores a re-read day by replacing it. A workout reported twice is stored once, by the platform's id. Because the app never writes to Health, there is no echo of its own water entries coming back. For water, Health Connect adds up every app that wrote it, so the figure beside the person's own log is shown separately and never added to it.
- The person can remove everything read with one tap. CleanFlow cannot revoke the permission itself: only the phone's own Health settings can, and the screen says that.

## What the plugins add to an app's manifest (read from the npm packages, not from a built app)

- **`@capacitor/local-notifications` 8.3.1** declares `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED` (it restores scheduled notifications after a reboot, which the Android alarm guide says is otherwise lost), `WAKE_LOCK` and **`SCHEDULE_EXACT_ALARM`**. CleanFlow schedules inexactly and does not need precise alarms, and Google asks apps to declare exact-alarm permission "only if a user-facing function in your app requires precisely-timed actions". **Before a Play release, strip `SCHEDULE_EXACT_ALARM`** from the app's own manifest with `tools:node="remove"`; without it the plugin falls back to inexact scheduling.
- **`@capgo/capacitor-health` 8.11.x** declares **24 read and 23 write** Health Connect permissions, including blood glucose, blood pressure, nutrition, sleep, heart rate and body measurements. CleanFlow reads only steps, workouts (`READ_EXERCISE`) and hydration (`READ_HYDRATION`), and never writes. Because "the permissions should match the data types you declared in the Play Console", **a release must remove every permission it does not use** (`tools:node="remove"`), and the Play Console declaration must list only those three kinds of data. Requesting at runtime only what is needed (which the app does) is not the same as declaring only what is needed.
- On iOS the plugin's README asks for the HealthKit capability and the two usage strings; request only what is read (`NSHealthShareUsageDescription`), and leave `NSHealthUpdateUsageDescription` out while nothing is written.

## What could not be done here

- **No iOS build**: this is a Linux container with no Xcode or macOS.
- **No Android build**: Java 21 and Gradle 8.14 are present. `npx cap add android` (run in a scratch copy, not committed) did generate an Android project and detected both plugins, but `./gradlew tasks` then failed with `Could not resolve com.google.gms:google-services:4.4.4 … dl.google.com … Received status code 403 from server: Forbidden`. The Android SDK and Google's Gradle plugins come from `dl.google.com`, which this environment's proxy does not allow. No `android/` or `ios/` folder is committed: they are generated by `npx cap add` and cannot be checked here.
- **The AI in the phone app.** The AI endpoints are relative paths (`/api/coach`, `/api/assist`) on the server that serves the web app, so a phone app has no AI server to call until a server address is built in. Until then the app shows the AI as unavailable and the app's own suggestions work, as they do on the web without a key.
- **No real device**, simulator or emulator, so no permission prompt, notification, alarm or Health read was seen.

## What is still needed before a store release (not done, not claimed)

1. A Mac with Xcode 26 or later, an Apple Developer account, the **HealthKit** capability, and the Info.plist strings (`NSHealthShareUsageDescription`; add `NSHealthUpdateUsageDescription` only if writing is ever added).
2. For Android: the Android SDK, a signing key, and the **Play Console** Health Connect declaration with a privacy policy that matches the permissions in the manifest, plus a privacy-policy screen reachable from the Health Connect permission dialog.
3. A privacy policy that says what is stored on the device, what the optional AI receives, and that health data is never sent anywhere.
4. A test pass on real phones: permission prompts (allow, deny, allow later), notifications while closed and after reboot, Doze, time-zone change, quiet hours, snooze from the notification, and a Health read with a watch and a phone both writing steps.
5. A decision about Apple Reminders and alarms (custom native plugins) if they are wanted.
