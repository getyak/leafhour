# Reading sharing and beta usage

Scope: selected Web/iOS reading excerpts; verified public-domain original anchors; beta usage statistics without point debit or owner/day allocations.

## Evidence before source delivery

- Node 22 focused suite: 42 checks passed, 0 failed, covering actual anonymous HTTP public-catalogue resolution, exact source version, private/absent book rejection, no-login reading, beta session contract, zero-balance/no-quote generation, unchanged financial ledger with persisted provider cost, model accounting without cost/call quotas, and repeated selected-note analysis above both old daily limits.
- Actual local Web UI generated a 1080 × 1350 PNG. An independent jsQR decoder recovered the exact HTTPS original reading URL, including book, passage, contentVersion and original layer. No external QR service was used.
- Desktop and 390 × 844 mobile UI were inspected. Mobile share controls stay available at the bottom; long original text extends the card without clipping. Source italics remain distinct from translation text.
- Export race regressions were observed failing before fixes and passing afterwards: the first Share gesture freezes its selected source before lazy loading; a delayed PNG callback cannot export an old selection after a different book opens.
- Real pinned Vale 3.24.0 and textlint 15.8.0 passed with no new T1 errors. Existing documented copy debt and nonblocking warnings remain visible in their reports.
- Independent review found and closed the iOS version-parameter QR rejection and the remaining notebook per-owner daily allocation. Final source/race review found no further P0/P1/P2; the reviewer independently reran the relevant 4 Web/usage tests successfully.

## Native and release acceptance

The existing public-repository CI now includes actual PNG QR decoding for the four-parameter public link and private selected-content projection on an isolated simulator. Core transport tests prove the public resolver request carries no account credential, cookie, body, private title or selected text, and rejects mismatched links. The release still requires the exact source's CI success, normal merge, Web production health and the existing unique iOS release workflow's Apple receipt. Simulator rendering is not physical-device or public TestFlight acceptance.

No unmanaged local Xcode build was started: the documented shared iOS guard was unavailable. No private book/note, cloud test account state or third-party recipient was used for these checks. Existing balances, purchases and renewal schedules were not deleted or changed; webhook reconciliation remains available. No beta usage creates a later charge.

The first hosted simulator attempt reached the existing 20-minute native job limit after successful Core tests and arm64 app compilation. The general scheme was also rebuilding unrelated application/UI test bundles for x86_64. The focused `LeafhourShareCards` scheme now contains only `BookShareCardTests` in its own test bundle, retains the original Core/app gates, boots and observes a task-owned simulator explicitly, runs serially, and has a 30-minute total native CI budget on the same free public runner. The existing Release and GET-328 schemes remain unchanged. Resource timeout is not recorded as native card-test success.

Production preflight confirmed the existing public instance has billing disabled. Beta statistics therefore use the already deployed reader-document CAS store rather than requiring commercial SQL activation. New isolated persistence tests cover restart, unknown outcomes, identity conflicts, duplicate/concurrent callbacks, report merging without financial mutations, and exclusion of unselected private text. No sensitive production variable was extracted and no commercial schema was activated.

The focused simulator run then exposed a Debug link error: `VideoAcceptanceFixture` directly imports ZIPFoundation while the app declared only its Core dependency. The app now declares the same vendored ZIPFoundation product explicitly. CI also selects an installed iOS runtime compatible with its active Xcode SDK instead of accidentally choosing a newer major runtime. These are build/runtime wiring corrections; native image assertions still require a completed successful run.

The first unaliased production candidate (`efb5e249`, `dpl_7kdHtQ6tpU6uFDiis9NGiUUXL2kN`) passed its build and announced the beta policy, but a direct hosted probe found the new excerpt endpoint rejected by the outer API allowlist. It was not promoted. The follow-up opens only the public-excerpts prefix to the existing portal, whose public catalogue/version checks remain authoritative. A hosted-adapter regression was observed failing before the correction and passing afterwards, including the private/absent-book rejection and framework-query removal. This closes a production-adapter gap that the local HTTP checks did not cover.
