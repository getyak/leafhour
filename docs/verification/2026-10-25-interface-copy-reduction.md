# GET-218: interface copy reduction

Local implementation and verification complete. PR, CI, merge and Production readbacks are separate delivery evidence; see the linked GET-218 issue and PR for their final state.

## Baseline and ownership

- Public repository `getyak/leafhour`, isolated branch `codex/get-218-work`.
- `origin/main` fetched at start and again before delivery: `dca8eab7ebb231ffea521a0b7c212416923c0ccf`.
- Historical `/Users/xiongxinwei/data/mine/marginalia-reader` is unavailable on this host. The named handoff document was absent from the public baseline and local project checkout. No historical candidate hunks were recovered. This is newly reconstructed work, not a previously verified candidate.
- The main local checkout was read-only. GET-218 does not take over the behavior of GET-201/202/219/220 or mark those issues complete.
- No cloud book, translation, private note, payment, notification or model-provider invocation was created by this verification. Synthetic local test data is separate from the real default account.

## Decisions and resulting behavior

[copy-decisions.json](get-218/copy-decisions.json) records 111 decisions with the prior text/placement, replacement/removal, trigger and rationale. There are 92 changed catalog values (23 per locale), plus the home heading, static fallbacks and structural changes.

Normal reading has no routine translation notice between the chapter heading and its first paragraph, no collapsed guidance shell and no hidden duplicate accessible text. Book details retain the short sample count. Existing reading settings expose source/translation facts in every display mode. Actual saved variants determine reviewed/draft/unknown counts, AI provenance, creators, models and licenses; missing creator/license fields remain explicit. Public sample facts are used only for the unchanged sample. The action to open existing translations does not call reviewed translations drafts.

Untranslated passages retain their original and local missing status. Before generation, the action retains its bounded current/neighbor scope, private-note boundary and existing price/consent contract. In-flight, failed and unknown results remain in the existing viewport reading dock when selection changes. Confirmed saved feedback expires after six seconds; it cannot clear a later failure. A confirmed pre-submit cancellation remains available on its passage and does not erase an earlier unresolved result. The funding recovery link retains keyboard focus through locale repaint.

Home, settings, empty library/onboarding, calendar, gift and audio/export copy were reviewed. Five decorative reading paragraphs were removed. Gift preview/optional fields, public sharing boundaries, original/script/position export and audio restoration actions remain. Existing chat, companion, billing consent, privacy and irreversible-action behavior were inspected and kept within their owning contracts; this is not a full rewrite of every site string.

## Browser evidence

Real browser rendering used the production app server with all actual AI providers disabled. Deterministic translation responses and isolated local ownership are explicitly fixtures. JPEG/PNG files and JSON observations below are committed; no real account library screenshot is published.

