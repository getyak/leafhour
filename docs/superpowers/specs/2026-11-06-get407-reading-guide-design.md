# GET-407 Reading guide in the companion

The reader stays unobstructed. Opening the existing companion shows the saved AI guide in the same marginal note surface, alongside the existing conversation and composer. iOS retains its half sheet. Web uses its current anchored conversation. The legacy tools entry routes to this same surface.

Prepare once on a signed-in book opening. Store ownership by account, source kind, book ID, content version and locale; returning and concurrent clients read that state. A durable attempt survives disconnects and process restarts. Expired work becomes unknown and never automatically replays. Known preflight or completed-format failures allow an explicit retry; provider transport failures remain unknown. Existing completed guides stay valid.

Use the current provider and sponsored budget (one request, no tools, 1,000 output tokens, CNY 0.1). Supply only bounded opening originals and bibliographic metadata. Ask for a friendly, source-grounded story about context useful before reading, no plot, ending or twist, no invented background. No new browsing or paid workflow.

Alternatives considered: moving the old banner alone leaves replay and billing risks; opening generic Chat breaks the requested reading experience. Integrating with the current marginal note plus durable state addresses both.

Validation covers account/book/version isolation, concurrent and cold opens, disconnect/timeout, read-only recovery, explicit retry, offline caches, composer drafts and reading anchors. UI evidence is kept separate from provider and device acceptance.
