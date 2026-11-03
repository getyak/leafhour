# Reader-first opening and direct listening actions

Date: 2026-11-03. Native iOS implementation against main `abcfae7b5e723d74cce8b9eafff66018d98ac2ea`.

## Result

Cached reading presents the authorized local source before cloud records return. Source, index and visible-page resources are verified first; the complete retained package is checked afterward. An unchanged decoded index is reused only with matching device/inode/size/mtime/ctime stamps. Changed critical bytes are hashed again. The partial opening receipt never claims complete offline verification.

Listening uses the full source area when its current paragraph has no matching comparison. A real comparison has an on/off switch, preserving the saved choice. A quiet location icon appears after manual browsing or selection; it returns to the actual spoken sentence without seeking, restarting, pausing or changing speed. Explicit location clears selection; ordinary speech callbacks keep native selection intact.

Both controllers use previous/next chapter actions. Reading page gestures and current-page translation remain. Listening chooses the neighbor of the displayed chapter, skips chapters without playable text and preserves idle/paused/playing intent. Selection offers a visible **AI 引用** tap action and the native text menu uses the same label. Optional drag/drop still validates the captured quote and opening Chat does not submit a question.

## Safety of deferred work

- A scoped reading token and atomic state checks prevent older cloud pulls from replacing a live reader's newer position, notes or drafts.
- Remote positions discovered after entry use the existing explicit position choice. Ordinary pushes, shelf pulls and metadata writes that began before the choice cannot silently clear it.
- Translation refresh/publication and explicit translation preparation wait for the package check, avoiding self-induced invalidation during legitimate package replacement. Direct auxiliary cached content is not displayed before verification.
- A failed check freezes the exact session and queued writes, revokes resource access and preserves a source/index/profile-bound recovery snapshot. The recovery panel allows export; returning requires a retained recovery or successful export. Book details can export retained snapshots after restart or repair. Canonical records are not silently overwritten by recovery data.

## Measurements

Mac Debug, a generated 9,236,888-byte TXT with 32,000 ordinary paragraphs, same full Core run:

| Measured operation | Time |
| --- | ---: |
| Previous full `book()` verification | 107.9 ms |
| Previous duplicate `originalURL()` verification | 106.2 ms |
| New source/index/visible-resource critical pass, cold | 13.61 ms |
| Same critical pass with unchanged decoded cache | 0.552 ms |

These measure local opening work, not complete device first-frame latency. Native text already renders a bounded window; this change does not introduce a new chapter-on-disk format. A previously running actor operation or later full content read may still queue other library work. Large image books and physical-device timings remain unmeasured.

The native held-network test failed before the change (`readerBeforeRelease=false`, approximately 677 ms); after the change it presents the local reader while `/records` is held, then preserves a new anchor and note when the response is released.

## Verification

Only synthetic fixture data and isolated temporary libraries were used. No real account books, private notes or paid generation were accessed.

- Core: 341 tests, 2 fixture-only skips, 0 failures. Includes changed-in-place content with restored mtime, stale receipts/indexes, account boundaries, critical versus deferred resources, recovery after restart/repair, queued-write cancellation, in-flight pull ownership and unresolved-position metadata races.
- Native host suite: 336 tests, 2 fixture-only skips, 0 failures; final selected UI suite: 8 tests, 0 failures. Built with Xcode/iOS 26.4 Simulator on the dedicated synthetic-test identity. The held-network native test published its reader in approximately 9.5 ms in this run.
- The 8 UI scenarios cover missing/real comparison, toggle/hide without stopping audio, locate without pause, idle chapter controls, reading chapter/page-translation controls, direct AI quote, optional drag and rapid page taps without accidental selection.
- Native release-helper contracts: 100 Node tests and 9 Python tests passed. The Xcode test run built the application and host/UI test targets successfully.
- Expected failures were observed before implementing no-comparison layout, held-network entry, paused chapter navigation, explicit native selection dismissal, absolute chapter targeting and sync race fixes.
- Independent review identified and rechecked position-choice persistence, accessible recovery export and package-publication ordering; no substantive open finding remained.
- `git diff --check` passed. No changes to Web or its data/API contracts; unrelated Web/catalog tests are not counted as executed.

Local evidence is retained under ignored `output/verification/2026-11-03-lazy-reader/` and `/tmp/leafhour-lazy-reader/` (final Xcode bundle: `Test-Leafhour-2026.11.03_19-51-04-+0800.xcresult`). UI attachments show actual native no-translation layout, source highlighting, direct AI selection and controllers; synthetic text is explicitly labelled. Screenshots are not shipped as public book data.

## Delivery boundary

PR/main CI, Production and the matching Apple receipt are checked after this local record. The final delivery message identifies the PR and verified build. App Store processing acceptance does not prove tester installation. Physical iPhone gestures, audio hardware, lock-screen cover visibility and long-duration background playback require device acceptance; this follow-up does not claim those checks.
