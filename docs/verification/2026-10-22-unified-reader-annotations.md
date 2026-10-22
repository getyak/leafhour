# Unified reader annotations

The selection toolbar now opens one annotation card. Saved selections, personal
thoughts and explicit AI explanations share that card. Existing records and
their authorship remain distinct. Opening, hiding and reading annotations do
not request generation.

On wide pages, nearby summaries occupy available margins around the centered
text. Narrow pages use a compact indicator and a bottom sheet. Visibility is
remembered per account, book and source version. Initial loading is quiet, and
module failures offer a reload action.

The final independent review found no remaining blockers after corrections for
long saved selections, unavailable browser storage, completed AI draft cleanup
and the initial module error state. Personal notes retain the 4,000-character
selection contract; AI requests retain the smaller 2,000-character contract.
Unconfirmed note saves keep their original request ID and preserve newer drafts.

## Local verification

- Four targeted suites: 28 passed, 0 failed. They include actual raw server asset
  routes, the real reader asset boundary, margin geometry and annotation UI
  receipt/owner/draft behavior.
- The long-selection regression was observed failing before the correction.
- The pinned Vale and textlint run before the final long-selection label passed
  with zero new T1 errors and no new exceptions. The final catalogue export was
  regenerated; its repeat lint is tracked by the PR CI gate.
- Full local tests were attempted, but did not produce a final TAP summary.
- The native macOS DSH runtime check timed out during initialization. The Linux
  runtime/package checks remain part of the required CI gate.

## Browser acceptance

The local Chrome connection was attempted. A reading tab began navigation, but
the native application returned to another active tab, and the separate browser
session connection timed out. This is not acceptance evidence for the new UI.
Desktop and narrow-screen interactive reading acceptance remains outstanding.
No model request or persistent production test record was created during this
attempt.

Only main may publish Production. This branch must pass current-commit CI before
normal merge; production publication and browser acceptance are separate states.
