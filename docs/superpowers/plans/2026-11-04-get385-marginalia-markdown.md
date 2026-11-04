# GET-385 implementation plan

> Execute inline with superpowers:executing-plans; independent agents review and score. The user opted out of intermediate questions.

**Goal:** Deliver native marginal-note UI and a real Markdown showcase, with independent evidence-based review.
**Architecture:** Keep the CommonMark/GFM parser and one selectable native message view. Separate conversation presentation from book typography. Keep data and model permission boundaries unchanged.
**Tech Stack:** SwiftUI, UIKit/TextKit, existing cmark, XCTest, live Leafhour service.
**Spec:** docs/superpowers/specs/2026-11-04-get385-marginalia-markdown-design.md

## Constraints and review focus

- No real credentials, session material, private books, notes or runtime account IDs in source/evidence.
- Preserve full raw source, links, selection, copied Markdown, voice attachments and user/assistant/source roles.
- Wide/long table cells, six heading levels, code blank lines and long tokens must remain readable.
- Dark appearance, maximum type, narrow and compact-height views must retain controls and draft text.
- Send real UI requests; never replace a failed live result with a fixture and call it live.
- Preserve unrelated untracked work. Reuse this checkout on codex/get385-marginalia-markdown-20261104.

## Tasks

1. [x] Capture baseline. Build a signed isolated native application, authenticate the designated test workspace from Keychain, submit the fictional showcase, retain real output and full visual coverage. Independent baseline review uses the fixed rubric.
2. [x] Pin meaningful regressions for table associations, complete content, single font scaling, native selection and safe output. Run failures before changing the renderer.
3. [x] Implement conversation typography, native block surfaces and responsive tables without modifying retained book content or raw messages. Verify with the same real response and affected tests.
4. [x] Refine companion entry/roles and internal-context phrasing. Keep necessary limitations and all permissions. Verify the normal reading question and empty/error states.
5. [x] Capture complete evidence and obtain fresh independent reviews. The user subsequently accepted the current visual version and explicitly requested merge/publication on 2026-11-04; this supersedes the earlier score target and further aesthetic iteration. Keep the actual scores, all failed states and limitations. Necessary covered-reader correctness work remains in task 6.
6. [ ] Run source review and appropriate checks, document factual results, commit/push one complete change, wait for CI, merge normally and follow existing Production/TestFlight flows. Update issue only within the requested work, without exposing runtime data.
