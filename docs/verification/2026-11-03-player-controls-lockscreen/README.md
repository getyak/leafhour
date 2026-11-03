# Approved player, current-page translation and lock-screen media

## User-approved scope

The user selected 对照底页, retained the earlier full-screen player structure and allowed a shared reading/listening functional bar. They requested removal of 回到朗读 and explicit chapter/page/page-translation controls while reading. Two clarifications were answered explicitly: locked/background audio continues, with native controls; a partially visible paragraph is translated in full using the existing independent literal/interpretive storage.

## Implemented behavior

The native player separates compact book identity, selectable continuous original/spoken text, a fixed paragraph comparison region, centered playback and the same ReaderBottomBar used by reading. No control overlaps the source or translation viewport. Current-sentence contrast and quiet word color use actual speech offsets, with no word-box background or fabricated timing. Expanded comparison captures the exact displayed paragraph so later narration cannot replace selected text. Manual browsing/selection pauses following; playback or explicit sentence seek can resume it without any return-to-narration affordance. The saved listening position and the visible starting paragraph/layer are reflected before playback. Actual cover imagery is used when available; the fallback in player identity remains compact.

Reading has previous/next chapter, previous/next screen and an explicit current-page translation destination. The destination lets the reader configure original/translation/parallel display, literal/interpretive and language pair before submission. Merely opening it or changing a picker does not generate a translation. TextKit/PDFKit geometry supplies full source paragraphs intersecting the stable reading viewport, deduplicating parallel layers and excluding headings/images/empty text. Temporary tool reveal does not repaginate. PDF scope is the visible text of the current original PDF page, not adjacent pages peeking into continuous mode; the UI states this boundary. The plan freezes exact IDs and source order, skips complete duals and rejects partial or mismatched originals. Missing/stale geometry is unavailable, never a chapter fallback. Existing explicit translation quote/confirmation, account/source/language checks and durable request IDs remain.

MediaPlayer receives only real book title, author, chapter, artwork and actual output rate. It receives no private notes, selected excerpt, owner ID, source URL, guessed duration or whole-book timing. Actual cover artwork is fully aspect-fitted on a themed 1024-square paper surface. Missing artwork uses real title/author and the selected reading families/theme, plus a small Leafhour mark. Async cover completions bind current session/source/account. Remote play/pause and playable-chapter commands belong to one active owner; replacement, stop and sign-out cannot be undone by late callbacks. Old audio-session leases cannot deactivate newer audio. Microphone start releases PCM and remote controls until explicit continuation. Route loss/interruptions pause without automatic resumption.

UIBackgroundModes audio and the existing playback audio session allow explicitly started audio in background/lock. Reading time and translation generation still pause in background. Temporary boost restores on background/release/interruption and never changes saved speed. The system rate remains zero while PCM is being prepared and becomes active only after actual output callbacks. No synthetic book duration/progress is published.

## Investigation and independent review

- Shared RED proved missing viewport/media APIs and the old overlay player did not satisfy source/comparison/transport separation.
- Core page-scope RED covered exact page IDs, source-order canonicalization, partial existing twins, stale originals and Markdown image-only content. Those cases are now green.
- Native regression tests caught an uncertain old-page request continuing off-page remainder; recovery now checks only its immutable pending submission and retains the original remainder for a later explicit preparation.
- Independent review caught a freshly quoted but unsubmitted request surviving page invalidation as uncertain work. Quote, persistence and cancellation-boundary RED tests reproduced it. Retirement tracks only provably unattempted local IDs. The cancelled-context book-integrity checks initially prevented durable retirement; a narrow uncancelled local write, awaited before completion, fixes it while preserving genuinely uncertain/attempted work.
- Independent review caught TOC playback intent being cleared before start. The selected chapter/heading is captured as the explicit playback target before following clears browse state.
- Audio tests caught old teardown deactivating a new shared audio lease, late old rate/cover updates reclaiming media and remote play during microphone capture. Regressions now pass. Separate fake audio sessions remain independent.
- A nonblocking Markdown probe-layout observation was addressed with a separate per-chapter cache; it does not replace active narration layout. A continuous-PDF scope question was resolved as the current original-page boundary and documented in the UI.
- All important review findings have regression coverage and were fixed. No remaining blocking source-review finding.

## Validation receipts

Task artifacts are under `/tmp/leafhour-player-return/`, with durable screenshots in ignored `output/verification/2026-11-03-approved-player/`. The existing dedicated Leafhour Cross Device Sync simulator was used; no other product simulator, live user book, private note, real recording or paid model was used. UI tests use the explicitly allowed synthetic `org.leafhour.quiet.testing` fixture. Unit tests use isolated directories and URLProtocol responses.

- Core full suite: 329 tests, 2 existing selected-sample skips, zero failures.
- Native full suite: 331 tests, 2 selected-sample skips, zero failures. This includes the 15 page-preparation/recovery tests, media/ownership/artwork cases and 13 real local PCM/UTF-16/rate-output tests.
- Host release-contract tests: 100, zero failures. Python release/icon tests: 9, zero failures. Info.plist, vendor checksums, archive/upload shell syntax and diff whitespace checks passed.
- UI: distinct source/comparison/transport bounds; bilingual toggle/seek/native selection/hide/reveal/idle-hide; current page/chapter navigation and translation configuration; chosen chapter playback; live output surviving five background seconds; rapid double-tap page turning; portrait/landscape/rate hold; and large-text playback/shared reading action. A rotation attempt left the simulator in portrait; after restarting only this dedicated simulator, the unchanged application passed the actual landscape scenario.

System presentation is a separate limit. The simulator continued real output but its Control Center capture remained a blank system surface and manual lock commands did not provide a reliable native-media visual result. Those captures do not verify the actual lock-screen cover or control rendering. The fallback artwork render and isolated MediaPlayer dictionary/command integration are verified; physical lock/unlock, real headphone/route interruptions, audible device quality, full VoiceOver and installed-version upgrade remain pending device acceptance.

CI, source merge, exact-source production verification and automatic TestFlight processing are recorded in the resulting PR/chat after source commit. No preview or second manual deployment chain is created.

## Apple API basis

- [Playback category and background audio](https://developer.apple.com/documentation/avfaudio/avaudiosession/category-swift.struct/playback)
- [Now Playing metadata](https://developer.apple.com/documentation/mediaplayer/mpnowplayinginfocenter/nowplayinginfo)
- [Remote command registration](https://developer.apple.com/documentation/mediaplayer/mpremotecommand/addtarget(handler:)) and [owned target removal](https://developer.apple.com/documentation/mediaplayer/mpremotecommand/removetarget(_:))
- [Artwork request sizing](https://developer.apple.com/documentation/mediaplayer/mpmediaitemartwork/init(boundssize:requesthandler:))

The app uses the shared remote command center; it does not add legacy global responder-chain remote-event receiving. Production code never removes unrelated registrations with removeTarget(nil).
