# Reading journal, notebook and tools verification

Date: 2026-10-28 (Asia/Singapore).

## Implemented scope

The shelf displays a current-month reading footprint with day drilldown and a local, previewed 1200×1500 PNG. Book titles are opt-in and personal thought/question text is never included. Source time methods remain separately inspectable and overlapping intervals stay merged. The notebook gathers existing user-authored thoughts, questions and highlights across active and archived books, with search, filters, original/translated quote labels, source return and local Markdown export. One reading tools tray reuses existing controls and places secondary actions under More.

No paid generation, cloud data migration or push notification was introduced. All browser evidence here uses an isolated temporary local service with public-domain source books and explicitly synthetic notes and time intervals. It is not a record of an actual user's reading. No cloud account was seeded, read or modified for these fixtures.

## Benchmarks and internal assessment

The design specification links Apple Books, Readwise and W3C primary references. They inform reference behaviors, not a claim that this release matches every capability of those products. The internal rubric is task completeness30, hierarchy25, interaction/accessibility20, data accuracy/privacy15, responsive/recovery10. All hard gates must pass before any score is accepted.

Internal assessment target:98/100. Hierarchy and aesthetic judgments remain subjective. Native Safari, VoiceOver and longitudinal reader research are outside this browser acceptance; no user-research score or learning benefit is claimed. Internal provisional assessment:98/100 (completeness30, hierarchy24, interaction19, data15, responsive10). The two deductions retain the need for human visual preference and native assistive-technology validation. This is a documented internal judgment, not an empirical product-quality measurement; functional acceptance and release state remain separate gates.

## Actual browser evidence

Chromium,1440/768/390/320 CSS pixels: monthly journal and notebook render without horizontal overflow. Search reduced six synthetic records across three books to the intended single record. Notebook close clears its owned URL state. Original text, personal notes and saved quotations remain separate.

The share preview produced a downloaded PNG with matching date/time and readable Chinese glyphs. Escape closed the preview first and returned focus to Share this day while keeping the calendar open. Notes/questions and book titles were absent by default.

The tools tray uses original buttons, with contents, appearance, current-book notes, listening and conversation in its first level. More holds atmosphere, full screen, search, timing options and annotation visibility. At320px the tray fits, with a132.5px Contents tile rather than a wrapped icon button. Appearance dialog opened with focus inside. Night appearance and reduced motion were inspected for notebook/journal at390px.

Screenshots are named by surface and CSS width. `reading-day.png` is the actual locally downloaded image, not a mockup. The share and notebook data shown in screenshots are synthetic.

## Review fixes

- Registered missing self-hosted assets for paper companion and reader startup; exact public-asset HTTP regression added.
- Restored notebook intent through password and OAuth return paths; actual callback extraction and HTTP OAuth tests cover it.
- Included archived books in notebook inventory and surfaced archive-load failures.
- Preserved focus when the optional tools enhancement arrives late, including controls moved into More and unmount restoration. Independent reviewer reproduced the original defect; regression tests first failed, then passed, and Chromium confirmed the repair.
- Hid the native listening-backup file input that caused320px overflow; retained programmatic import.
- Kept the main reader bundle below the existing320KiB budget by loading the layout adapter through an existing optional module, with no budget increase. The tools CSS loads only with the optional enhancement, after the main reader styles; no extra parser-blocking stylesheet or preload is introduced.

## Verification records

Focused behavior suites, full repository tests, hosted build, public-release checks, pinned copy lint and planted copy violations are recorded by the parent delivery process below. Existing copy debt and warnings remain visible; newly added copy is not marked as human-reviewed. Chinese UI copy was reviewed sentence by sentence against `docs/writing.md` and the current tone skill; the sample was below the detector's500-character minimum, so no prose distribution metrics were inferred. The trace is `copy-tone-review.json`.

## Local check results

- Hosted build passed; main reader JavaScript327,638 bytes, below the unchanged327,680-byte limit. Main CSS204,672 bytes is below204,800; only the existing quiet-chrome sheet blocks rendering. Public build and release allowlist checks passed.
- Pinned copy lint: zero new T1 errors,371 documented existing debt items and2,086 retained warnings. All11 planted real-tool canaries passed; no baseline or exception was broadened.
- Full local run discovered3,690 tests:3,686 passed, one skipped, two runtime-build checks hit their90-second deadlines under concurrent machine load, and the render-blocking stylesheet test failed. Both runtime checks then passed in the isolated runtime suite (9 passed, one platform skip). The stylesheet failure was repaired by loading optional CSS after the reader is ready. The current22-test build group passed, as did15 stylesheet/readiness/location tests. Remote CI remains required before merge.
- Focused suites cover cross-book note filtering/export and archive failures, owner transitions, real callback/OAuth returns, day/share models, CJK canvas preparation, late blob completion, keyboard reparenting, location and reader controls. The independent review approved after its two concrete findings were repaired.

## Release state

Implementation and local browser verification complete. Independent review approved after OAuth-return and delayed-focus repairs. Hosted build and release checks passed. Current-commit remote CI is the merge gate. Production verification follows the merge and is recorded in the pull request delivery metadata; this source document does not pre-claim a future deployment.
