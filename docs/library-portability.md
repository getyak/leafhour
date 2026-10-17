# Reading-library portability

Open **Library → Settings → 数据与迁移** after signing in. Export and restore have no subscription or model-generation requirement. Nothing in this panel publishes a book, creates a share URL, grants MCP access, or resumes an AI job.

## Three scopes

| Output | Includes | Excludes |
| --- | --- | --- |
| Reading-library ZIP | Confirmed source text and metadata, content versions, separate literal/interpretive translations and attribution, comments and edits, questions, AI conversation history and exact citations, highlights, reading milestones/goals, position, confirmed time, shelf order/trash state | Credentials, sessions, Agent grants, budgets/leases, unfinished generation, unsynced browser drafts, listening audio/histories |
| Selected personal Markdown/JSON | Explicitly selected comments, questions, AI answers or confirmed time, with source anchors, versions, timestamps and attribution; quotations only when selected | Full book, unselected records, credentials/grants |
| Selected sharing Markdown/JSON | Explicitly selected comments/questions/AI answers, source locators, and quotations only when enabled | Full book, time and position history, unselected private questions, credentials/grants; no automatic publishing |

Original uploaded files are **optional**. Without them the ZIP still contains extracted text and translations, so it can restore reading without the source service. With the checkbox enabled, a missing or damaged original stops export with a reason; it is never silently omitted. Listening-specific histories and generated audio use the existing separate `/api/library/books/:id/audio/export` interface. Save or separately export pending browser drafts before migrating; a server backup cannot access another browser's unsynced state.

Selections start empty. Changing scope clears selections; changing selected records, format or quotation preference invalidates the preview. The download uses the exact preview string. User text is presented as text, not interpreted HTML. The record selector pages at 100 records per book.

## Open ZIP schema 1

The archive uses standard ZIP and UTF-8 JSON, with no account IDs or server paths:

```
manifest.json
books/000.json
books/001.json
originals/000.bin       # only when the user chose to include this original
```

`manifest.json` has `kind: "leafhour-reading-library"`, `schemaVersion: 1`, `exportedAt`, `includesOriginalFiles`, book IDs/content versions/file paths, an inventory of file paths, byte lengths and SHA-256 values, and explicit exclusions. Each book file holds the compatible `marginalia-library` book/records/shelf entry, plus an optional `marginalia-reader-chat` schema-1 history. Original bytes must match the book's recorded source hash. There is no dependency on the original site's cookies, signed URLs, storage bucket or AI provider.

Exports are stored without compression to avoid unnecessary CPU work. Imports support stored/deflated ZIP, check directory and local-header consistency, bound expansion incrementally, reject duplicate/unknown/unsafe filenames, check the complete inventory and every hash, then validate all books/records/chat sources and target conflicts. The limit is **100 books and 512 MiB compressed and expanded per package**, with the existing **256 MiB per original** limit. Capacity errors are explicit. Legacy schema-1 library JSON remains supported; the new UI wraps it in the same validated ZIP restore flow.

ZIP is handled by MIT-licensed `fflate` **0.8.3**, declared directly and pinned in the lock. `app/fflate.mjs` is its unmodified browser ESM (`esm/browser.js`), SHA-256 `b7ca4450b19559a1d50eb381adcee94b82449674be4cd17789d9beba7e6122a1`; `app/fflate-LICENSE.txt` retains the license. This avoids a runtime CDN or build-only dependency. See the [official library documentation](https://github.com/101arrowz/fflate).

## Restore and retry

The browser first checks the entire archive. Authenticated owner-pinned endpoints upload at most 1 MiB of ZIP bytes per JSON request; book/original exports are also bounded. No function response needs to contain a whole book or original.

```
POST /api/library/restore/start          {bytes, sha256}
POST /api/library/restore/:id/part       {offset, data: base64}
POST /api/library/restore/:id/commit     {}
POST /api/library/restore/:id/cancel     {}
GET  /api/library/books/:id/portability-part?offset=0[&snapshot=sha256]
GET  /api/library/books/:id/portability-original?offset=0&sha256=sourceHash
```

The server repeats complete inventory, source-version, record, citation, existing-history and original validation **before any library write**. A rejected package leaves book/record/chat/original data unchanged. It clears its staged bytes. A valid package can encounter an I/O error during application: it reports failure, retains the immutable staged package for retry, and never reports transactional success. Repeating a completed commit returns its saved receipt. Re-importing the same ZIP merges stable record/chat IDs, preserves existing positions and translation variants, and does not duplicate records or enable AI. A clean target retains the source position's metadata. Existing legacy JSON endpoints retain their previous compatibility behavior.

Each account has one reusable staging slot and at most 512 fixed part keys. Receiving/commit leases prevent simultaneous mutation. Completion/cancellation clears private staged bytes. An inactive operation expires after an hour; it can no longer commit, and cancellation or the next start clears its bytes. The fixed slot/key cap prevents abandoned operations from accumulating unbounded new packages; expiration is not a new scheduled worker. A cancelled page waits for the current upload acknowledgement before cancelling its newly allocated slot. The final commit cannot be cancelled midway through writes.

Restored chat is terminal history: running turns become interrupted failures, and scope/grants/companion consent are not activated. Imported history does not silently become model context in the narrower current-book scope. Citation URLs are reconstructed from stable locators; embedded URL credentials or authentication query parameters are rejected.

The fixed acceptance table is in [the GET-148 plan](portability-get-148-plan.md). Validation must include an actual clean-instance restore, selected sharing bytes, keyboard/responsive browser checks, independent review, exact-head CI and production acceptance; downloading a ZIP alone is insufficient.

Export GET reads retry a transient transport/gateway or truncated JSON response at most three times, with 200/600 ms pauses. Each attempt retains the same part URL and checksum, and rechecks the active owner and cancellation state. Permission/validation failures and corrupt inventory are never accepted; persistent errors stop with a reason. Restore POSTs and model requests are not automatically retried.

Outbound ZIP book parts project out private/runtime fields recursively, including session identifiers retained in migrated reading-resource archives. Reading events, source anchors and prose remain intact; persisted source records are unchanged. Incoming packages still reject those fields before any domain write. Credential-bearing source URLs remain rejected.
