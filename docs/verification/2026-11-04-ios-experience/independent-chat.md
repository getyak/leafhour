# Independent final assessment: chat bubbles and message actions

**Final conclusion: groups 4 and 5 pass the independent review within the observed iOS Simulator acceptance scope, each at 9.5/10.** The previously observed tab-bar occlusion and keyboard ownership problems are closed by the native container correction, strict geometry assertions and new screenshots. The first-pass 8.8/8.6 scores are superseded; they describe the rejected earlier layout, not the delivered layout.

Reviewer: journal-performance agent, who did not implement the chat changes. These are design/UX judgments against the project's rubric, not a measured population satisfaction score or a guarantee across untested devices.

| Criterion (2 points each) | Group 4: bubbles | Group 5: message actions | Basis |
| --- | ---: | ---: | --- |
| Task clarity | 2.0 | 2.0 | Roles distinguished by gutter/fill; no repeated “你问”; selection count, action labels and context disclosure are explicit. |
| Responsiveness | 1.9 | 1.9 | Keyboard/composer, live answer browsing, reactions, selection and preview actions complete in the actual UI tests; no background model request occurs on a reaction. This is interaction evidence, not a fabricated latency percentile. |
| Visual hierarchy | 1.9 | 1.8 | Restrained fills and consistent rounded surfaces; attached reactions; clear selection toolbar and three coherent editorial share treatments. Short messages still use a generous column and the reaction badge is deliberately roomy. |
| Control and recovery | 1.9 | 2.0 | Older-message browsing survives completion; latest control is reachable; selected content remains chronological; cancellation restores the composer; sharing is explicit; reactions can be removed. |
| Accessibility and consistency | 1.8 | 1.8 | Native selectable text and edit-menu actions retained, accessibility labels present, extreme Dynamic Type remains scrollable and its composer/latest action remains visible. VoiceOver and hardware interaction are outside this observation. |
| **Total** | **9.5** | **9.5** | Simulator-scope independent assessment. |

## Final evidence actually examined

The reviewer opened the following PNGs with the image viewer from `/tmp/leafhour-experience-acceptance-attachments/manifest.json`:
- `F4FD07B3-94BB-4911-9F67-377D46232699.png`: normal left/right bubbles and resting composer, with a clear viewport above the native tabs.
- `D5AF93A7-F22D-4903-8E42-62FAC1B9D206.png`: the reaction remains on its source bubble and the quiet notice states that the next explicit send conveys it.
- `ABD11786-3E66-4F3A-91D4-015C7938A176.png`: both selected messages, accurate count, Cancel/Select All and fully visible Copy/Share buttons above the tabs. This directly closes the earlier occlusion finding.
- `0E879045-268E-415B-9B55-C3B33F8DB09A.png`: a two-line composer, microphone and send control immediately above the actual keyboard; tabs no longer consume a competing keyboard row.
- `FA4F0D5D-9C56-4378-A9B1-29D8BE576041.png` and `87A84613-FAF6-4EA4-A4C0-8B9B77A35CFD.png`: extreme Dynamic Type, browsing position retained after completion, readable wrap and a reachable latest action. Although the test name includes Dark, these captures visibly render a light interface; they are evidence for large text and browsing, not visual proof of dark-mode styling.
- `E3F3E68C-FADF-4439-8481-6B56F246C0A3.png`, `0D2E62A1-5374-4854-AABE-9C5CB8ABAD0A.png`, `62CB10E7-9854-4CFF-975D-0A5D4749588F.png`: paper, ink and night sharing previews with the same editorial grid. Adjacent context retains its author, is explicitly enabled and visually frosted; the selected answer stays clear. The long preview remains scrollable to its footer. Night here is an export-card treatment, separate from app dark mode.

The reviewer read the completed logs directly:
- `/tmp/leafhour-experience-acceptance.log`: **TEST SUCCEEDED**, three native layout tests and six UI cases (three chat, three root). Chat includes keyboard/Markdown, extreme text/browsing and reaction/multiselect/sharing. The multiselect test asserts `share.maxY <= tabBar.minY`, so merely tapping a partly exposed control cannot satisfy acceptance.
- `/tmp/leafhour-experience-unit3.log`: 91 application tests, zero failures. The targeted chat cases cover reaction restoration/explicit-send timing, old-version exclusion, first-tap legacy cancellation, role order, companion omission and clipped-context attribution.
- `/tmp/leafhour-experience-node22-fixed.log`: 4,624 passed, 14 skipped, zero failures. Skipped cases are not represented as accepted. The release-module dependency gap is resolved in this tested tree.

The UI test exercises native long press and menu selection, but no standalone screenshot of the open native menu was exported. Its function is verified by that completed sequence; this report does not claim a separate menu-pixel audit.

## Source and contract review

The selected-message list filters chronological role-attributed rows, never set iteration order. Cancel clears selection without discarding the composer. Sharing captures a stable preview and includes adjacent private messages only through an off-by-default toggle. Empty companion prompts are omitted from user messages. Native UITextView selection and suggested system edit actions remain available.

Reaction requests contain only turn identity, user/assistant role and an allowed emoji. The server resolves actual text within the captured authenticated owner/conversation and validates source version and completed-assistant status. Client-supplied source text cannot replace that record. Reactions save locally without generation; the next explicit question captures matching-version targets in its immutable request. Retries and paid receipts compare those targets. Export/restore validates the complete linkage and remains idempotent.

## Closed findings from the independent review

- Initial ChatSharePanel syntax/style-name build errors: corrected before successful app builds.
- Reaction-bearing backup failed on second import because answer comparison validated a single row without its referenced source: comparison repaired; repeated restore regression passed.
- Previous-message truncation removed the author label: truncate the body first and retain role plus ellipsis.
- An old thumbs-up reappeared on first cancellation: compare the resolved reaction before mutating legacy storage.
- Companion turns produced a fictitious empty user row: absent user content is omitted from bubbles and sharing.
- Old-edition reactions could reject an unrelated new question: native turn versions are retained and only matching-version targets are sent.
- New shared reaction module was absent from release/public boundaries: explicit packaging and pure-module registration added; full Node suite passed.
- Root tabs covered multiselect actions and competed with keyboard geometry: native container now owns the measured tab height and keyboard viewport once. Final geometry tests and screenshots above close the observed defect.

## Limits

No real-user study, physical-iPhone installation, hardware haptics, VoiceOver operation or external forwarding-destination behavior was observed. The inspected current screenshots do not prove app dark mode, landscape message actions or every narrow device. Those limits do not turn the observed scenario into a broader claim. The 9.5 scores apply to the actual reviewed simulator scenes, source contracts and completed test cases stated here. Source merge, production deployment and TestFlight distribution remain separate delivery states.
