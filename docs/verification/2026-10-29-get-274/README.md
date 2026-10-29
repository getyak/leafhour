# GET-274: summon the reading companion

Issue: [GET-274](https://linear.app/getyak/issue/GET-274). Starting main: `44f3836`. [PR #209](https://github.com/getyak/leafhour/pull/209) remains the historical prototype; this change modifies the formal Web and native readers rather than copying that prototype.

## Delivered behavior

The Web reader keeps its existing authenticated chat service, draft/history owners and desktop sidebar. Phone conversation sheets remain half of the visible viewport with a selected quote or embedded annotation. Long quotes and multiline drafts can scroll within the sheet, including short/landscape viewports. Closing returns focus to the quiet reading edge. Unread state no longer exposes the sleeping AI entry or its bubble/live announcement; explicit keyboard focus remains visible. Existing companion preference, generation authorization, history and cancellation behavior are preserved.

The native reader exposes “陪我读” only after waking its top controls. UIKit system selection adds “解释这句”; PDF selection offers the same explicit action. The companion sheet uses a single half-height detent, retains the original book above it and clears the old system selection. “继续读” dismisses directly without waiting for unrelated state writes. Existing notes retain their save/exit guards. Repeated nil selection callbacks are filtered to avoid an Observation write when PDFKit clears selection during a view update.

**The native companion service is not connected.** Its sheet displays real source text and an explicit unavailable message. It contains no simulated AI answer or nonfunctional composer. This source/UI increment does not establish native AI acceptance or complete GET-274.

## Executed checks

- **47 host Swift tests passed**. **212 related Node tests passed**. The pinned vendor integrity check and public release allowlist passed. Web production packaging succeeded.
- Before the change, the native explicit-summon test failed because its button did not exist. The selected-quote Web layout fixture occupied all 844px of a 390×844 viewport; the focus regression also failed. After the change, the Web focus suite passed 7/7.
- The reviewed unsigned native build passed. **Two actual XCTest flows passed**, using the existing guarded Primary iPhone / iPhone 17 Pro / iOS 26.5 and isolated `org.leafhour.get274`: explicit summon + cold restart; system text selection + explain. Both checked upper-book space, real unavailable text, dismissal and no residual controls. The fixture is a bounded public-domain excerpt of `catalog/alice.txt`, seeded through the normal OfflineLibrary import service. No shared app data was overwritten or simulator created/erased.
- The final native assertion waits up to one second for the navigation element to disappear **after the XCUI tap returns**. It is not a frame-level touch-to-dismiss or physical-device latency measurement. An earlier run used a one-second polling expectation and failed; changing that test to `waitForNonExistence` passed without a product dismissal change. Those failed results remain in local evidence.
- Formal packaged Web UI passed in Chrome at **390×844, 375×667, 390×600, 844×390 and 1440×900**. Actual edge/entry and selection-action clicks, a real DOM source selection, ten-line unsent drafts, half-sheet geometry, reachable send controls, quiet exit and unread-state suppression were checked. Mobile heights were 422, 333.5, 300 and 195px; desktop retained its 400px sidebar. Observed click-to-quiet times were **27–37ms** in this controlled browser run, not native performance claims. See [raw measurements](web-results.json).
- Browser tests used a disposable local identity and intercepted only chat availability to exercise the actual composer. No question was sent and no model was called. Existing inline-style CSP console errors were observed in the local compiled harness; this run does not claim zero-console acceptance. The interaction/layout assertions passed independently of those errors.
- Independent agent review found two P2 issues (short-screen composer overflow and hidden-bubble live announcements); both were fixed and reviewed. The PDF repeated-nil guard was also reviewed. Final review found no blocking issue.

Copy lint and the latest CI/publication receipts are tracked in the primary PR. Only actual successful receipts establish those later states.

## Remaining acceptance

Keep GET-274 **In Progress** until its required platform acceptance is satisfied. Native AI integration, real-model answers, physical iPhone timing, Safari/system selection and keyboard, full VoiceOver/haptics, PDF interaction matrix, iPad and actual TestFlight installation/update are not established by this source phase. Existing Apple release work remains separately owned; this task did not retry login, register an app, change accounts, upload or invite testers.

The browser run is controlled UI evidence, not proof of live model availability, answer quality or general reliability. Merge, CI, Vercel Production and same-revision online acceptance must be verified separately.

Local full logs, failed/successful `.xcresult` bundles and drivers are retained in the task's permanent evidence directory. Source screenshots and hashes are in [evidence.json](evidence.json).

API references: [Apple presentation detents](https://developer.apple.com/documentation/swiftui/view/presentationdetents(_:)) and [UIKit system edit menu](https://developer.apple.com/documentation/uikit/uitextviewdelegate/textview(_:editmenufortextin:suggestedactions:)).
