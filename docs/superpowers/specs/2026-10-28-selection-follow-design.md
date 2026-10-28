# Follow the selected passage in the reading conversation

The user requested that selecting a passage switch the quotation attached to the question being composed. The unsent question must stay intact. This extends the previously delivered source-return behavior.

While the reading conversation is open, an explicit passage or text-range selection replaces only the composer quotation. It keeps focus on the source and leaves passage tools available. It never opens a closed conversation, sends a question, changes the reading scope or edits historical quotations. Opening the conversation captures an active selection before the workspace dismisses passage tools.

The reader publishes its selection notification before assigning the final range snapshot. The conversation adapter therefore waits one microtask and reads the final visible, typed excerpt. Existing source-layer, book/version and quote-length validation still applies.

The shared chat owner receives a separate `followQuote` operation. Explicit quotation keeps its existing open/focus behavior. Automatic following preserves the draft and focus. While a request or uncertain recovery is locked, only the latest candidate is retained in memory; the submitted payload remains immutable. Once editable, the quotation and passage-context GET move together. Close, native close, account/book changes, removal, reset and disposal discard queued candidates. Owner, book, current quote and passage checks reject stale deferred work.

Acceptance: open-chat paragraph switching and final-range capture, draft/focus preservation, immutable history and submitted requests, latest-only deferred selection, no automatic POST, closed/disposed isolation, native closure, and narrow-layout reopening. Use synthetic local identities and existing public text; no real-account writes or model generation.
