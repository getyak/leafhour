# GET-385: Native marginal notes and Markdown

Improve the shipped native conversation surface using GET-385 and related GET-375. The user authorized autonomous implementation, real submission, and independent visual scoring. Keep the existing product, native text selection, complete raw conversations, source roles, account isolation, draft restoration and send behavior.

## Direction

The answer should feel like a note beside a book: the first sentence addresses the question, typography carries structure, and controls recede while reading. Keep the existing portrait companion half-sheet and compact-height adaptation. Rename the generic Chat tab to the existing companion name, 松鼠, without removing global conversation functionality. Do not repeat source paragraphs or internal capability/permission descriptions as decoration. Required uncertainty and authorization boundaries must remain truthful.

## Alternatives

1. Keep the single native attributed text view and introduce conversation-specific typography and block treatment. This preserves continuous selection and avoids changing book rendering. Chosen.
2. Split every block into SwiftUI cards. This gives easy grids but fragments selection and makes an answer resemble a dashboard. Rejected.
3. Replace the message with a WebView. This adds a second rendering/security/navigation stack and changes native selection. Rejected.

## Presentation

Use a restrained heading scale, a clear answer-first hierarchy, and consistent paragraph/list spacing. Scale fonts once for the actual content-size category. Render code with a coherent block surface, preserving every line and character. Preserve safe links and remote-image alternative text without implicit image requests. Tables must preserve every header/value association on narrow screens and at large text sizes; use a readable row-oriented representation when native columns cannot preserve those associations. Do not rasterize text or remove hard content to improve screenshots.

Keep user questions distinguishable from author quotations and assistant prose. Retain voice originals/transcriptions, immutable sent references, retry/cancel, message actions, quiet composer, scroll intent and complete history. Explicitly requested Markdown lists remain lists; the default model style must not force numbered templates or emoji tips. Internal context must not become an unsolicited capability manual.

## Evidence and scoring

Use the real deployed service and designated test workspace from the native application, with no synthetic transport flags. Send one bounded request for a fictional Markdown showcase, and retain that actual response across comparisons. A separate concise reading question checks the ordinary marginal-note style. No private notes, other accounts or full-book translation.

The phone connector currently reports no attached device. Native simulator screenshots and real-network submission are valid evidence for that scope only. Do not claim physical-device acceptance.

Use the fixed rubric in docs/verification/2026-11-04-get385-rubric.md. Independent reviewers see complete evidence and give their own scores without a requested target. Iterate on concrete findings. Completion requires every final independent score strictly greater than 96, no blocking correctness finding, affected checks and normal repository delivery. Scores are judgments under this rubric, not objective certification.

## Accepted delivery scope

On 2026-11-04, after the independent reviews, the user explicitly accepted the current version and requested merging and publishing: “可以了，合并更新到远程以及发布”. This supersedes the earlier score target and further aesthetic iteration. Existing scores and limitations remain factual records; acceptance does not turn them into scores above 96. Necessary correctness fixes, source review, CI, normal merge and source-bound release verification remain required.
