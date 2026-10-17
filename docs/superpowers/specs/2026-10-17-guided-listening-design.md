# Guided listening

Approved in conversation on 2026-10-17. The user asked to implement the reviewed design, including delivery. This document records that scope; implementation proceeds without a repeated permission gate.

## Experience

Keep the quiet paper and forest-green reader. Reuse the chapter listen entry and single compact player. Offer chapter introduction, exact source narration, and source-grounded explanation. Put book orientation in the book menu, not on every shelf card. Defaults follow the existing source language and Chinese assistance; voices remain in settings.

An introduction uses only opening material and no later plot. Explanation defaults to the current chapter through the current passage; an explicit scope change permits the whole chapter. Book orientation reads the selected book in bounded batches, records coverage, and never calls partial reading a full-book overview. No personal notes or unrelated books enter a generation.

One action may prepare a guide and synthesize it after clear scope/cost disclosure. A transcript remains inspectable/editable without a mandatory editing step. Paid work starts only from an explicit action. Preserve generated text on synthesis failure, cache completed audio, provide cancellation, and never automatically retry an ambiguous paid request.

## Content and audio

Existing DeepSeek generates/verifies scripts; official Gemini 3.8 Flash TTS performs them. Use stable prebuilt guide/questioner voices and short delivery metadata. Native two-speaker scenes contain bounded groups of turns. Exact narration never rewrites original text. Original excerpts, explanations and illustrative examples remain distinguishable. References must be exact source matches; a model verification pass checks whether important explanatory claims are supported.

Chunk audio by complete ideas. Source mapping is per scene, not an invented word-level timestamp. For explanation, source navigation is deliberate; it never forces reading-page movement. "Ask here" pauses, captures the scene and actual references, and opens the existing reading conversation with a bounded draft. Returning is an explicit continue action. Listening never marks a chapter understood or advances text progress.

## Persistence and access

Hosted audio uses the existing Supabase private document store/CAS and private blob storage, never a serverless local filesystem. Background promises are attached to the request lifetime. Leased tasks resume only work that has not been submitted to a provider; expired in-flight work becomes interrupted and requires explicit retry. Limits apply before paid calls. Authenticated callers may process only their own sessions and accessible source books. Cross-process duplicate requests share one persisted operation.

Maintain unversioned/v1 MP3 and v2 WAV sessions and backups. New scene sessions are separately versioned. Persist voice/style/text/version/source hashes in cache identities. No API key or auth session belongs in exports.

## Scope and verification

Implement general chapter/book tools and validate representative philosophy, fiction and essays using On Liberty, Alice and Walden. Real model checks are bounded to short samples; do not silently generate entire audiobooks. Public pre-generation and editorial review use explicit tooling and an exportable artifact; personal uploads remain private. Voice cloning and a library of custom voices are later features, as already stated in the approved design.

Required evidence: failing-then-passing tests for scopes, source validation, duplicate/cancel recovery, native scenes, backups and account isolation; full repository verification; desktop/mobile browser interaction including ask/resume; a bounded real official Gemini sample; CI, PR review, merge, exact production commit and live basic-flow checks. Phone lock-screen behavior requires an actual device test and cannot be claimed from a desktop browser.
