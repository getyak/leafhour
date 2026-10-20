# Book upload and chapter reading

The user authorized implementation, real before/after checks with the same book, review, PR, merge and production verification on 2026-10-20. Their latest direction prioritizes true chapter reads and less original-file transfer, with quiet asynchronous upload inside the existing chat. This document records that approved scope and routine implementation decisions.

## User experience

The library and reader chat accept PDF, EPUB, TXT and Markdown through an accessible attachment control and file drop. Selecting a file immediately shows one stable book task card. Its stages are receiving, organizing, ready, interrupted and cancelled. Updates change that card in place and do not generate model messages, steal focus, change the current reading position or erase a draft. A completed card offers reading and continuing a conversation about that book. Empty libraries can upload before a first book exists. Existing upload entry points share the same operation and do not start duplicate tasks.

The user explicitly rejected a scan-page/count/quota presentation step. Keep those details internal. External recognition still requires the existing source-bound authorization, expressed as one short action on the task card; no counts, quota explanation, extra dialog or default external submission. Keep the original file private and account-bound.

## Upload and ingestion

Preserve source hash verification, duplicate reuse, incomplete-part rejection, resumability, cancellation fences and local operation. Hosted uploads send binary parts directly to private storage using scoped signed targets where configured; existing local/fallback clients remain supported. The browser upload adapter continues to expose uploadPdf({file,api,onProgress,assertCurrent}). Its hosted implementation must not put encoded source bytes into application JSON requests.

Publication adopts the already verified source reference instead of reading and uploading an additional original copy. Library import APIs retain byte-based compatibility for callers without a verified reference. A reference cannot select another account's source. Before external recognition, inspect every batch and reserve only the actual pages requiring recognition; protect reservation against retries and concurrent requests.

## Chapter reads

Add a library-owned chapter read store, using the existing local/durable store abstraction. Persist the manifest and independently retrievable chapter content when a book is imported/restored/revised. Keep the existing full-book API for export, agents and compatibility. Reading endpoints call library.readingView(user,id,selection) and library.readingChapter(user,id,chapterId,contentVersion), not getBook followed by slicing.

The manifest retains book metadata, directory, stable paragraph identity stubs and source version. Chapter reads load only the selected chapter plus its applicable personal translations. Keep source and translations current after generation, restore, gifts and revisions. Old books can build a projection once under a guarded cache migration; subsequent fresh-service chapter reads must not fetch the full book or full translation overlay. Enforce owner isolation and stale-version rejection, and preserve original IDs, source text and existing records.

## Evidence and delivery

Before product edits, capture a real browser baseline and a repeatable real-book storage/HTTP baseline on the base commit. Use the same private source bytes and account identity after the change. Persistent real-book and acceptance data belong to test@cubxxw.com's current Supabase identity; keep raw content and private identifiers outside the public repository. Use isolated synthetic identities only in automated tests. Record stage durations, transferred bytes, whole-source reads/writes and backend full-book versus chapter bytes, without claiming laboratory counts are production latency.

Exercise desktop/mobile upload from chat, upload with an existing draft, no-book state, cancellation/retry, refresh and chapter navigation. Use necessary regression tests plus the repository release gate, independent review, current-head GitHub CI, normal merge and Production-only release verification. No preview deployment or whole-book retranslation.
