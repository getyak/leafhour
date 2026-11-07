# Narration integration boundary

The multi-voice modules are internal experiments. There are no supported `/audio/narration/*` HTTP endpoints in this release. Do not post client-supplied segments or voice bibles to a generation endpoint, and do not return a blob by its cache key without checking an owner/book scoped record.

See [the reviewed status and integration requirements](multi-voice-audiobook-narration.md). Native iOS continues to use Apple system speech. Existing web audio continues to use the current audio service and its configured Gemini provider.

Before adding UI, extend the existing audio session workflow with server-owned preparation, bounded source selection, explicit external-processing consent, quota reservations, cancellation, idempotency, durable records and authorized clip access. Preserve source versions, real offsets, MIME types and checksums. Verify cross-account denial, source changes, duplicate submissions, cancellation before/after provider submission, and uncertain results before enabling any provider.

Keys belong only in ignored `.env` files, a keychain or deployment secret storage. Never bundle a provider key into the iOS app or browser JavaScript. Notion credential storage is a separate user-authorized operation and is not part of the public source or audio backup.