| Scenario | Coverage | Evidence / observation |
| --- | --- | --- |
| Matched reader before/after | en, zh-Hans, zh-Hant, ja × 390×844, 768×1024, 1440×1000 | `before-reader-*` / `after-reader-*`, [before](get-218/before-reader.json), [after](get-218/after-reader.json). Same Alice first passage, data/storage and 22px body font. Baseline served from the initial public commit. No horizontal overflow or routine heading shell. |
| Matched home and reading preferences | Same 4 locales × 3 sizes | `before-home-*`, `after-home-*`, `before-preferences-*`, `after-preferences-*`, [surfaces](get-218/surfaces.json). Main actions remain visible. |
| Sample boundary / modes | zh-Hans, 390 | [sample-boundary.json](get-218/sample-boundary.json), source-details and boundary screenshots. Six prepared passages have separate variants; seventh retains original plus missing label. Original and literal parallel modes preserve the selected passage in the viewport. Escape returns focus to settings opener. |
| Metadata truthfulness | 4 locales × 390; en 1440 | [provenance.json](get-218/provenance.json). Reviewed and draft AI fixture variants and missing licenses are distinguished. Non-AI metadata projection is unit-tested, not represented as a human-reviewed production book. |
| Background task / failure | 4 locales × 390; en 768/1440 | [running](get-218/dock-running.json), [scrolled](get-218/dock-scrolled.json), [failure](get-218/dock-failure.json), [wide](get-218/dock-wide.json). Final dock feedback stays in viewport and does not overlap the expanded tools panel at 390. Earlier `fixture-background-*` screenshots document the observed offscreen defect before the dock correction. |
| Delayed success, failure, network, lost acknowledgment / retry | Synthetic bounded responses | [phase 1](get-218/fixture-phase1.json), [retry](get-218/fixture-retry.json), offline/unknown/recovery screenshots. Lost response retry reads saved variants without another mock translator invocation. No real paid generation or ledger settlement tested. |
| Consent cancellation | 4 locales × 390 | [consent-cancel.json](get-218/consent-cancel.json), [complete server receipt](get-218/fixture-cancel-server.json). Existing sandbox prompts retain point costs; all dismissed, 4 quotes and 0 translator calls in this phase. `cancel-network.json` is a truncated partial trace and is not the zero-call proof. |
| No AI service | en 390 | [no-ai-service.json](get-218/no-ai-service.json). Existing variants remain locally available with neutral label; missing variant action is disabled and explains service availability. |
| Empty guest/owner/onboarding/calendar | 4 locales × 390 | `empty-guest.json`, `empty-owner.json`, `calendar-empty.json` and screenshots. Onboarding gives a concrete import action. Some initial empty-guest root text observations were empty; explicit visible-text assertions, not that raw root field, establish the text. |
| Gift / audio and export | 4 locales × 390 | [gift.json](get-218/gift.json), [audio-empty.json](get-218/audio-empty.json). No gift sealed and no cloud export, import, email or payment side effect. |
| Locale, refresh, unsaved draft | en→ja, 390 | [draft-language-refresh.json](get-218/draft-language-refresh.json). Same passage and exact unsaved text retained; local synthetic draft cleared after the check. |
| Text selection and copy | 390 | [selection-copy.json](get-218/selection-copy.json). Selected and copied word equals the source; no generation action. |
| Touch and keyboard | Chrome touch emulation 390; browser keyboard | [touch-disclosure.json](get-218/touch-disclosure.json), screenshot. Touch start/end opens and closes the source disclosure. Enter/Escape and focus return verified. Emulation restored and task Chrome tab closed. This is not a physical touch-device test. |
| Real default-account identity | Existing authenticated production session | Correct default test email and current Auth ID were read back from `/api/auth/session`; no password re-entry was needed. Private identity receipt retained locally. Library read-only; no private notes opened or new persistent data created. Content-state scenarios above deliberately use fixtures. |

Accessibility evidence is DOM/accessibility-tree structure and browser keyboard behavior. Removed routine prose is absent from the heading tree, not moved to aria-label/title. No complete VoiceOver speech test, nontechnical user study or native-speaker human review was performed.

## Deterministic checks

- Final affected host suite: **136 passed, 0 failed, 0 skipped** across 13 files. [TAP log](get-218/host-tests.tap). Covers DOM/state behavior, locale/draft retention, cancellation, paid-intent identity, disclosures, copy exporter/toolchain and reader build. Independent reviewer also ran 32 focused host tests.
- [Independent review](get-218/review-final.md): 30 high-risk checks and 14 removal checks, no open P0/P1/P2. Confirmed metadata/action-consumer and feedback/focus defects were fixed with regression assertions before approval.
- [Runtime build](get-218/runtime-build.txt): 928 files, 9.0 MB, initialized without model requests. Reader web build passes the unchanged 320 KiB public JS budget; neither budget nor release allowlist was widened.
- [Real pinned copy lint](get-218/copy-lint.txt): Vale 3.24.0, textlint 15.8.0; 2,345 raw alerts, **0 new T1**, 373 existing-debt alert hits, 1,972 retained warnings, 0 justified exceptions, 0 stale bindings. These are not a claim that all existing text is human-reviewed.
- [pruned-debt.json](get-218/pruned-debt.json): only 12 exact bindings made obsolete by reviewed text edits removed; 328 other entries unchanged. No new allowances, lower severity or automatic unknown→reviewed promotion. The real canary suite passes: deliberately planted violations fail.
- Copy inventory re-exported from the final input bytes; tracked inventory binds its input digest, not an assumed historical commit. See [copy-export.json](get-218/copy-export.json).
- `git diff --check` passes. No iOS build or simulator was needed.

## Release and lifecycle boundary

The PR must pass latest-head CI, merge normally, then have same-commit Vercel Production and online reading readbacks before Linear Done. No Preview is created or awaited. Post-merge identifiers/results belong in the PR/Linear delivery receipt so this source document does not pretend to know a future merge SHA.

Initial resource observations: 47.22 GiB available, 170 Node/npm processes and 9.71 GiB swap; pause marker absent. These warnings caused controlled tool concurrency, not termination of other tasks. Only this task's exact QA-server PIDs and registered disposable artifacts may be reclaimed. The isolated workspace and unique evidence are retained under the explicit dispatch instruction.
