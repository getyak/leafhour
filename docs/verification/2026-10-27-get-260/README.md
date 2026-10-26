# GET-260 verification

Reading replies now grow from real runtime `text-delta` chunks. The existing DSH plugin forwards bounded cumulative snapshots through its authenticated loopback bridge. The chat POST negotiates NDJSON, while JSON callers keep their existing contract. The final receipt follows runtime completion, source/version verification, persistence and the existing credit gate. Provisional text is kept only in browser memory and never becomes conversation history or an export answer.

Reader replies have a lightly bordered paper container, 16px text, 1.9 line height and restrained headings. Copy, formatted links and verified references appear on completion. The single collapsed evidence entry, current passage in More, scope, drafts, retry, keyboard/focus behavior, reduced motion, mobile sheet and desktop book geometry remain available. Incremental text appends to a stable text node; repeated snapshots do not append duplicate words. Stop fences late progress and discards the provisional prefix while retaining the question. A lost response reconciles the original request ID rather than automatically dispatching again.

## Local evidence

- The initial plugin/HTTP regressions failed on the baseline: no live prefixes and a JSON response that arrived only after generation. Decoder and DOM regressions likewise failed before implementation.
- Full host suite: **3509 passed, 0 failed, 1 existing Linux-only platform skip; 3510 tests total**. Native PostgreSQL financial fixtures executed using a read-only official Postgres.app 16.15 image. Its SHA256 matches `2689dc64d6a02e0a66e4585616919060d8fbf5bb06886fccc05b7f87638bf081`; application signature verification passed. The first run's missing-Postgres failure was resolved by reusing this verified cache, without changing test or CI requirements.
- Fixed Vale 3.24.0, textlint, planted copy canaries, release policy and public-content checks pass. The frozen copy source object was fetched as CI requires. Existing copy warnings and debt stay visible in the log.
- The isolated DSH runtime built and initialized: 928 files / 9.0 MB, without a model request. Final reader bundle: **326341 / 327680 JS bytes**, **204771 / 204800 CSS bytes**. Original budgets remain unchanged; duplicate chat CSS declarations were consolidated.
- `tools/verify-chat-stream.mjs`: **8 packaged Chromium cases** exercise a synthetic adapter through the real plugin, authenticated bridge, domain service, NDJSON, fetch decoder, state and DOM. Arrival timestamps establish that a visible prefix predates adapter completion. Cases cover desktop/phone/320px/tablet, paper/night, all four locales, stop in a compact viewport, empty output, partial failure and transport loss followed by same-request recovery. Real provider generation is a separate boundary; these are synthetic adapter chunks.
- The existing quiet-chat browser verification passes **11 cases**, preserving collapsed evidence, original passage menu, missing translation, failed-question editing, nested Escape/focus return, draft reload, source return, book geometry and horizontal overflow behavior.

The screenshots use public-domain Alice and synthetic answer text. Physical devices, OS IME and screen-reader speech are outside these browser-driver checks. Production source, real-account interaction, independent final-head review, CI and merge have their own delivery receipts.

## Independent review

Reviewer `/root/get260_review` found no unresolved P0/P1/P2 after two confirmed P2 fixes: shared provisional-text wrapping for the library mount, and per-frame limits that remain valid when multiple frames arrive in one network read. The coalesced-frame regression failed before the decoder fix and passes afterwards. Independent test runs passed 50/50 and 122/122. The exact committed revision and final closure are recorded on the PR.
