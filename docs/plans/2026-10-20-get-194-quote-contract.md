# GET-194 Batch B — selected text as attributed conversation data

Design contract, not implementation or acceptance. Continue after [Batch A](2026-10-20-get-194-reading-workspace.md); one final GET-194 PR must deliver both. No product model calls are needed to verify this contract.

## Selection and representation

The existing `captureDOMSelection` / reader `getExcerpt()` snapshot is the input. Its historical `language=en` denotes the **original layer**, not a guarantee that a book is English. Convert it to a new pure shared `app/reading-chat-quote.mjs` contract, without importing share rendering, UI runtime, Node APIs or the whole book into a request.

Optional `quote` on a user chat turn/request:

```json
{
  "kind": "leafhour-reading-quote",
  "schemaVersion": 1,
  "bookId": "book-id",
  "contentVersion": "source-version",
  "chapterId": "chapter-id",
  "parts": [
    {
      "passageId": "p1",
      "layer": "literal",
      "start": 4,
      "end": 12,
      "text": "exact selected text",
      "translationStatus": "draft"
    }
  ]
}
```

The example shows field structure only; production offsets must actually match the selected UTF-16 slice. `layer` is original/literal/interpretive. An original part has no translationStatus; a translation part records the actual bounded status from that account's book. Reject malformed Unicode, split surrogate boundaries, extra/unrecognized fields, missing/empty values and prototype surprises. IDs and versions use the existing book/passages size constraints, parts are 1–8 unique ordered passages in one chapter and one layer, selected text totals at most 2,000 UTF-16 units; `end-start` must equal `text.length`. Offsets are bounded nonnegative safe integers, never arbitrary huge allocation requests. The user's question remains a separate nonempty string of at most 2,000 characters.

Expose separate pure operations for bounded structural normalization, validating a **current** quote against an actual book, and validating a **historical** snapshot against a book's identity/known passage anchors. Current validation compares book/version/chapter, exact slice/order/layer and actual translation status. It must reject a client pretending a draft is reviewed. Historical validation retains bounded recorded text/status/offsets even when the current translation differs; it cannot certify past source text. `server/library-service.mjs` overlays account translations at the same original contentVersion, so one validation mode cannot safely serve both purposes.

## User flow and state

Add a visible Quote to AI control to the existing selection toolbar. It uses the captured snapshot, never arbitrary textarea text or hidden passages. A passage selection can quote its actual visible whole paragraph, subject to the same limit. Capture/validate before closing selection/notes or opening AI. A clear localized status explains missing, changed, too-long or unavailable selection; do not silently truncate or submit anything.

Open the same physical conversation on the selected first passage and show a compact removable quote above the input, with original/literal/interpretive and recorded draft status. Keep the existing question text. Adding another explicit quote replaces only the previous quote. The UI never invents a question or sends on open. A pending run, uncertain retry or scope change refuses quote replacement/removal/context switching until the existing operation is resolved. No book/scope widening occurs. Closing and reopening preserves both question and quote. Locale changes relabel chrome while retaining exact quote bytes and physical input/IME/focus.

Keep the legacy string draft key compatible. Add an owner/book-scoped quote draft head envelope with a unique revision and explicit null tombstone, plus state adapters. In-memory use continues on storage failure. Every explicit quote replacement/removal creates a fresh revision. Completion acknowledges only the submitted revision in a separate owner/book/revision key; it must not remove or overwrite a newer head. A revision read followed by writing/deleting the head is not cross-tab CAS. Acknowledgements are small and bounded by the existing per-book turn limit; do not accumulate full quote snapshots per keystroke. On account/book changes, reset in-memory quote and load only that identity's bounded saved snapshot. A quote from an older contentVersion stays visible with a localized stale notice and blocks a new send until removed/reselected; it must not be silently dropped or sent against a different context. Returned GET data confirms first-passage context and current contentVersion before canSend. Quote-only submission is not supported: the reader supplies a question.

