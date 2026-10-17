# PDF onboarding: one upload to a readable book

The user approved the preceding end-to-end proposal and explicitly requested autonomous implementation and real browser acceptance with the previously supplied PDF. This is an implementation slice of `2026-10-17-book-ingestion-design.md`, preserving its content and ownership requirements.

## User outcome

Choose a PDF once. Leafhour saves it privately, reuses an existing same-account import, otherwise checks each page and extracts readable native text. Only pages requiring recognition go to PaddleOCR after one explicit, contextual consent. Processing continues after the page closes. The user can inspect completed pages while the rest are pending, and enters the reader when full page coverage is verified. A failed provider read does not require another upload or another paid submission.

The acceptance source is the existing 779-page, 143,882,741-byte PDF. Its source and results remain outside Git. Existing completed results are reused; acceptance must disclose cache reuse and cannot describe another paid whole-book OCR run that did not happen. A separate bounded new-source browser test proves unattended processing; no existing book or notes are deleted to manufacture a cold start.

## Scope and limits

- Preserve the current 256 MiB PDF and 1,200-page total resource bounds; TXT/Markdown remain 20 MiB. Enforce one PDF policy across native and recognition paths.
- Native extraction has a bounded 8,000,000 UTF-16-unit text budget. A logical book including translations has a 32 MiB serialized budget. Limits are checked before paid translation work, reserving the maximum legal two-variant output.
- Reuse private compressed document storage. Large reader responses use checked 1 MiB transport parts, so a small function response limit does not become a small book limit. Physical chapter storage migration is outside this slice.
- Legacy imports remain readable and retain all paragraph IDs, content/source hashes, translations and personal records. Duplicate onboarding never reparses or overwrites them.
- Provider page groups remain at most 30 source pages /20 MiB. Only selected OCR pages are submitted, with an explicit original-page map. Large groups split automatically. An oversized individual page fails before submission with the original preserved.
- User files and provider output are data, never instructions. No full-book translation, audiobook pregeneration, public publication or new notification service.

## Durable task

New uploads use `mode: auto`; existing explicit OCR jobs preserve their behavior. An auto job progresses through inspecting, awaiting_consent when necessary, processing, checking and ready. Native text and OCR results have page coverage and stable persisted identities. A preview is read-only task content, explicitly incomplete, and does not write reading progress or notes. No partial book is marked complete.

An account-scoped source lookup precedes chunk upload. A previously completed job returns its book directly, including after the temporary upload URL expires. Unknown source hashes reveal nothing outside the authenticated account.

A persisted bounded ingestion queue advances authorized jobs independently of the browser. The existing hosting background lifetime runs bounded slices; authenticated internal wakes continue them, with an idle-aware Supabase Cron wake as recovery. The internal credential is purpose-derived from an existing server secret, stored only in Vault for the database wake; no new user-facing environment variable. Local execution uses the same runner and an unref'd timer. Failed or uncertain paid submissions never silently resubmit; saved remote IDs are reconciled. Cancellation fences both queued work and publication.

## Interface

The upload panel keeps one primary action, `放进我的书房`. Remove the always-visible OCR checkbox and provider-selection decision. When recognition is required, show a single consent panel with affected-page count and the actual recipient, then `允许识别并继续`; explain service usage and retained originals. Existing consent receipts remain effective for the same job and source.

Progress appears on the bookshelf, not only inside the upload modal. Show real uploaded bytes and completed/total source pages; expose preview, explicit retry for confirmed failures, cancel, and open-book actions only when meaningful. Refresh reads the same job. Closing the page does not pause authorized processing. Routine transient status retrieval errors recover with bounded backoff without losing a task ID.

Use embedded PDF bookmarks when reliable; otherwise use observed heading blocks where unambiguous. Preserve explicit `阅读片段` labels for automatic grouping, never fabricate a chapter structure. Existing books are not restructured by duplicate upload.

## Acceptance

1. Real browser selects the original PDF, authenticates in the designated account as needed, and reaches the existing complete book with no manual OCR choice, chunk management or redundant provider submission.
2. Verify all779 source pages accounted for, first/middle/last-page reading, original byte count/SHA-256, stable1,960 paragraph identities and unchanged personal records.
3. A bounded fresh private PDF proves native/scan routing, contextual consent, tab closure followed by backend progress, refresh recovery, complete publication and first-page reading. Disclose the number of newly recognized pages and actual paid calls.
4. Isolated tests cover mixed-page mapping, no missing pages, queue restart/concurrency/cancel, unknown submission reconciliation, duplicate owner isolation, large-book translation, multipart reader integrity and clear pre-upload limits.
5. Required release checks and independent review pass. Commit/push/PR/merge follow AGENTS.md; verify the actual deployed source and repeat production browser onboarding before claiming completion.
