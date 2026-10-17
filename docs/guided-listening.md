# Guided listening

The chapter's existing listening entry offers a short opening guide, exact narration from the current paragraph, and a two-person explanation. Book orientation is in the same listening panel. The player keeps source navigation, transcripts, speed and voices in its expanded controls. "Ask here" pauses and opens a source-linked draft in the existing reading conversation; it never sends a question or starts another paid operation automatically. An existing personal draft is preserved.

Chapter narration prepares at most ten actual audio clips per confirmation, showing the source and estimate before synthesis. "Prepare the next part" resumes at the exact ending character, including inside a long paragraph; it does not generate the rest of a long chapter automatically. Source paragraphs and translation availability are never silently skipped.

## Source and generation contract

Introductions read up to three complete opening paragraphs and at most 6,000 characters. Explanation defaults to the current chapter through the explicitly captured paragraph; whole-chapter scope is a separate visible choice. Chapter explanations and full-book orientation read every selected original paragraph through the same automatic batching pipeline, within 6,000 paragraphs/900,000 characters and 64 reading batches of up to 48 paragraphs/18,000 characters. A single longer paragraph stays complete in its own request of up to 24,000 characters. There is no separate 200-paragraph/30,000-character chapter cutoff. The interface shows the complete selected scope and reading progress; users do not divide long chapters themselves. A paragraph that cannot fit a batch is rejected before any paid call. No silent truncation or private-note retrieval occurs.

Each guide runs original reading/outline, script, supporting-claim verification, and publication as persisted stages. Outlines must enumerate their actual input IDs. Reading outlines and published scripts share the same 500-character citation ceiling, with short excerpts preferred; longer complete English evidence is never truncated to fit the former 180-character outline cutoff. All published source quotes are exact matches. The text adapter can restore whitespace and the first Latin letter’s case only when they map uniquely to the same supplied source; it never repairs altered words or guesses another passage. A verbose redundant batch overview can use its first complete claim instead, while all claims and their evidence remain intact. Verification checks each explanatory turn against the complete referenced paragraphs in requests of up to 100,000 characters (separate from the smaller reading batches); this is an additional model check, not a guarantee of truth. A failing check preserves the transcript for inspection without publishing it as verified audio. Opening/book guides instruct the model to avoid plot revelations; the scope boundary is enforced, while spoiler avoidance within full-book writing remains a quality criterion to review.

Targets are short: introduction 30–90 seconds and at most 300 Chinese characters; explanation up to 5 minutes/1,200 characters; book orientation up to 3 minutes/900 characters. Short sources produce shorter guides. Those are writing budgets and approximate durations, not fixed spoken timing.

## Speech and recovery

DeepSeek writes and verifies the script. Google official Gemini performs it using the same `DEEPSEEK_API_KEY` and `GEMINI_API_KEY` configuration as the rest of the app. Guided scene version 3 groups up to 160 UTF-16 units of speaker/style/source-preserving turns into a native single- or two-speaker request. Source links are per scene; there are no fabricated word timestamps. Exact narration and legacy sessions keep their existing chunking contracts. MP3 v1, WAV v2 and guided v3 backups remain recoverable, with owner-specific cache identities.

The browser retains job identity across refresh. Uncertain creation requests retry the same idempotency key. Stopping an uncertain request writes an owner/book-scoped cancellation receipt so a late creation cannot start paid work. Restoring a saved job never autoplays. A transient retrieval error offers reload; interrupted paid work requires an explicit new preparation. Keys and login sessions never enter exports.

Failed or interrupted candidate scripts remain discoverable as read-only, unverified history. Backups include canonical terminal candidates without leases, quotas or runnable tasks; restoring them never resumes paid work. Successful guides remain editable versioned dialogues. The legacy local-only dialogue generator stays disabled on hosted instances so it cannot bypass durable guide budgets.

## Hosted operation

Hosted metadata uses the existing Supabase document CAS; clips use the existing private blob store. Vercel `waitUntil` attaches bounded background work to the request lifetime. Audio slices finish within an 80-second budget; later authenticated status requests resume known unsubmitted work. Guide jobs similarly advance one bounded provider stage per request. These are resumable request-driven workers, not an always-running cron service. An expired in-flight provider lease is interrupted, never blindly reissued, because billing could already have occurred. Reopen the saved job to continue pending stages after leaving the page.

Hosted budgets are enforced before calls and fail closed. Speech: 20 requests/hour and 100/day per account, 100/hour and 500/day globally. Guide text: reserve the whole disclosed job budget, up to 100 calls/account/hour and day, 200/day globally. Stages consume that reservation exactly once. Cancellation conservatively leaves the reservation counted until expiry. Cache hits do not regenerate audio. External MCP read-only status cannot resume paid work; generation requires the original matching authority and a fresh permission check.

Set `GEMINI_API_KEY` as an encrypted deployment environment variable and redeploy to enable hosted speech. The existing Supabase server credentials remain server-only. The private storage bucket is not made public. Mobile lock-screen reliability must be tested on a real device; desktop playback/Media Session checks do not establish it.

## Preparing review artifacts

Verify the target account's current Supabase Auth ID first. Preparation is a dry run by default:

```sh
node tools/prepare-listening-guide.mjs --book gutenberg-on-liberty --owner-id YOUR_AUTH_USER_ID
```

Add `--generate` only to initiate paid generation, and `--include-audio` to include cached sound in the review backup. `--intent book` requests a complete-book guide. `--intent explain --chapter CHAPTER_ID --through PASSAGE_ID` scopes explanation explicitly. Artifacts are stored under that account's local resource directory and are not automatically published. Existing backup tools can restore them. Public shared audio requires separate source/editorial review; this release does not publish personal artifacts or pregenerate entire audiobooks.

Official references: [Gemini speech](https://ai.google.dev/gemini-api/docs/speech-generation), [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [Vercel background lifetime](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package#waituntil).
