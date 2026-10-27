# Shared Nietzsche editions

> Execute inline with the existing catalog pipeline and one independent review before delivery.

**Goal:** Publish Beyond Good and Evil and Thus Spake Zarathustra in the shared catalog so every account and anonymous readers can open them.

**Architecture:** Extend the versioned public catalog, rather than account documents. Use the original Gutenberg HTML for Beyond Good and Evil (#4363; Helen Zimmern prose and L. A. Magnus poem) and Common's Zarathustra (#1998), pin its hashes, retain notices and disclose the selected reading scope. Keep all previous catalog bytes and every private copy unchanged.

**Authorized scope:** The user's 2026-10-27 correction explicitly requests these two books globally. The repository's standing delivery authorization includes a reviewed PR, normal merge and Production verification. No translation generation or private-record migration is included.

## Tasks

- [x] Pin acceptance tests for anonymous and signed-in access, complete author-text boundaries, edition attribution and unchanged prior editions.
- [x] Add two structured artifacts, manifest entries, reading metadata and arrival excerpts; update release packaging and scoped reproducibility/audit tools.
- [x] Reproduce both new editions, independently audit source coverage, run catalog regressions and the required release checks, and obtain independent review.
- [ ] Commit only this task, push a branch, open and merge a passing PR, then verify the exact Production commit and anonymous access to both books.

## Review focus

- Shared discovery and direct reading must work without the default test account.
- Original German, English translation and absent Chinese translation must remain distinguishable.
- Preserve numbered aphorisms and verse lineation; exclude only explicitly disclosed editorial material.
- Source files, passage IDs and personal state of existing books must remain unchanged.
- Both data artifacts and generated metadata must reach the packaged Production runtime.
