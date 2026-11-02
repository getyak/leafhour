# Reading conversation scope

Updated 2026-11-02 for direct conversation submission and model-sized context. This contract supersedes the earlier six-turn/24 KiB conversational-history projection and 2,000-character ordinary-message limit. Translation preparation and automatic companion generation retain their own explicit scope and trigger policies.

## Submission and access

Sending an ordinary message submits it directly. There is no second generation confirmation. A paid conversation still validates the current authenticated owner, price and quote scope before submission, and retains actual provider/billing accounting. An uncertain retry reuses the exact request ID, body and billing identity; it does not create another question or obtain a new quote. A definite scope rejection preserves the draft and requires a fresh send after the current scope is loaded.

Book chat defaults to the current book. Its tools can page through permitted original text, literal/interpretive translations, contents and other chapters; they do not implicitly search the entire personal library. Saving the wider library/public-catalog/network scope enables those additional read tools for the current owner. Account Chat starts without a book or reading location and can answer directly; it does not infer that the first shelf book is the current source. Private notes are not automatically included, and ordinary account chat does not write progress, preferences or people records. External MCP permissions remain separate.

The user's question, the book and chapter/passage location when present, permitted completed conversation history, and text/search terms retrieved through tools may reach the instance-configured model. The app does not preload an entire book or library. Model keys remain on the instance; scope selection does not change the provider. Deployers own their provider configuration and data policy.

Book scope is saved per owner and book. Changing it does not call the model. A stale `scopeRevision` is rejected before a new question, credit reservation or model request is recorded. A larger scope is never adopted silently for an old request. Narrowing scope retains the original messages and sources, while wider-scope or unverified-scope history is excluded from new book-only model context, including after that history moves to archival receipts. Missing or damaged scope data cannot authorize broader access.

## Context, storage and timeouts

Ordinary conversation does not impose a product turn-count, daily-message, small token, tool-call or ordinary-message character budget. The runtime uses the configured model's known published capacity and rejects an unknown capacity rather than borrowing a different model's settings. Older model context is summarized only when it must fit the available model window; original messages are retained. Compaction failure must fail the request without silently deleting history. Provider usage continues to be metered.

The active chat document is paged by storage size/count. Terminal messages move to owner- and conversation-bound immutable receipts before leaving that active document; archive receipt identity includes book-versus-account conversation scope. Archival does not remove messages from exports or make them ineligible for authorized model context. A storage page size, tool-result page size or HTTP request limit is not a model context-window setting. Hosting deadlines and cancellation still terminate a run and retain its recoverable request identity; the hosted runtime reserves time for cleanup and receipts.

The short main instruction identifies 松鼠 as Leafhour's conversational assistant. Environment and available tools are supplied separately. Tool handlers and shared domain services continue to enforce owner/source access and exact source citation matching; a model instruction cannot grant itself access.

## Sources, voice and export

User messages and assistant replies remain distinct. A source citation is accepted only if the tool read it during the current run, its exact quote matches, and its source version is still current at completion. Explanations remain model output for the reader to assess; citations link back to original passages.

Recording while composing produces live text. Cancelling recording restores the previous draft and does not upload the cancelled audio. Sending retains the original recording and transcript as a voice message; owner-scoped upload parts and final content hashes must verify before a voice receipt can be attached. Playback retrieval and backup restoration validate the authenticated owner and receipt. Clients that send only text remain compatible.

Conversation export retains original user and assistant text, source versions and verified references, including archived history. Voice-aware backups include verified recordings when present. Exports do not include model keys, access tokens or a complete unrelated library. They remain separate from a full account backup; see [reading and data retention](reading-journey.md). Successful real-instance migration requires a restore check, not just an exported file.

## Implementation and evidence

Old chat schemaVersion 1 records remain readable without a database migration. Scope updates use the existing file-lock or hosted compare-and-swap path. Older malformed records fail safely instead of broadening access. Current implementation and verification are recorded in [the 2026-11-02 library/chat record](verification/2026-11-02-ios-library-chat.md). Deterministic adapters, synthetic answers and simulator screenshots do not establish real model quality, microphone hardware behavior, TestFlight availability or production acceptance.
