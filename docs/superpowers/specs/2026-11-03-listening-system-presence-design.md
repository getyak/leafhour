# Listening system presence

The user approved the system-surface exploration and requested implementation: explicitly started listening continues in background, appears by default in Dynamic Island and Lock Screen system surfaces, and supports pause/resume and ending listening. Motion must correspond to actual output. This task does not implement focus timers or reminders.

## Behavior and platform choices

Keep the existing MediaPlayer integration for supported iOS 17+ devices, including iOS 27. The available compiler is Xcode 26.4, so do not ship an uncompiled speculative NowPlaying-framework migration. Register toggle-play/pause and stop as well as existing commands. Preparing audio is distinct from actual output and an explicit pause.

System media presentation provides native playback motion. A compact ActivityKit presentation adds explicit pause/resume and end controls that the system-owned media layout cannot guarantee. It uses bibliographic metadata only, never text, private notes, account IDs, source locations, fabricated durations, audio levels or progress. The system determines coexistence and Dynamic Island placement. Disabled/unavailable Live Activities must never block audio or system media controls. No ordinary notification permission or push service is needed.

The Activity's buttons execute AudioPlaybackIntent in the app process and target a random playback-session identifier. Reject stale identifiers after stop, book/account/source change or replacement. Do not recreate a user-dismissed activity during the same listening session. Cancel/stop clears both surfaces; pause preserves the cursor and resume controls. Backgrounding does not pause authorized playback or add reading time. Termination recovery may clean orphan activities but must never silently restart playback.

Activity updates follow changes to phase, chapter or chosen speed, not words or a periodic animation timer. Small symbol transitions may accompany state changes; Always-On/reduced-motion presentations stay still. Dynamic Island/Lock Screen layout and final iOS 27 behavior require device acceptance separately.

To satisfy the requested visible background motion, compact/expanded and Lock Screen presentations also show a native system-owned elapsed-listening timer. It advances only during actual PCM output, freezes during preparation/pause, resets with the playback owner and never writes reading statistics. Monotonic uptime measures output intervals; significant wall-clock changes reproject the date anchor used by WidgetKit. The app declares the elapsed-time/timer privacy reason `35F9.1` and never exports raw uptime.

## Verification

Use isolated synthetic books and injectable media/activity/command sinks. Test toggle while preparing/playing/paused, stop cleanup, rejected delayed actions, session replacement, disabled activities, deduplication and late asynchronous activity creation. Build the app and embedded widget. Run affected speech, now-playing and UI checks, then reviewed PR/CI/merge under repository policy. Record simulator, physical device, TestFlight and production statuses separately.

## Official references

- https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities
- https://developer.apple.com/documentation/widgetkit/adding-interactivity-to-widgets-and-live-activities
- https://developer.apple.com/documentation/appintents/audioplaybackintent
- https://developer.apple.com/videos/play/wwdc2026/312/
