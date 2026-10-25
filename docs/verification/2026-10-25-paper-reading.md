# Quiet paper reading: local verification

Scope approved on 2026-10-25: quiet typesetting, typographic chapter openings and directly manipulated page turns. Illustration generation was explicitly deferred. Existing scroll/spread preferences and account data are retained.

## Resulting behavior

Choose **Reading → Aa → Page layout → Turn pages**. Wide windows show facing pages and a chapter-opening leaf; narrow windows place the chapter opening with the beginning of the text. Page edges, gutter and footer use the existing paper/night palette. Settings remain overlays and do not reserve a new text column.

Page corners follow a curved strip model while the original HTML stays selectable. A released short drag returns; a deliberate turn settles and commits once. Opposite input cancels a pending leaf before chapter-boundary navigation is considered. Zero progress inside a live gesture does not remove that gesture's visual layer. Reduced motion bypasses snapshots and frames.

Basic keyboard input is an independently served, small static pagination dependency. Optional rendering and paper CSS load only after page mode is requested. Missing or pending visual assets leave ordinary keyboard/button paging available. Temporary copies are inert and hidden from accessibility, have no duplicate IDs, and are bounded by both element count and text length; oversized chapters use immediate paging.

## Deterministic verification

- Node **22.22.0**, the repository's complete test set with `--test-concurrency=4`: **3,315 total; 3,314 passed; 0 failed; 0 cancelled; 1 skipped**. No test was omitted or weakened. The existing Linux-x64-only pinned Node-license tamper case is skipped on this macOS host.
- The initial unrestricted local suite had one 15-second SDK-memory-transport timeout under concurrent load. The affected `highlights.test.mjs` passed **10/10** alone in 436 ms. The controlled complete run above passed without changing that timeout or test.
- Final focused regression run: **41 passed**, covering motion, input ownership, pagination, the actual reader's note/IME/locale lifetime, and hosted asset boundaries. New behavior was observed failing before implementation/fix, including cancelled notes on pager clicks, stale release velocity, zero-progress drag lifetime, optional-asset keyboard recovery, and oversized single-paragraph policy.
- Pinned Vale/textlint and copy canaries passed. Copy inventory regenerated from the final scanned source; no new allowances, debt substitutions or language-review claims.
- Isolated reading runtime built and initialized: **928 files, 9.0 MB**, without model requests.
- Hosted build, public-build inspection, release allowlist and release-provenance verification passed: **415 public files**, **11 registered media assets**, **886 software allowlist entries**; private data/history excluded.
- The existing **320 KiB JavaScript / 200 KiB CSS** startup limits remain unchanged. Final hosted initial assets: **327,629 JavaScript bytes**, **200,730 CSS bytes**. Page-specific rendering/styles remain outside these startup assets.
- `git diff --check` passed. The original checkout's **38** pending files were fingerprint-checked and remain byte-identical; unrelated work was not included.

## Actual browser checks

Chromium used the anonymous public Alice catalog on a local instance with no text or speech keys configured. No private library, personal note, account preference, payment or image-generation request was used.

Evidence: [browser-check.json](paper-reading/browser-check.json), [review-regressions.json](paper-reading/review-regressions.json).

| Scenario | Observed result |
| --- | --- |
| 1440 × 1000 facing pages | Chapter opening and body share a stable spread; curved strip angles differ, rather than rotating one rigid panel. |
| Edge drag and release | Nine temporary visual copies, inert parent, zero duplicate IDs; commit occurs once after release. |
| Short drag held still | Returns to the current page; earlier pointer speed is not reused as release velocity. |
| Opposite input at chapter start and end | Cancels the pending leaf and retains the chapter/page, including the first frame. |
| Drag forward → exact starting point → forward again | Layer count remains `1 → 1 → 1`; the leaf remains visible and commits normally. |
| Failed optional renderer request | Left/right keyboard paging remains available. Pending loading is also covered by the input-owner unit test. |
| 230,000-character single-node synthetic fixture | Zero visual copies; one immediate paging callback. The fixture was removed without changing book content. |
| Resize while holding a leaf | Cancels the old layer and retains the passage; no horizontal overflow at 768 or 390 pixels. |
| Settings and font changes | Settings do not change paper width; the passage anchor remains owned by the reader. |
| 390 × 844 night view | Single-page layout, existing night colors, no horizontal overflow. |
| Reduced motion | Immediate page change and zero visual layers. |
| Selection and source integrity | Selected text does not trigger paging; all passage IDs and original rendered text remain identical across the scenario. |

Public-book screenshots: [desktop](paper-reading/desktop-quiet.png), [bending leaf](paper-reading/desktop-bending.png), [tablet](paper-reading/tablet.png), [phone/night](paper-reading/phone-night.png). These are actual local UI captures; typography settings were adjusted during acceptance and are not a claim about every user's defaults.

The unchanged local HTML/atmosphere code reports existing inline-style CSP diagnostics. They were not silenced by changing the security policy. No new page-turn exception was observed; this is not a claim of a globally clean console.

## Independent review and limits

A fresh read-only whole-branch review identified four Important issues: chapter-edge reversal, loss of the zero-progress layer, keyboard dependence on optional assets, and the single-node text-size gap. All four were reproduced and fixed with the regressions above. The reviewer reported no Critical issues, no separate Minor findings and no declined-to-judge cases.

Physical touch devices, Safari/WebKit, Firefox, VoiceOver speech output and prolonged reading comfort have not been accepted in this run. Browser accessibility-tree structure, inert copies and input behavior are narrower evidence. No full-book retranslation, generated illustration, paid model acceptance, private backup restore or schema migration was performed.

## Delivery receipt

The initial feature merged through [PR #180](https://github.com/getyak/leafhour/pull/180) as `7d9684a75c7e1de3418a5291c53f09f9f9ec0989`. PR CI, main CI and [Production verification](https://github.com/getyak/leafhour/actions/runs/40182667675) passed. An anonymous online readback confirmed that exact release and actual paper mode/button paging. No Preview was created or awaited.

## Page-edge fallback follow-up

The final online gesture check found one remaining boundary: dragging a corner at the chapter edge did not continue, although tapping the corner or footer did. The snapshot guard returned before starting the gesture. The same path affected oversized chapters and reduced motion.

Three new tests first failed with zero paging callbacks, then passed through the actual surface event handlers. The gesture now keeps its measured leaf width even without a visual snapshot. A completed fallback gesture delegates immediately to the existing page/chapter owner; a short drag returns. No next-chapter text or preview is fabricated. The motion owner exposes its actual active state rather than a second cached lifecycle flag.

Native browser validation moved `ch01 → ch02 → ch01` by dragging opposite page edges and returned to the previous chapter's final spread; see [edge-drag-boundaries.json](paper-reading/edge-drag-boundaries.json). The focused motion/input/surface/pagination set passed **24/24**. This follow-up's complete checks and same-commit Production receipt are recorded in its PR before final delivery.
