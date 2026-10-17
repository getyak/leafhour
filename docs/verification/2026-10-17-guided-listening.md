# Guided listening verification — 2026-10-17

## Real provider sample

A bounded On Liberty chapter-introduction job used its first three complete opening paragraphs. DeepSeek generated the outline and six-turn script, and completed the supporting-claim check. The published transcript passed exact source-reference checks. Official `gemini-3.8-flash-tts` produced two native scenes with guide and questioner voices. The guide was ready in 10,075 ms and both audio scenes in 43,356 ms total. The files decode as 24 kHz, mono, signed 16-bit WAV, with durations 30.56 and 11.68 seconds. This proves one real short sample, not voice quality or latency across all books.

Receipts and audio remain private resources in the designated verification account. No credentials or personal runtime records are included in this document or the release.

## Browser acceptance

The actual local reader, with an isolated deterministic speech/guide fixture, passed chapter entry → sign-in return → explicit scope confirmation → guide → playback. "Ask here" paused the sound and opened a source-linked draft without sending it. "View source" displayed actual original text and jumped only after selection. Refresh restored a paused player; it did not autoplay. The 390 × 844 layout showed all three choices and secondary actions, and keyboard Tab/Escape worked. No page console errors were observed.

Long-chapter narration was also tested: On Liberty prepared ten actual clips instead of rejecting the entire chapter. At the end, "Prepare the next part" opened the next exact source range and a fresh estimate without generating more sound. The fixture's one-second audio proves playback and transitions, not real provider prosody.

## Coverage and limitations

Dry-run complete-book scope checks covered all 136 paragraphs/5 chapters of On Liberty, 817/13 of Alice and 585/20 of Walden; their sources used 17, 18 and 38 bounded batches. No full-book model or audiobook generation was performed.

Regression coverage includes shared CAS deduplication, owner isolation, expired in-flight interruption, conservative quota reservations, cancellation before and after provider submission, source conservation across narration batches, source verification, candidate history, and old/new backup recovery. Independent review findings were reproduced and corrected before delivery.

The repository deployment gate and production acceptance are separate release steps. Real phone lock-screen/background playback, editorial review of full-book overviews, voice cloning and shared public prebuilt audio are outside the evidence above.

## Hosted persistence correction

The first production generation stopped at its budget stage before any model call: PostgreSQL JSONB had reordered object fields, and the original source guard compared order-sensitive object hashes. The correction compares JSON values structurally while retaining array/source order and legacy audio/cache hashes. Hosted-store fixtures now reorder objects at every CAS write, matching this storage behavior. Additional checks cover persisted dialogue sources, same-key request replay and native-scene backup validation. The original failed receipt remains in the designated account for diagnosis; it is not silently resubmitted.
