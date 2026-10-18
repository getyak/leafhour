# GET-164 sentence selection verification

The earlier production request on f6e01b1 returned the correctly labelled `original-excerpt` fallback. Its raw provider response was unavailable, so this record does not claim a proven failure cause. A historical pre-guard response had selected a bare name; that remains a failed quality receipt.

The built-in provider now chooses a request-local sentence ID. The server computes original text, Unicode offsets and book/chapter/passage/version identity. At most three structurally complete sentences per passage and 24 overall enter the existing eight-passage pool. The original full-book and submitted-pool checks still gate every AI selection. Legacy stored receipts and injected service generators retain their contracts. Model, request count, timeout, response-byte and output-token ceilings did not increase.

Observed local checks:

- Four new regressions failed before the change: ID-only selection was rejected, an ineligible source still caused a provider call, and fallback diagnostics were absent. They pass after the change.
- All 56 focused quotation/composition/gift tests pass. New cases cover a later Unicode sentence, repeated occurrences, candidate limits, bare-name exclusion, no eligible source, strict/unknown IDs, clipped sentence attribution and failure containment. Existing receipt ownership/version/expiry, explicit sealing, response streams and success-only cache tests remain passing.
- Only whitelisted fallback categories reach hosted diagnostic logging. Source text, provider bodies, exception text, keys, account/book IDs and receipts are excluded. A synchronous throw or asynchronous rejection from the diagnostic callback cannot replace the source fallback.
- The actual local public Alice catalog pool produced complete source candidates, each accepted by the unchanged full-book sentence validation and none equal to a bare name. This used a deterministic local selector and zero real provider calls.

Independent review, final complete deployment verification, current-head CI, normal merge and exact-source production acceptance are recorded separately. No production gift, real recipient or real provider call was made to obtain these local results. Real AI selection must succeed on the deployed commit before GET-164 can close; a fallback is still a fallback.
