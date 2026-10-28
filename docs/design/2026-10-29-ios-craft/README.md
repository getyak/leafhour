# Leafhour iOS: reading craft proposals

Date: 2026-10-29, Asia/Shanghai. Task: [GET-296](https://linear.app/getyak/issue/GET-296). Baseline fetched from public `origin/main`: `9c127e0bdbab11ae21dc2f462dad4d8430cd0ef2`.

The user authorized approximately half-hourly rounds through **2026-10-30 12:00 Asia/Shanghai**. This ledger separates code observations, native checks, proposals and delivery. A time window is not evidence that scheduled continuation was installed.

## Sources and useful design choices

| First-party reference | What it documents | Application to Leafhour |
| --- | --- | --- |
| [Apple Books](https://support.apple.com/guide/iphone/read-books-iphc1af7c57/ios) | Reading appearance controls, adjustable type and layout, and theme recovery | Give typography an immediate visual result and a reversible default |
| [Readwise Reader appearance](https://docs.readwise.io/reader/docs/faqs/appearance) | Separate typeface, size, spacing and light/auto/dark choices; mobile reading themes; long-form Aa access | Keep familiar access, clear controls and meaningful preference states |
| [Readest](https://readest.com/) | Fonts, margins, spacing and colors; synchronized parallel reading | Investigate bounded line width and anchored comparisons rather than adding decorative containers |
| [Apple layout](https://developer.apple.com/design/human-interface-guidelines/layout) | Adapt content and controls across size and input contexts | Verify rotation, split view, narrow sheets and larger type independently |
| [Apple motion](https://developer.apple.com/design/human-interface-guidelines/motion) | Brief purposeful feedback, optional motion and cancellable interactions | Preserve reduced motion and source position; prioritize responsiveness over extra animation |

These are documentation observations, not competitive-app usability tests or proof of their implementation on this device. The Leafhour choices below are proposals informed by those sources and current source code.

## Ranked improvement ledger

| Priority | Observation and confidence | Proposed improvement | Evidence needed before acceptance |
| --- | --- | --- | --- |
| 1 | Native baseline capture: settings shows numbers without units and has no local text sample | Live current-book preview, explicit pt units, spoken slider values and a typography-only reset. Implemented in batch 1; runtime checks recorded separately | Preview updates while dragging; controls remain stable; reset retains theme and anchor; cold persistence |
| 1 | Code: PDF shares text sliders, but PDFKit preserves fixed pages | Hide ineffective font/spacing controls for PDF and explain native zoom. Implemented in batch 1 | A real PDF in the native app shows theme and zoom guidance, no false font control |
| 2 | Code: UITextView has fixed 24pt side insets; no maximum reading measure | Center a bounded text column on wide iPad/landscape, keeping image width and anchors aligned | Actual iPad/rotation/split-view screenshots, selected-text and cold-position checks |
| 2 | Code: every query evaluation scans all passages synchronously; visible snippets show only passage starts | Cancellable bounded search work, result counts and a snippet around the match | Long-book typing latency and cancellation measurements; correct case/diacritic/scalar-offset navigation |
| 2 | Native source and baseline: interfaces use Chinese strings directly | Localize native navigation, file states and accessibility using existing project language semantics | English, simplified/traditional Chinese and Japanese flows; source text and stored preferences unchanged |
| 2 | Code: selected text, quote editor and records depend on the same anchor/save lifecycle | Test compact-screen keyboard, draft continuation and the return-to-source route; fix only measured friction | Real selection, interrupted editing, relaunch and save-failure recovery; no user-note exposure |
| 2 | Code: quiet controls sleep unless focus/selection/VoiceOver holds them | Verify edge discovery and an explicit accessible route without restoring a permanent toolbar | VoiceOver and hardware-keyboard tests, including return focus and reading continuity |
| 3 | Code: font/spacing changes rebuild chapter attributed text and request saves | Profile reflow, image work and save queue while dragging; optimize only if traces show a problem | Current device latency and allocation traces; identical source/anchor/notes after interruption |
| 3 | Existing implementation has paper/night/system, semantic foreground and reduced-motion checks | Measure night contrast, maximum type, control truncation and reduced-motion behavior | Actual actions/screenshots; a screen-reader pass beyond visual contrast |
| 3 | Local import/retry and offline integrity have truthful retained-original states | Review progress, cancellation and repair copy with an uninterrupted path back to the book | System picker, duplicate import, failure/retry and interrupted import on isolated files |

Priorities express reader value and dependencies, not a claim that all proposals are confirmed bugs. Existing GET-276/272/273/274 scopes remain separate. No new paid model calls, whole-book translation, background push, cloud migration or TestFlight distribution is implied.

## Batch 1 design

Keep the native Form and the current ReaderSession binding. The preview displays an unchanged, bounded excerpt of the anchored source passage, falling back to the current chapter's first text passage. It uses the existing serif font scale and line-spacing values, follows Dynamic Type, and has a stable height at each system type size so dragging a slider does not shift the slider beneath the finger. It is a sample, not a claim that the narrower sheet reproduces the whole book's line breaks.

Reset changes only font size and line spacing to ReaderPreferences defaults. Theme, reading anchor, notes and drafts remain in the same state object. PDF retains theme selection and explains its fixed page typography; font controls are absent. No new preference fields or storage migration are introduced. Native captures also exposed stale presentation appearance after night-to-paper and night-to-system changes; both presentations now resolve the same theme against the presenting library's current system appearance. The open-sheet light/dark/light transition was validated separately.

## Current limitations

Native source/local build, simulator behavior, production web deployment, TestFlight upload, availability to testers and physical-device acceptance are distinct states. This batch cannot satisfy GET-276's complete physical and distribution acceptance. See [runtime verification](../../verification/2026-10-29-get-296-ios/README.md) for actual current evidence.

## Native font diagnostic follow-up

A read-only probe recreated the current body UIFont construction and queried Core Text fallback in the existing iOS 26.5 simulator. The Latin sample `Reading` retained `.NewYork-Regular`; the literal ranges `阅读` and `読書` returned `.PingFangUIDisplaySC-Regular`; `한글` returned `.AppleSDGothicNeoI-Regular`. The three queried Songti/Mincho font names could not be loaded directly. These observations apply to those samples and that runtime; they do not prove that every other CJK serif is absent, that every Japanese string follows the same path, or that physical-device typography has been accepted. [Probe and exact output](../../verification/2026-10-29-ios-font-diagnostic/README.md).

This changes the next typography recommendation: a serif API setting alone must not be described as Chinese serif output. Inventory actual faces and glyph coverage before adding a choice. If a separate licensed offline CJK font is considered, first prototype its script/locale behavior and measure app size, memory, first render and scrolling. Retain a reliable native fallback and avoid controls that silently select an unavailable font or trigger a network download during reading. No font asset, font picker or reading-data migration was added by this diagnostic.
