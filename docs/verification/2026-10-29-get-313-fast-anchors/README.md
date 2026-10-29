# GET-313: fast source offsets in long native paragraphs

Initial base: `9ed97de798f08818f2c12c4eed2f1804fe867ebb`. Before push the branch normally merged substantive native main `bf14c77` (GET-312/PR259) and CI/instruction main `c03ecd7` (PR260), preserving their behavior and revalidating the combined reader. Issue: [GET-313](https://linear.app/getyak/issue/GET-313). This record covers source, host tests and one actual native Simulator test. PR/current-head CI, merge, main CI, production website and TestFlight are separate delivery stages.

## Reader benefit and implementation

Each scroll checkpoint previously bridged a passage to NSString, copied its UTF-16 prefix and counted Unicode scalars. TXT/Markdown imports retain entire paragraphs, so a long paragraph can make this repeated work significant. The change indexes the unchanged source once and reuses it while reflowing the same session/chapter. It does not split or truncate the paragraph.

`SourceTextOffsets` caches counts, uses identity conversion for BMP scalars, and stores one internal String.Index/UTF-16/scalar checkpoint every 1024 scalars for longer supplementary text. Lookup binary-searches the checkpoints and scans at most 1024 scalars. Capture, restore and selected-quote anchors use the same conversion. For formatted Markdown, the existing display↔raw UTF-16 document map stays in place; this index converts the passage-local raw offset on either side of that map. A permanent app integration test verifies a long mixed Unicode quote in plain/Markdown and two font sizes, including exact sourceText. It checks quote/reflow mapping synchronously, not an actual Markdown scroll restoration. Indices belong to the struct's immutable String. Reuse checks session object identity, chapter index, passage ID and exact UTF-8; a new source or dismantle releases the old spans. Array-position matching avoids a passage-by-passage quadratic search.

Swift canonical string equality can treat composed and decomposed spelling as equal despite different raw scalar offsets. Exact UTF-8 comparison avoids reusing the wrong index. See the official [Swift string guide](https://docs.swift.org/latest/documentation/the-swift-programming-language/stringsandcharacters/), [UTF-16 view](https://developer.apple.com/documentation/swift/string/utf16view) and [scalar view](https://developer.apple.com/documentation/swift/string/unicodescalarview). The seven new host tests exercise both representations, combinations, emoji/ZWJ/flags/skin tones, CJK, RTL scalars, NUL, negative/oversized values, long checkpoint boundaries and bridged/immutable storage. Invalid positions halfway through a surrogate pair floor to that scalar's beginning; legal scalar offsets inside a grapheme cluster stay distinct.

No source text, stable IDs, saved scalar schema, notes/exports, font/network dependency or TextKit engine is changed. Latest GET-274/GET-312 companion/translation/discussion callbacks, optional menu items, 64pt entry inset, transient selection clearing and exact sourceText remain intact. This does not certify its separate end-to-end flow.

## Component measurements

The paired experiment uses ASCII `reader `, BMP `字é ` and mixed `a字😀é ` repeated 8, 32000 or 128000 times on the host. Native uses 8/128000. Each pair uses the same valid source boundary with alternating old/new order and asserts equal answers. Two warmups are discarded. Old lookup includes an autorelease pool; new lookup uses the prebuilt index. Timed construction uses distinct equal-length inputs prepared outside its timer. Checksums keep answers live. Median uses sorted[count/2]; percentile labels use sorted[floor((n-1)*0.95)]; these are small descriptive samples, especially four native construction samples, not a statistically established production percentile.

| Scope / mixed UTF-16 units | Old lookup p95 | New lookup p95 | Construction (host p95; native median / max) | Samples lookup / construction |
| --- | ---: | ---: | ---: | ---: |
| Host -O / 56 | 0.000584ms | 0.000167ms | 0.000334ms | 48 / 10 |
| Host -O / 224000 | 2.701375ms | 0.008625ms | 1.883166ms | 48 / 10 |
| Host -O / 896000 | 6.979416ms | 0.006125ms | 15.812208ms | 48 / 10 |
| Native Debug / 56 | 0.022416ms | 0.006459ms | 0.005625 / 0.005750ms | 24 / 4 |
| Native Debug / 896000 | 3.928917ms | 0.014042ms | 13.407292 / 13.544917ms | 24 / 4 |

All case summaries and benchmark outputs for the nine host/six native cases: [host](host-comparison.json), [native combined final](native-combined-final-report.json). Short cases show no observed lookup increase in these runs; sub-microsecond host values approach timer/compiler resolution. Different runs varied with shared CPU/swap pressure; earlier baseline and preliminary runs remain in the formal archive. The table uses the final paired runs, not the best number from each run. Host -O and native -Onone are not directly comparable.

For 896000 mixed UTF-16 units the host index contains 749 checkpoint elements, 17976 bytes of element fields (`count * MemoryLayout.stride`), excluding array capacity/allocator overhead, String/object storage and temporary allocations. ASCII/BMP have zero checkpoint elements. This is not RSS or total allocation measurement. First construction remains linear and on the render path; reusing an unchanged source avoids rebuilding the index, but exact UTF-8 validation still scans on reflow. This change removes repeated prefix scanning from checkpoint lookup; it does not prove first-layout, whole-frame, FPS, real-finger or physical-device performance. A chapter with many huge paragraphs can still have expensive initial layout.

## Actual native regression

One executed XCTest, **31.616s / zero failures**, on the existing task-owned iPhone 17 Pro/iOS 26.5 Simulator, Debug, actual xcodebuild `-jobs 2`, serial testing. It runs the component comparison on the main actor with sleeps outside timing samples, then checks:

1. Programmatic selection `waistcoat-` remains through a real session font change and attributed-text rebuild.
2. Explicit scalar500 navigation remains current and clears selection.
3. A controlled in-memory session with identical chapter/passage IDs but changed mixed source forces replacement: 3000 scalars/3500 UTF-16 units, followed by restoration of the original source. This is a component source-owner check, not a real library/source migration or cross-chapter UI test.
4. A real long-press system menu → 记笔记 → type → 保留草稿 → terminate/relaunch → 我的记录 → reopen restores the exact draft body. Final on-disk quote is `see`, text/text-2 scalar687, checked against the unchanged public source. This proves this quote's cold draft persistence, not every language's natural selection or exact cold reading pixel position.

![Native book after component checks](native-reading.png)
![Cold-recovered selected quote and draft](cold-quote-draft.png)

The temporary [native probe](probe.swift) and [XCTest](ReadingUITests.probe.swift) are archived here as evidence; they are absent from app/test targets after the run. The host driver restored the original task state byte-for-byte, SHA `f0df05c436c404e0a9a7a81e85c03b701ad763adc4f800078f4735ea2fcf0e57`, even on failure; [readback](restoration.json). No private/cloud/model data was used. The borrowed Primary remains booted. [Actual counts and source hashes](verification.json).

## Reproduction and limits

Run the Core suite with `swift test --package-path apps/ios/LeafhourCore --jobs 2` through the host's `dev-ios-session` and resource audit. To reproduce the host benchmark, concatenate the checked-in SourceTextOffsets.swift with [benchmark-body.swift](benchmark-body.swift), compile with `swiftc -O -num-threads 2`, and execute on a quiet comparable host. This intentionally uses the exact implementation in one module; actual app Debug integration was checked separately. Record source hashes and configuration, rather than comparing absolute numbers across machines.

Formal archive `native-fast-anchors-evidence.tar.gz` and `fast-anchors-preservation.json` live with the overnight control artifacts, with runtime/ restore scope and full file hashes. Raw old/new sources, host logs, native xcresult, snapshots and drivers are preserved. Initial semantic RED (6 tests/one expected failure) and six-case preliminary benchmark are retained as excluded/superseded. The final combined Core suite executed **83 XCTest / zero failures**; the combined native AppTests executed **19 XCTest / zero failures**, including the permanent long plain/Markdown quote test; the separate Swift Testing zero-test footer is not acceptance.

Independent code and measurement/evidence review found no confirmed P0/P1 or substantive P2. The presync native report remains separately labeled [presync](native-final-report.json); 54host/1native36.985s apply only to that old source. The first combined UI run passed its component checks and all19AppTests, then failed a test-only assumption that the reading dock was hidden after cold start. The final test opens the already visible 我的记录 directly, waking the tools only when needed. No app behavior was changed for that harness fix. The explicit-go assertion concerns session scalar500 and selection clearing; no visible-line scalar was sampled in this batch. No actual allocation trace, full scrolling trace, Release iOS benchmark, iPad/split view, VoiceOver, mixed-direction natural multi-range UI selection, physical device or TestFlight acceptance is claimed. Existing GET-276 distribution work remains separate.

## CI repair after main synchronization

The synchronized head2f95917 CI [40836356227](https://github.com/getyak/leafhour/actions/runs/40836356227) passed native/catalog/release checks but failed one of4273 Node tests; CI gate correctly prevented merging. The existing observability test expected server/browser synthetic flags in asynchronous delivery order. Its unchanged production service starts those deliveries concurrently, and the failed run returned browser/server completion order. This is independent of the iOS source changes.

The test now forces **both completion orders** through an isolated fetcher promise gate, requires both payloads, and checks each payload by browser event UUID or trusted server event identity. Client-supplied top-level and property synthetic=true still must produce synthetic=false; trusted server context must produce true. PostHog classification is the subject of this test, so the unrelated Sentry sink is disabled for its two cases. No production observability source changed.

With the old array assertion retained, the forced browser-first case deterministically failed: [RED](ci-order-red.log), 3 Node tests /1pass /2fail including the enclosing parent. With identity assertions both orders pass: [GREEN](ci-order-green.log), 3 /3pass. [Scope and source hashes](ci-order-repair.json). This iOS-only workspace lacks the Sentry SDK dependency; the full SDK suite was not locally executed or relabeled passed. Current-head full hosted CI is still required. No blanket retry, check bypass, SDK/runtime change or full dependency installation was used.

Independent test-logic review confirmed unchanged anti-forgery assertions, both controlled orders and bounded gate cleanup; the full Sentry suite remains a hosted-CI requirement.

## Native authentication main integration

A final premerge check detected main advancing to `90c30d0c497ed4642094fce5c90dd313add01928` (GET-315/PR263). The nonzero ancestry result stopped merging; this branch then normally merged that main into `434847dc1964d25edb546599825a5a277a1a8e71`. All four reader/index/test hashes and AGENTS/briefs remained unchanged. A bounded independent integration review confirmed that same-account linking preserves the ReaderSession and opening a book still creates a session, without mutating its immutable source/index owner. This does not review or certify real provider sign-in.

Once the shared device lock became available, guarded jobs2 revalidation executed **92 Core XCTest and 23 native AppTests, zero failures**, including all added OAuth/authentication test names checked against passed lines. These are isolated fake/provider protocol tests; no real Google/Apple flow was started. The original task state SHAf0df05c436c404e0a9a7a81e85c03b701ad763adc4f800078f4735ea2fcf0e57 was restored byte-for-byte, only the task app was terminated and the borrowed Primary stayed booted. [Exact summary and archive](post-auth-main-validation.json). Earlier guard exit75 meant another chat held the lock; no test or artifact had started in that attempt.

The 31.616s native UI probe remains evidence for its four byte-identical reader sources and quote/draft flow. It was not rerun as an authentication-provider UI or physical-device acceptance test. Current synchronized head CI, normal merge, main CI, website source and native distribution remain separate gates.

An independent evidence review matched the 92/23 counts, all added passed test names, actual jobs2, state restoration and four reader hashes; current exact-head CI remains required.
