# iOS library and conversational chat verification

Date: 2026-11-02. Status: local implementation and verification in progress; release and production acceptance are not established by this record.

## Implemented behavior

The native shelf exposes per-book actions and multiple selection. Removing a book moves it into Removed, and restoring keeps its identity and personal records. Local removal changes profile-scoped metadata without deleting packages, originals, notes, drafts or reading time. Account removal/recovery reuses the durable shelf-action queue and authoritative receipts. Conflicts remain visible for explicit recovery. Recent actual reading is the unset default sort, unread books use addition dates, and saved sort choices and pins remain in effect.

Identical-source imports offer Keep original, Replace book and Add as new book. Keep and Replace retain personal identity/state; Add as new starts independent records. Durable operation IDs make explicit-copy retries reuse the same identity. Local replacement uses staged verification and the repair journal; cloud upload records the selected operation for recovery. Titles alone do not trigger deduplication. Device and account libraries remain isolated.

Ordinary chat submits when Send is tapped, while translation retains its explicit source/scope/cost confirmation. Request IDs, billing identities and uncertain retries remain stable. Conversation history uses the configured model capacity with compaction as needed, retaining original history in active and archival storage. Product frequency, fixed turn/token/tool-call and ordinary 2,000-character limits are removed. Authenticated owner/source access, narrow-versus-wide book scope, private-note exclusion, transport boundaries, cancellation and hosting deadlines remain enforced.

The native composer has microphone, growing input and Send in reading order, with interactive keyboard dismissal and a named accessibility dismissal action. Markdown replies render as selectable native headings, paragraphs, lists, quotations, code and tables. Recording fills the draft live; Send retains the playable original and transcript through verified owner-scoped storage. Cancelling recording restores the pre-recording draft and does not upload cancelled audio. Voice-aware export/restore retains recordings and validates their receipts.

The reader implementation hides the system status bar/time on its reading surface. Library and chat keep ordinary system behavior. Simulator screenshots and a clock-pixel disappearance/restoration assertion verify this behavior below.

## Local evidence

| Layer | Observed result | Scope and limitation |
| --- | --- | --- |
| Core tests | Coordinator reports 288 executed, 1 skipped, 0 failures | Synthetic/local Core suite, including duplicate identities, archival retention/recovery, profile isolation and voice storage. A skipped case is not accepted. |
| Application tests | Final native run: 266 executed, 2 skipped, 0 failures | Native application unit tests, including direct-send payloads, exact retries, long messages, Markdown, shelf ordering and migration fixtures. |
| Host tests | `npm test`: 4,571 tests; 4,557 passed, 14 skipped, 0 failures | Shared domain/runtime/HTTP and existing host regressions; deterministic adapters do not prove real model quality. |
| Focused simulator UI | All 4 scenarios passed across final affected runs | Duplicate choices and single/multiple local removal/recovery passed in the combined run. The corrected clock-pixel test then passed, and direct chat/Markdown/keyboard passed again after removing the redundant keyboard toolbar. |
| Independent review | Both scoped reviews approved after fixes | Upload transaction/damaged-package recovery, trusted archival scope, playback/recording exclusivity and compaction progress were corrected. Reviewer independently reran 45 runtime/capacity tests; coordinator affected chat suites passed 152/152. |
| Delivery | Pending | No PR/CI, merge, web-production, Apple-processing, TestFlight-installation or physical-device outcome is established here. |

The initial simulator run failed all four cases. It exposed a real startup regression: an absent last-opened ID compared equal to a cloud-only item's absent local ID, which opened the wrong book during startup. The corrected model requires a real last-opened ID. The UI tests now wait for six seeded books, a hittable shelf control and no covering reader before acting. The later combined run passed chat, duplicate-import and shelf recovery. Its initial status-bar query could not find the library clock even though the screenshot visibly contained it: iOS 26 draws this element outside the app accessibility tree. The replacement test checks actual clock-region pixels before, during and after reading; it passed, and the resulting screenshot was visually inspected. The initial application run also exposed stale migration/test assumptions; only the later complete application result above establishes the recorded passing state.

## Reproduction

Run the host suite from the repository root:

```sh
npm test
```

Core tests run through the Swift package under `apps/ios/LeafhourCore`, using the repository's shared-machine build coordination. The focused native run uses the generated Xcode project, the `Leafhour` scheme, a selected iOS simulator, an isolated Debug bundle and these test selectors:

```text
-only-testing:LeafhourAppTests
-only-testing:LeafhourUITests/IOSLibraryChatUITests
LEAFHOUR_BUNDLE_ID=com.cubxxw.leafhour.chat20261102
CODE_SIGNING_ALLOWED=NO
```

`IOSLibraryChatUITests` uses `--get317-acceptance --get317-reset`. Its fixture only runs in explicitly allowlisted Debug bundles, bypasses credential-store reads/writes and stores invented books in its isolated acceptance directory. `--ios-library-chat-markdown` selects a deterministic Markdown answer; `--ios-library-chat-duplicate` sends a retained synthetic source through the real model import/preflight/choice pipeline. No real account, network model, paid generation or microphone hardware is exercised. Fixture reset does not authorize erasing a user's installed app or data.

The four focused UI cases are:

- `testGlobalChatKeyboardComposerAndDirectMarkdownAnswer`
- `testSingleAndMultipleLocalRemovalRemainRecoverable`
- `testDuplicateLocalImportOffersAllThreeChoicesThroughRealImportPipeline`
- `testSystemStatusBarHidesOnlyWhileReading`

Screenshots use XCTest keep-always attachments. Final curated screenshot links and exact source/CI/release receipts must be added after the remaining checks pass. Temporary raw logs and simulator recordings are local evidence and are not committed as public artifacts.

## Remaining acceptance

Resolve and rerun the status-bar UI case; finish independent runtime review and any checks affected by its fixes. Then record the final source commit, PR, CI gate, merge and corresponding production/TestFlight receipts separately. A source build or simulator screenshot does not prove installation, upgrade with retained data or distribution.

Physical microphone permissions and speech recognition, audible recording playback and audio-session interruptions/routing, hardware keyboard variants, physical-device VoiceOver and real-device large-text interaction remain unverified. Provider context capacities and actual accounting are covered by local contracts; real long-running provider behavior and production hosting outcomes require their own evidence.

## Related contracts

- [iOS implementation README](../../apps/ios/README.md)
- [Conversation scope and data policy](../reading-chat-scope.md)
- [Authorized design](../superpowers/specs/2026-11-02-ios-library-chat-design.md)
- [Implementation plan](../superpowers/plans/2026-11-02-ios-library-chat.md)
- [Native release operations](../ios-testflight-release.md)

## Visual evidence

All images are actual isolated simulator screenshots with synthetic content; no user books or records are included.

- [Keyboard composer](2026-11-02-ios-library-chat/screenshots/chat-keyboard.png)
- [Native Markdown](2026-11-02-ios-library-chat/screenshots/chat-markdown.png)
- [Duplicate choices](2026-11-02-ios-library-chat/screenshots/duplicate-choice.png)
- [Removed books](2026-11-02-ios-library-chat/screenshots/removed-books.png)
- [Quiet reading without system time](2026-11-02-ios-library-chat/screenshots/quiet-reader.png)

`npm run build:vercel` and `npm run check:release` both passed on the final source before commit. A live-model probe found no model credential in this local environment, so no real provider call or long paid-model test is claimed. The configured provider model metadata was checked against its official documentation.

Final reviewer closeout: both scoped reviews approved after the compaction termination regression was fixed. The previous oversized-last-answer reproduction now terminates; the reviewer reran 45/45 runtime/capacity checks.
