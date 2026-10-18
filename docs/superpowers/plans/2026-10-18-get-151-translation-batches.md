# Explicit translation batch implementation plan

> For agentic workers: use the delegated execution contract, then independent Codex review; preserve all project constraints.

Goal: resumable bounded translation orchestration through the existing domain API.
Architecture: pure batch planner/checkpoint runner plus a thin Node CLI; server translation adds optional source-version and pre-save fences. No autonomous job or new provider.
Tech Stack: Node22 built-ins, existing Leafhour library/HTTP service.
Spec: docs/superpowers/specs/2026-10-18-get-151-translation-batches.md

Global constraints: no real account/model calls in tests; existing drafts never marked reviewed; no secrets/source content in checkpoint; dry-run default, execute max1..20; no unrelated edits/commits/push/Linear writes by worker.

Review focus: source/account changes between requests; partial/manual translations; uncertain HTTP success; checkpoint symlink/lock races; credentials in error output.

- [x] Add behavior tests for the CLI runner and stale/partial/reviewed server safety; record meaningful RED.
- [x] Implement tools/translation-batch.mjs and a focused supporting module, with session validation, bounded transport, source fingerprint, atomic private checkpoint and serial resume.
- [x] Add optional contentVersion to server translation route and pre-save source/translation guards without breaking old callers.
- [x] Run focused tests, update release-files.json and document operator usage, evidence and the distinct missing real-content/human gates.
- [ ] Independent review, fix confirmed P0/P1, full verify:deploy, current-head CI, merge and exact release smoke; keep Linear open until remaining actual acceptance is achieved.

Worker-side evidence for the first four items: [GET-151 验收记录](../../verification/2026-10-18-get-151-translation-batches.md). The last item is parent-owned and intentionally unchecked; real full-book content and human review remain open.
