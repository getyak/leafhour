# GET-300: cancellable native book search

Native book search previously scanned every passage synchronously during view evaluation. The scan now runs outside the UI actor, coalesces input for 150 ms, checks cancellation between passages, and receives cancellation when its awaiting request changes or the panel closes. The visible result and its button action both verify the current book and normalized query. A prior row cannot navigate after the query changes. Matching paragraph counts appear above the results; the input remains the user's query.

The existing original-source excerpt and its exact Unicode-scalar anchor are reused. Each matching paragraph produces one result, even when the term occurs twice. The scanner receives only the current book's supplied chapters and has no model, network, private-note, indexing or persistence work. The existing explicit result jump still saves reading position. Request/cancellation checks also precede the empty-state reset, so an obsolete task cannot clear a newer outcome. Cancellation is cooperative between passages, not an interrupt inside a single Foundation string search. [Apple responsiveness guidance](https://developer.apple.com/documentation/xcode/improving-app-responsiveness), [task ownership](https://docs.swift.org/latest/documentation/the-swift-programming-language/concurrency/), [cancellation semantics](https://developer.apple.com/documentation/swift/withtaskcancellationhandler%28operation%3Aoncancel%3A%29).

## Measurement that motivated the change

A separate executable compiled the exact baseline SearchExcerpt source and repeated nine bounded public-domain Alice paragraphs into 3,000 passages, totaling 1,161,502 logical Unicode scalars. Each query ran three times on the existing iOS 26.5 simulator, using both `-Onone` and `-O` builds.

| Query / matching paragraphs | Unoptimized core scan | Optimized core scan |
| --- | --- | --- |
| `Alice` / 2,000 | 24.14–30.94 ms | 19.80–25.04 ms |
| `waistcoat-pocket` / 334 | 12.59–17.68 ms | 10.60–10.99 ms |
| Missing term / 0 | 12.12–14.64 ms | 8.31–8.43 ms |

These are synthetic synchronous **core scan times**, not app-input latency, frame rate, p95, a physical-device result or a measured algorithm speedup. The implementation changes which actor owns the work and cancels obsolete requests. [Raw optimized samples](benchmark-optimized.json), [unoptimized samples](benchmark-debug.json), [probe source](Benchmark.swift). The exact bounded input and compiled probes are retained with the local evidence archive; timings from different input should not be compared numerically.

## Actual validation

The host LeafhourCore suite passed **33 tests**, including five new cases for cross-chapter identity, exact Unicode anchors, per-paragraph counts, empty/missing terms, concurrent-query isolation and cancelled requests. The controlled large-scan cancellation test shares its source string to avoid unnecessary fixture allocation. It checks correctness, not a cancellation-latency target.

The current native build and **one focused UI probe** passed on the existing Primary iPhone / iPhone 17 Pro / iOS 26.5:

1. `Alice` displays six matching paragraphs.
2. Replacing the input with a missing term removes the previous count/results.
3. Clearing the input restores the empty prompt.
4. A new query displays one matching paragraph; closing search through the observed native `close` control and returning to reading succeeds.
5. Reopening starts from the empty prompt. The final query returns to the source at exactly scalar 370 in `text-2`, matching the same search range.

[Count and current results](screenshots/01-current-result-count.png) · [Quiet source return](screenshots/02-quiet-source-return.png) · [Live anchor proof](anchor-proof.json). Both published screenshots were inspected. Only the task-owned app and its bounded public fixture were used. The temporary UI probe was preserved and restored out of the checked-in test file before commit; no app test hook remains.

Independent review found that a previous result button could act before its old row finished disappearing. The button now rechecks the captured request immediately before navigation; the reviewer confirmed that P2 closed with no new confirmed issue. The final native run includes this fix. [Exact hashes and scope](evidence.json).

An initial build executed zero UI tests and was explicitly rejected despite its success status. Fresh Xcode enumeration confirmed the intended method; the accepted run requires an actual executed test, its completion marker and live anchor proof. An intermediate probe used incorrect `Cancel`/`取消` selectors while the native control was labelled `close`; that failed attempt is also retained and excluded from acceptance. The local xcodebuild wrapper overrides CLI job counts, so the accepted run set `IOS_XCODE_JOBS=2` and verified effective `-jobs 2` in its actual command log.

This probe validates functional replacement/clear/dismiss/reopen/navigation. Instrumented UI traces, end-to-end typing latency, maximum type, VoiceOver, hardware keyboard, compact/iPad, physical devices, TestFlight and deployment of this new source remain separate.
