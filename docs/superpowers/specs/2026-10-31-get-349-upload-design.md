# GET-349: visible book imports and a usable conversation

The user requested implementation of GET-349 and supplied a private EPUB for validation. Existing repository authorization covers implementation, review, PR, normal merge after CI and production checks. The user confirmed that this change should cover the web library first; iPhone interaction is outside this task.

The current browser creates upload tasks only inside chat, closes the picker and opens chat. EPUB/text parsing and publication run inside the final upload request and return the full book. Failures lose their actual reason. The supplied EPUB has 2,131 spine entries, exceeding the existing 1,200 limit. These are observed causes, not a reason to claim every production failure is identical.

## Decisions

Reuse the existing account-bound ingestion store, runner, cancellation fence and polling routes for optional asynchronous EPUB/text jobs. Keep legacy synchronous callers compatible. Transfer completion returns a small durable receipt; parsing yields between chapter batches. Metadata and a real cover become available before the book is ready. No model calls, automatic translation, source execution or external parsing service.

Selecting a file immediately creates a stable pending book on the shelf with a filename-derived title and an honest typographic cover. Verified EPUB metadata and cover replace these when available. Transfer, organizing, ready, failed and cancelled remain distinct. Errors and retry/cancel controls stay beside the affected book, independent of shelf filters. Refresh restores server-acknowledged jobs; a not-yet-transferred file cannot be resumed without selecting it again. A ready card disappears only after its real shelf book is present.

Use the existing resizable reading conversation workspace in the library. Desktop chat occupies the full right edge and reserves width instead of covering books; narrow screens use its existing modal, keyboard and focus handling. Keep upload history and optional setup out of the message viewport. Do not remove provenance, privacy scope or failure recovery.

Add explicit recent activity (default), recent addition, publication oldest/newest and manual ordering. New imports participate in recent activity using their addition timestamp without fabricating reading progress. Publication dates come only from source metadata or existing catalog provenance; unknown dates sort last and are never replaced with upload dates. Sort survives URL navigation and composes with current filters. Manual drag ordering remains available in its explicit mode.

## Validation and alternatives

A cosmetic spinner alone would leave the synchronous request and large-book rejection intact. A separate upload platform would duplicate existing ownership and recovery mechanisms. Reusing ingestion plus the existing conversation workspace is the chosen implementation decision.

Use synthetic regression fixtures for failure, cancellation, owner isolation, refresh, duplicate uploads, sorting and metadata. Verify the supplied EPUB privately under the default account's actual Auth identity, keeping raw books, account IDs and credentials out of Git. Capture desktop/mobile layouts, upload-to-first-chapter behavior and response sizes. Raise capacities only within measured archive/document bounds; preserve stable passage IDs, source bytes and draft translation status.
