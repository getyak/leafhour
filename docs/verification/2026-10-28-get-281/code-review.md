# GET-281 independent pre-landing review

Reviewed working changes against `fd16fd3` in `/Users/xiongxinwei/.codex/worktrees/get-281-reading-design/marginalia-reader`, including tracked CSS/test changes, new verifier, `.cursor/`, `.impeccable/README.md`, PRODUCT/DESIGN context and GET-281 spec/plan. Read-only on the checkout; isolated synthetic browser services and screenshots were created under `/tmp`.

## Strengths

- Quiet chrome uses the existing toolbar/chat owners. The late `reading-hub.css` collapsed overrides were removed, and the sleeping parent now disables pointer hit testing while focused/unread chat restores it explicitly. Focus return remains owned by `reader-tools.mjs`, rather than duplicated by a new layout owner.
- Runtime changes are CSS only. No source corpus, source identifiers, API/model context, billing, account or privacy services changed. The release allowlist contains zero `.cursor`/Impeccable entries; searches found no runtime imports. `git check-ignore -v` confirms both downloaded engine `scripts/bin/` and `.cache/` are ignored. `git diff --check fd16fd3` passed.

## Findings

### P1 — Selected-source composer can exceed the half-height sheet and clip Send

Location: `app/reader-chat-workspace.css:51` (introduced half-height/minimum calculation), interacting with the existing overflow-hidden frame at line 26 and mobile message padding at line 54.

Reproduce with an isolated signed-in synthetic account and public Alice, `ui=en`, viewport 390×568: select the complete first prose paragraph (302 characters), then click the real `#quote-to-ai` action. This creates the application's actual local quote chip; no fixture DOM, model call or API write is involved. Native selection was seeded using a Range, and the real reader selection owner accepted the resulting excerpt.

Measured layout:

| Viewport | Sheet height | Messages height | Composer bottom | Viewport bottom |
| --- | ---: | ---: | ---: | ---: |
| 390×568 | 360 | 48 (entirely padding) | 603 | 568 |
| 390×501 | 360 | 48 (entirely padding) | 536 | 501 |
| 390×844 | 422 | 63 (48 padding; less than one 30.4px line of text) | 832 | 844 |

At 568px, the header is 65px, status 52px, selected-quote composer 229px and footer 12px. The frame clips the lower composer and send action and there is no frame scrolling at these heights. The zero-content message area also prevents reading the answer. This is a normal existing source-selection flow, so the 360px minimum demonstrated by the empty/draft verifier does not establish usable sheet height for it.

Evidence: `/tmp/get281-review-quote568.png`, `/tmp/get281-review-quote501.png`, `/tmp/get281-review-quote844.png`.

Recommended correction: give this deliberate source-attached state sufficient height, or provide an overflow/scroll arrangement that keeps answer, source and send reachable. Verify 501/568/844px with the actual quote action, then remove the quote and confirm ordinary half-height geometry returns. The implementer acknowledged this finding and is adding a state-aware full-height quote state and a real-selection regression check; that follow-up was not yet reviewed in this snapshot.

## Additional checks and limits

- Expanded nested chat menu at 390×568: its scroll container measured 280×276px, from y261 to537, inside the 360px sheet. Its 517px content remains scrollable. This was a geometry check; no export, scope write or preference action was executed.
- Read focus-return, mobile modality/inert, compact viewport and anchor-preservation owners. No additional concrete issue found in those changed interactions. The parent's separate five-size packaged verification is supporting evidence, not an independent run by this reviewer.
- Adjacent unverified state: `reader-annotations.mjs:104` embeds an already-open annotation card in mobile chat; `reader-annotations.css` gives it a fixed `min(220px, 32vh)` height. It adds another fixed frame child and should be included when evaluating the same height budget. This is a static risk, not a second confirmed finding.
- No full test suite, Safari, physical iPhone/OS keyboard or screen-reader acceptance was performed by this reviewer. The parent is running final tests and packaged checks. Validation-in-progress is not treated as a product finding.
- Newly generated verification documentation and later implementation edits may change after this snapshot; review the final staged diff before merge.

## Declined to judge

- Reading-comprehension or long-term habit improvement: requires reader research and is outside implementation acceptance.
- First-use discovery of invisible touch edges: an explicit approved design direction; no new correctness finding is inferred from the preference itself.

## Assessment

**Ready to merge: With fixes.** Resolve and re-verify the selected-source sheet overflow before landing. No further confirmed correctness, runtime, privacy or package issue was found in the reviewed snapshot.
