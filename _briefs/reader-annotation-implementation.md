# GET-195 · Reading annotations

Status: implementation in progress. This plan is not a claim that the feature is deployed or accepted.

When a reader selects a difficult sentence, an explicit **Annotate with AI** action saves the highlight and asks the reading agent for a response. The existing plain Highlight action remains available. Selecting text, opening a saved mark, changing language or returning to the chapter does not start generation.

The response is free prose. The request supplies the selected words, chapter and book identity; the agent can inspect other chapters, the outline and other AI annotations in that book when useful. It does not have to fill a definition/meaning/summary template. Book text, stored responses and tool results remain data, not new instructions or authorization.

## Reading surface

Show one selected annotation at a time. Use the available right margin on wide layouts; use an inline card beside its passage when the margin is occupied, in parallel reading, or on small screens. Preserve the current reading anchor and original text nodes. A thin warm rule, restrained attribution and readable prose should fit the existing paper/night system.

Keep author text, translations, editorial notes, the reader's words and AI explanations distinct. The current editorial Annotations panel retains its meaning. AI responses show their site-agent or external-agent origin. The first explanation never fabricates a user question; subsequent user follow-ups retain their exact words.

All actions need visible focus, a minimum44px target and keyboard/Escape behavior. Closing returns focus to the originating action. Language changes update labels in place and preserve the active card, input node, draft and IME composition. An uncertain network response retries the same request identity instead of starting another model job.

## Content and storage

Each owner/book has a private JSON annotation archive, separate from personal comments and chat history. A thread holds a stable typed selected-text quote, an optional highlight identity, timestamps and independently attributed messages. IDs, offsets, source version, original/translation layer and translation status remain explicit. Historical snapshots survive export; new writes require the current source to match.

The pure model uses `leafhour-reader-annotations` schemaVersion1. Its bounded limits are100 threads,20 messages per thread,12000UTF-16 units per message and1MiB per archive, including deletion tombstones. Exceeding capacity returns an error instead of trimming words. Exact retries are idempotent; conflicting identities fail. Restore merges words and preserves tombstones so an old backup cannot resurrect a deleted thread.

Persist runtime claims separately from exported content, in an atomic per-book state wrapper. Never export controllers, run authority, leases, credentials or grants. Reuse the existing chat service's local locks/hosted CAS, owner request quota and global reservations; do not create a second locking or billing subsystem.

## Agent and permission boundary

Use the existing official DSH reading runtime and bounded input encoder with an annotation-specific request label. Supply only the selected quote, book/chapter metadata and the last six complete exchanges from that thread. Existing current-book source tools retain their actual citation registry. A bounded annotation-read tool exposes AI explanations, without private notes, user follow-ups from other threads, unrelated chats, other books or progress writes.

Generation checks current identity, source, highlight ownership and capacity before dispatch. Cancellation, deletion and source changes fence the shared run authority. The successful source-mutation API acknowledgement is the ordering boundary: its awaited invalidation listener must commit before returning success. If invalidation wins first, a stalled publication CAS must retry, observe terminal authority and refuse the late answer. Answers already committed before that boundary remain honestly attributed historical snapshots. Natural token expiry has check-time semantics; it is not described as a global transaction with annotation storage.

External agents can write free AI explanations through the same domain service, using an explicit per-book `annotation:write` grant. The server fixes external-agent attribution; a client cannot impersonate the reader or the site agent. A separate `annotations` read grant exposes AI annotation objects. Existing grants and their default scope selection do not expand. External writes do not call a paid model.

## Portability and delivery

Portable book entries use `readerAnnotations`, separate from the book's editorial `annotations`. Validate before any restore side effect and recheck the applied book before merging. Old backups remain valid. JSON and selected-record exports retain ownership and source attribution without a subscription gate; restored archives never restart generation.

The reader keeps its existing320KiB JavaScript and200KiB CSS caps. The annotation UI loads through one reviewed literal deferred edge, with matching server/release/build checks. Preserve the shared locale singleton, catalog boundaries, audio and palette behavior.

Verification must cover synthetic model/archive cases, actual shared-CAS interleavings, owner/grant isolation, API error/retry behavior, archive round-trips, the official MCP SDK and native browser interaction. Visual review includes wide/compact layouts, paper/night, four languages, keyboard, draft/IME and unchanged source/reading anchors. Model mocks are labelled as such; real bounded generation and final Production acceptance require separate evidence.

Only after independent P0/P1 review, current-head CI, normal merge, exact-source Production and online acceptance will GET-195 be completed.