Extend pending/retry records and `payloadFor` with the exact optional quote, and freeze the quote-draft revision in the local pending envelope. Recover the original request ID and original quote, do not mint a new ID for an uncertain network result. Compare quote as well as question, passage, version and scope revision on POST, GET-recovery and cancel receipts before a tracked terminal response mutates drafts. A completed receipt acknowledges only the submitted quote revision. Retain the existing best-effort string-question clear guard; do not claim an atomic cross-tab transaction for the legacy draft system. Failed/cancelled runs restore the original quote only if no newer revision/tombstone exists; changing a resolved failed question/quote creates a fresh ID under existing semantics. Stop/account fences reject late responses. Treat malformed saved quote/pending payload as unusable, not authority to send. Test a second-tab head write between a cleanup read and acknowledgement: cleanup may mark its own submitted revision only.

The head is written only by explicit quote selection/replacement/removal, never automatically by a failed/cancelled terminal response. Read an ACK as empty only when its revision equals the current head. ACK keys/values have bounded syntax and owner/book scope. If old ACKs are reclaimed, never remove one still referenced by head or pending recovery. An in-memory-only fallback does not claim durability across reload or atomicity across tabs.

## Server and model boundary

Parse bounded quote data before any model operation. In the existing atomic turn claim, compare the complete optional quote for an existing ID. Missing quote and a quote are different requests. An exact terminal retry returns the existing receipt even if that account's translation has since changed; do not revalidate an already stored historical quote as if it were a new request. A different quote on the same ID returns 409. New requests validate against the actual authenticated book before storing a turn, recording a question or reserving quota. Require `input.passageId` to be the first quote part. Errors cannot start a paid run or pause unrelated work prematurely.

Store/return the optional quote with the user turn, independently from `text` (user's own words) and `answer` (AI). Personal question records keep the user's own question text; the linked chat turn and book chat archive retain its quotation. Preserve existing no-quote behavior and existing scope authorization. Do not count quoted data as a verified AI source or an additional grant.

Pass the typed quote to the actual `harness/chat-generator.mjs` input payload as attributed selected data, separate from the question and tools. All source/quote/history text remains untrusted data; the system instruction explains it cannot alter rules and that AI source references still require the existing `reader_cite` tool and source verification. History includes each prior selected snapshot together with its own question, under the existing last-six-pairs and 24KiB whole-input limit; trim complete oldest pairs, never only the current quote/question. Factor a small pure input encoder shared by server preflight and harness, preserving legacy no-quote formatting and custom companion/introduction labels. The current question/quote/location metadata alone can exceed 24KiB after JSON escaping despite character limits: reject that before a new turn claim/quota/provider work, including large-title/control-character cases. Do not rely only on history removal or a late harness failure. No extra model, private notes, later paragraphs or eager book fetches.

Before saving a new answer, revalidate every currently quoted part against the fresh authenticated book, including translations/status. A changed selection fails truthfully while preserving the reader's question/quote. Existing tools still independently verify model citations; selected text alone never populates answer.sourceRefs.

## History and portability

Render the user's quote and question separately in chat history, using text nodes rather than HTML. Label snapshots as selected text; current text may differ. Do not claim imported or historical quotations were re-verified against the current translation. Do not rerender source/history text when switching interface language.

`publicTurn`, conversation export, portable archive import/export and conflict comparison retain the complete bounded quote. An archive's historical selected text must have valid book/version/known passage ownership and structure; a changed translation must not introduce a new failure from this user quote field. Distinguish no quote versus quote during restore conflict detection; never overwrite an existing turn with a same-ID/different-quote archive. Existing strict AI citation validation remains unchanged: a historical **AI answer.sourceRefs** translation that no longer matches can already make that archive fail. Do not claim this batch repairs all such existing AI provenance conflicts or relax their validation. Legacy records without quotes continue to round trip.

## Required evidence

Tests cover original, both translation variants and missing translations; wrong owner/book/chapter/version/order/layer/status/text/Unicode/oversize; no provider/quota work on invalid quote; exact and conflicting retries; changed translation during generation; unchanged question/quote after failure, cancellation and reload; other-tab draft preservation; malformed storage and cross-account fences; actual generator payload/history size and attribution; historical edited-translation export/import and conflicts. Deterministic generator fixtures only, no paid service.

Native compiled-UI checks use real pointer/keyboard text selection and actual Quote to AI clicks, verify exact selected source text and draft retention, and inspect desktop/mobile paper/night screenshots. No injected DOM selection or hidden source rewriting to stage success. Independent review closes all P0/P1 before final current-head CI, merge and exact Production acceptance. Report untested real-account/model/physical keyboard or assistive-technology limits accurately.
