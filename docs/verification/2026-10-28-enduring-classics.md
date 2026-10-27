# Shared enduring classics: verification record

The batch adds 24 works and a Chinese Tao Te Ching edition, represented by 32 reading volumes/editions. The shared catalog contains 64 entries and 61,371 paragraphs: 8 added Chinese entries and 24 added English originals or historical translations. No account data or generated translations are published.

## Source evidence

- All 32 added artifacts reproduce byte for byte from pinned primary-source HTML using the scoped offline importer.
- The independent scoped character-sequence audit passes for all 32. Chinese ignores whitespace; English collapses layout whitespace. This establishes sequence fidelity within declared scopes, not historical translation accuracy or a critical edition. The [compressed machine audit](2026-10-28-enduring-classics-source-audit.json.gz) accompanies this record.
- The prior 32 manifest records and source artifacts are unchanged against 744c20b.
- All 10 illustrations present in selected source scopes have local copies with fixed hashes, byte lengths, MIME types and source URLs. Ten numeric tables retain spacing and line breaks. Hamlet retains 4,397 source body line-break tags.
- Republic digital production notes are separate source notices. Red Chamber 1–40/41–80/81–120 are reading partitions. Wisdom of Life has two English volumes; World as Will and Idea has three English volumes. Epictetus includes 66 selected discourses and the complete 52-section Handbook.

## Validation before integration

- 40 Python extraction fixtures pass.
- 22 targeted Node tests pass: real shared catalog, frozen text hashes, source emphasis, mixed languages, resource validation, keyboard input and static media receipts.
- Independent source and runtime reviews identified and corrected Republic digital notes, the numeric-table font cascade, table clipping in paginated mode, and figure-link paragraph selection.
- A real Chromium CSS reproduction verifies the 185-line Wealth of Nations table can scroll to its end in a narrow paginated viewport; keyboard arrows scroll the focused table. Full built-app and Production verification are recorded in the pull request after integration.
- The reading-list prose completed the required copy detection, semantic review and retest. No eligible changes were needed; private reports retain candidate decisions.

Final local integration verification passes: 3,903 Node tests (3,889 pass, 14 explicitly skipped, zero failures), 40 Python tests, isolated runtime initialization, static build, public media validation, release allowlist and source snapshot checks. Exact-commit Production acceptance remains pending at this commit and will be recorded in the PR; do not infer deployment from this source receipt. Native device, Safari, VoiceOver and historical print collation are outside this verification.

## Final integration corrections

The Darwin source presents its index as one paragraph with blank lines. Its 718 source entries are separate reading passages; concatenating them reproduces the entire original 40,688-character block exactly. Earlier chapters and the figure anchor are unchanged. Every shared chapter remains eligible for the existing bounded guide planner without increasing any generation limit or calling a model.

A bounded cache interns decoded public source documents by the digest of their exact bytes (64 MiB encoded source budget, at most 128 documents). Mutable canonical books and account overlays stay outside it; metadata and resource objects are copied before returning. Changed bytes produce a new cache key. Independent nested-mutation and eviction probes pass. The encoded source budget is not a JavaScript heap memory cap.

Full test files run serially with a 1.5 GiB V8 old-space limit to prevent repeated fixture services from competing for the host's memory. The 23-test experience fixture passes in 6.47 seconds in the measured local run; local-instance startup checks pass 5/5. These are fixture measurements, not production user latency claims.

Original-table and figure styles load once from a same-origin stylesheet only for books that use them, before their first text render. Load failure is bounded and retryable. The fixed reader JavaScript and stylesheet build limits remain unchanged.
