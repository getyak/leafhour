# Reading annotations

Select a short phrase in the reader and choose **Annotate with AI**. Leafhour saves the highlight, then asks its reading agent for a free explanation using the selected words, their original/translation layer, chapter and book identity. The agent can use the current book's bounded source tools, outline and other AI annotations. It is not required to fill a definition template.

The explanation opens in the available reading margin, beside the paragraph on narrow or parallel layouts, or below the page columns in page mode. Type a follow-up in that card to continue the same thread. Closing the card keeps its content; cancel and delete are separate actions. An uncertain response retains its request identity for retry. A failed local save blocks generation rather than pretending a request can be recovered after reload.

Selecting text, saving a plain highlight, opening a stored annotation, changing typography or changing the interface language does not generate an answer. Signed-in opening reads existing annotations so pre-generated explanations can be found by their **AI** indicators. Initial explanation messages are attributed to the agent, without inventing a reader question. Other threads' private reader follow-ups are not annotation-tool context.

## JSON and external agents

The private archive is `leafhour-reader-annotations`, schema version 1. Self-hosted file storage keeps an atomic wrapper at `users/<owner-digest>/annotations/<book-digest>.json` below the library data directory. Its `archive` is portable content; its `runs` are service authority and must not be edited to inject annotations or restart jobs. Hosted storage uses the same domain representation. Never commit these private runtime files to source.

Full library JSON and ZIP backups carry `readerAnnotations`, separate from editorial `book.annotations` and personal comments. An old backup with no such field remains valid. Restoring annotations does not restart generation; tombstones prevent deleted threads from reappearing. Selected-record exports distinguish **AI annotation** from **Your annotation reply**; turning quotes off also removes text in nested quote/source-reference fields. Gifts do not acquire these private conversations.

Use the [existing scoped MCP setup](mcp-reading.md) to let a coding agent prepare explanations for a book, a chapter or a topic. Explicitly grant only the required book and scopes:

| Scope | Capability |
| --- | --- |
| `content` | Read authorized book/chapter/passage source. |
| `annotations` | Read AI explanations with bounded continuation; excludes reader follow-ups. |
| `highlight:write` | Store an exact-text highlight in the existing web records; no prose or reading progress. |
| `annotation:write` | Store an external AI explanation; does not call Leafhour's model. |

Existing grants and their defaults do not gain these scopes. Grant creation remains the authenticated owner API workflow; the reading room does not yet provide a token-management panel. Keep the token in the host's private environment, never in a book, prompt, URL, source file or command argument.

The official SDK stdio tools are `reader_get_annotations`, `reader_add_highlight` and `reader_add_annotation`; the equivalent HTTPS JSON endpoints are `GET /api/agent/annotations`, `POST /api/agent/highlight` and `POST /api/agent/annotation`. The remote OAuth endpoint also exposes these tools after separately requested and explicitly approved scopes; see [OAuth setup](mcp-oauth.md). Implementation tests do not prove that an actual ChatGPT host has been installed.

An external write accepts exactly:

```json
{
  "bookId": "sample-book",
  "threadId": "stable-thread-id",
  "messageId": "stable-message-id",
  "quote": {
    "kind": "leafhour-reading-quote",
    "schemaVersion": 1,
    "bookId": "sample-book",
    "contentVersion": "actual-source-version",
    "chapterId": "actual-chapter-id",
    "parts": [
      {
        "passageId": "actual-passage-id",
        "layer": "original",
        "start": 0,
        "end": 4,
        "text": "Read"
      }
    ]
  },
  "body": "An explanation written by your own agent."
}
```

This is a synthetic schema example, not an already valid citation. Copy the real version, identities, exact selected substring and UTF-16 offsets from the authorized source. Translation selections use `literal` or `interpretive` and their real `translationStatus`. `highlightId` is optional and must identify the owner's matching highlight. Do not supply owner, origin, provenance, timestamps, runtime fields or another thread's private words. The server fixes external-agent attribution and returns only a narrow receipt.

Reuse the same thread/message IDs and unchanged payload when a response is uncertain. An exact historical receipt still requires a current grant; changed payloads conflict. New writes require the current source and highlight. Read tools return a snapshot and cursor: follow them unchanged for long prose, restarting if the snapshot becomes stale. The quoted stored anchor is bounded context, not a newly verified source citation.

The archive has explicit limits: 100 threads (including tombstones), 20 messages per thread, 12,000 UTF-16 units per message and 1 MiB per archive. Selections have at most 8 parts and 2,000 UTF-16 units. Capacity errors preserve existing words; they do not trim history. Plan a bounded batch instead of assuming unlimited full-book generation.

Revocation and acknowledged source changes fence stalled writes through the same annotation storage transaction. They cannot recall copies already read by an external host. Expiry is checked at authorization time; there is no claimed global transaction spanning all storage documents. Concurrent restore can fail after an earlier resource has been applied; it is not an all-book rollback transaction.
