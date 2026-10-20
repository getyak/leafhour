# GET-195 annotation service checkpoint

This checkpoint covers the server service and synthetic tests. The reader UI, external Agent tools, portable backup wiring, CI, merge and Production journey remain pending. GET-195 is not completed by this document.

The annotation child shares reading chat's identity, local lock/hosted CAS, owner quota and global reservation primitives. Each owner/book stores one private `{archive,runs}` wrapper. Only its pure archive is exported. Initial explanations contain no fabricated user message; actual supplied follow-ups retain their words. An optional `responseLocale` selects the initial system-owned request in English, simplified/traditional Chinese or Japanese; changing it under the same request ID conflicts.

Exact request retries return their stored running or terminal receipt. Cancellation, thread deletion and awaited source-mutation acknowledgement fence the shared key. Publication rechecks current source, authority and clock after awaits. A failed acknowledgement remains a failure and idempotent mutation retries repeat the fence. Historical source snapshots remain independently attributed. An unconfirmed completion-store failure returns503 rather than a successful empty receipt.

Before paid dispatch, capacity includes JSON escaping, all bounded citation metadata, message slots and other active answers. Restore preflights the union/conflicts against a projected target, works before a new book exists, and rechecks the applied book in its CAS operation. Imports cannot consume another running answer's reserved identity or capacity. Jobs are never restored.

Actual verification on synthetic owners/books and injected providers only:

- 132 tests passed: annotation model, service,13 race cases, actual HTTP, bounded tool pagination, existing chat/companion and generator diagnostics. No failures, cancellations or skips.
- 85 neighboring tests passed: library, highlights, source revisions, translation batch, portal and existing portability restore. No failures, cancellations or skips.
- The earlier unchanged11 independent assertions now pass after remapping only their target checkout. The preserved old-worker run remains failed evidence, not a completed delegation or verification claim.

These checks use local isolated storage or the real HostedStore implementation backed by in-memory CAS fixtures. They do not call Supabase, read real books/accounts/credentials, invoke a paid provider, install a remote MCP connection or prove a Production outcome.

Independent service review: Spec PASS / Quality PASS. One new P1 was found and closed with the unchanged counterexample: a restore could occupy an in-flight answer ID. The corrected service refuses that import before side effects, preserving the actual generated answer. No confirmed P0/P1 remains in this service scope.

Independent executions:40/40 service/race/tool cases,3/3 additional timing probes,3/3 actual portal-handler lifecycle cases and5/5 generator cases passed. These are separate executions with overlap, not a combined unique-case count. The reviewer did not run the parent's socket or neighbor suite.

Reviewed SHA256: service `232adcb93a22e0a72241b72964f0d20eb5de7ee7bc02558813d623e6186f7f40`; portal `f091e0e487a398d96fed774b4662a6f9b716a22e4576edbf4aa71133c83866d5`; independent report `013433e67fc2a6d71253e1b5cbb543d4b0f4a9f518a895c6d119fb12c03063c4`.

 Whole-feature independent review, current-head CI, normal merge and exact-source online acceptance are still required.
