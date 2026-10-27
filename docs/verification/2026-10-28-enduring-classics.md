# Shared enduring classics: verification record

The batch adds 24 works and a Chinese Tao Te Ching edition, represented by 32 reading volumes/editions. The shared catalog contains 64 entries and 60,654 paragraphs: 8 added Chinese entries and 24 added English originals or historical translations. No account data or generated translations are published.

## Source evidence

- All 32 added artifacts reproduce byte for byte from pinned primary-source HTML using the scoped offline importer.
- The independent scoped character-sequence audit passes for all 32. Chinese ignores whitespace; English collapses layout whitespace. This establishes sequence fidelity within declared scopes, not historical translation accuracy or a critical edition. Compressed machine results accompany this record.
- The prior 32 manifest records and source artifacts are unchanged against 744c20b.
- All 10 illustrations present in selected source scopes have local copies with fixed hashes, byte lengths, MIME types and source URLs. Ten numeric tables retain spacing and line breaks. Hamlet retains 4,397 source body line-break tags.
- Republic digital production notes are separate source notices. Red Chamber 1–40/41–80/81–120 are reading partitions. Wisdom of Life has two English volumes; World as Will and Idea has three English volumes. Epictetus includes 66 selected discourses and the complete 52-section Handbook.

## Validation before integration

- 39 Python extraction fixtures pass.
- 20 targeted Node tests pass: real shared catalog, frozen text hashes, source emphasis, mixed languages, resource validation, keyboard input and static media receipts.
- Independent source and runtime reviews identified and corrected Republic digital notes, the numeric-table font cascade, table clipping in paginated mode, and figure-link paragraph selection.
- A real Chromium CSS reproduction verifies the 185-line Wealth of Nations table can scroll to its end in a narrow paginated viewport; keyboard arrows scroll the focused table. Full built-app and Production verification are recorded in the pull request after integration.
- The reading-list prose completed the required copy detection, semantic review and retest. No eligible changes were needed; private reports retain candidate decisions.

Full integration checks and exact-commit Production acceptance remain pending at this commit. Their actual results will be recorded in the PR; do not infer deployment from this source receipt. Native device, Safari, VoiceOver and historical print collation are outside this verification.
