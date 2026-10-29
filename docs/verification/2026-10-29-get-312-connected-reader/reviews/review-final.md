# GET-312 limited follow-up review

**Conclusion: clean within the requested follow-up scope.** The six first-pass findings are addressed by the current source. No remaining P0/P1 or actionable P2 blocker was established in these repairs or the two requested additions. This is a limited repair review, not a new open-ended review of the feature.

Reviewed the current working tree in `/Users/cubxxw/.codex/worktrees/ios-connected-reader/leafhour`, using the first report and `/private/tmp/ai-test-GET-312.OHEJ7B/review-fixed.patch` as scope. No application code was edited, builds/tests/simulators were not rerun, and no account/provider network requests were made.

## Original findings

1. **P1 stale pull overwrites reader state — addressed.** `CloudBookSync.synchronize` now joins the existing per-book task rather than returning early. `LibraryModel.open` waits for it before loading the reader snapshot, and `openingBookID` prevents a newly started model-wide synchronization from pulling while that book is opening. The direct reader store continues to push without replacing live reader state. Position resolution also waits for in-flight work and uses the opening guard.
2. **P1 old-account reader after sign-out — addressed.** Sign-in/sign-out now refuse while an open is active. Open captures `contextID`, checks it after disk/network awaits and before publishing, and checks the cloud's current owner after synchronization. Auth refusal is not silently converted into an open.
3. **P2 oversized note stalls the book — addressed.** The cloud UTF-16 limit is checked per note. Failures remain represented in `noteErrors`, preserve local content, and allow subsequent valid notes and progress to proceed. The model includes persisted sync errors in its status rather than reporting an unconditional success. The full local record remains exportable.
4. **P2 formatted selection rejected — addressed.** `SelectedQuote` now separates displayed text from exact source text. The text coordinator maps both selection ends to the source and `prepare` validates/submits the resulting raw substring with UTF-16 boundaries. The added native regression covers emphasis, an entity and emoji through the actual coordinator.
5. **P2 stale selection pins tools to the wrong paragraph — addressed.** Sheet dismissal and text dragging clear transient selection; the shared reading-scroll callback also clears it. Draft storage is independent and preserved. Ordinary toolbar actions can return to the current reading anchor.
6. **P2 definitive request refusal locks out new requests — addressed.** Known pre-execution HTTP refusals and trusted terminal billing states clear retry while retaining the user's question. Unknown/in-flight conflicts retain the original body and request/billing identity, preserving the important no-duplicate-request boundary. The added tests cover refreshed scope after 412, uncertain 409, and a terminal ledger receipt.

Inspected the added native/core regression sources. Execution results remain the controller's separate validation evidence; this reviewer did not rerun them. In particular, the account regression checks the client generation fence, while the model's newly added open/transition guard and context checks were checked statically here.

## New saved-summary page

`SavedReadingSummariesScreen` uses only GET `/api/library/notebook-workspace`, matching `server/reading-workspace-service.mjs`'s existing read projection. It shows adopted `relations` separately from pending `candidates`, labels both as AI-assisted/draft content, counts `noteKeys`, and does not call analysis/generation or write the remote workspace. Workspace cache reads/writes use the captured account-scoped OfflineLibrary and the supported `workspace` cache key. The page resets its state on account-task changes and checks the current account before publishing the network result. No cross-account cache lookup or generation side effect was found in this addition.

## Vendor provenance addition

Inspected `tools/verify-ios-vendor.mjs`, its negative tests, the pinned Markdown `UPSTREAM.json`, and `UPSTREAM.md`. The verifier pins manifest bytes independently, rejects unexpected files/symlinks, and validates each listed file's length, SHA-256 and Git blob hash. The cmark manifest labels `Package.swift` and `UPSTREAM.md` as local; other listed material is upstream. The controller reports independent comparison of 69 upstream entries against the official Git tree; this reviewer did not repeat that network comparison.

Executed only the read-only checksum command `node tools/verify-ios-vendor.mjs` during this review. It passed for ZIPFoundation 0.9.20 (26 files) and swift-cmark 0.6.0 (71 files). This validates the current files against the reviewed manifest pins, not signing, distribution, or production behavior.

Native build/test, CI, merge, production deployment, TestFlight and physical-device acceptance remain separate evidence states.
