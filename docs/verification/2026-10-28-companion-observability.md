# Companion failure diagnostics verification

This record describes the pre-delivery implementation checks. Hosted CI, deployed
source and vendor receipt are separate gates recorded in the pull request.

## Failure and change

The companion domain persisted `failed` and returned HTTP 200, bypassing the
ordinary request-failure observer. Its new optional callback emits only fixed
operational metadata after persistence. Portal supplies the trusted operation ID;
the random run receipt supplies deduplication without a private book/turn key.
The existing observability service retains consent, QA exclusion, HMAC identity,
rate limits, independent receivers and default-off self-hosting.

`companion_failed` and stage `companion` are reserved for server callers. Both
fault insights include the same fault event set. No recorder, SDK in the browser,
raw exception, reading content, passage/book ID, notes or provider URL is added.

## Local checks and independent review

- Initial seven regressions: three failed on the original implementation.
- Companion and existing observability focused suite: 93 passed.
- Actual isolated HTTP 200 failure, trusted operation correlation, consent-off,
  forged server event, stable receipt and private-sentinel transport checks ran
  without a model or external provider.
- Independent review found two additional cases: provider rejection after request
  authorization was revoked, and a browser claiming the reserved stage under a
  generic client-error name. Both were reproduced (11 tests, two failures) before
  the fix; the final 11-test integration set passed and scoped re-review cleared
  both findings. A failed authorization recheck cancels/suppresses the outcome;
  every browser event with the reserved stage is refused.
- The first complete local run reported 3,965 passed, two failures and one skip.
  The failures were an audio-test cleanup `ENOTEMPTY` and a hosted-PDF subprocess
  timeout, outside the changed source paths. Those 17 affected tests then passed
  unchanged. A fresh complete run remains required before landing.

The tests use temporary stores and synthetic content. No production model fault
was deliberately triggered, no personal books were accessed, and the existing
untracked verification output was preserved.

## Limits

This is best-effort diagnostics, not a durable accounting queue. A process killed
before it can save an outcome is not reconstructed. Actual vendor proof must
identify where the synthetic fixture executed; a local fixture is never described
as a production-hosted generation failure. Full account/device reading acceptance
and private content remain outside this operational change.
