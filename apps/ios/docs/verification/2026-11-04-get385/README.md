# GET-385 public native evidence

These are simulator captures of an actual, already-submitted fictional Markdown response from the designated test workspace. The raw provider output is [real-markdown.md](real-markdown.md); its 2,377 characters have SHA-256 `3d66479bf3ab3d0f15eebc153da0768f8b8e438c3465498bc6508d03dd515940`. The original was retained across renderer changes. [whole-message-copy.json](whole-message-copy.json) records the exact native clipboard match. It contains no clipboard contents beyond the separately published fictional response.

The provider omitted bold-italic and strikethrough from the main answer. A separate real request produced [real-supplement.md](real-supplement.md), shown in [real-supplement.png](real-supplement.png). This supplement does not replace or rewrite the main answer.

| Files | Scope |
| --- | --- |
| `baseline-arrival.png`, `baseline-reopen.png` | Original arriving response and failed cold reopen; retained as baseline failures. |
| `light-real-00.png` through `light-real-09.png` | Overlapping normal-size native coverage of the complete frozen answer. Scrolling viewport edges are visible; the screenshots are not cropped. |
| `dark-*.png` | Selected uncropped maximum-type captures after the paragraph line-height fix. The full reverse traversal covered 88 screens, then was manually stopped during a redundant forward pass; that test did not pass. These images precede the subsequent native text-container/placement correction and do not replace its regression results. |
| `before-policy-GET385-book-*.png` | Real public-domain Book of Tea selection, portrait companion half-sheet and source/draft return. These predate deployment of the new answer-style prompt; the old raw citation-tool diagnostic remains visible and is not presented as a successful new-prompt result. |

The screenshots do not establish physical-device installation, VoiceOver operation, an iOS 17 runtime or TestFlight upgrade behavior. Failed and complete local result bundles remain separate from this selected public image set. The [verification ledger](../../../../../docs/verification/2026-11-04-get385.md) records actual checks, intermediate failures and delivery status.
