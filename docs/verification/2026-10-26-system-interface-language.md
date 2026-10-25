# GET-219 — System interface-language verification

This is the pre-merge local verification record for [GET-219](https://linear.app/getyak/issue/GET-219). The branch starts at public `main` commit `8b9838ddeab579c6a050021216785ef383635f87`. CI, merge, Production revision and real-account acceptance are separate gates; their final receipts belong to the linked PR and issue.

## Contract and scope

See [the preference contract](../interface-language.md). There are five preference choices and four catalogues. `system` resolves the current browser preference independently on each device; it never becomes a fifth URL/catalogue code. Existing explicit device/account choices survive. Existing v1 account `null`, including a historical clear at a nonzero revision, remains “no account preference.” Only an explicit system save upgrades the owner-scoped record to v2. There is no batch migration.

| Situation | Display | Selected preference / generated canonical links |
| --- | --- | --- |
| New visitor | First supported browser language, otherwise English | system / omit `ui` |
| Explicit account choice | Account choice, resolved on this browser for system | Account mode / omit `ui` for system |
| No account preference | Valid tab/device choice, otherwise system | Corresponding mode |
| Valid page `ui` | Page override for this document | Preference remains distinct; system links omit `ui` |
| Authored language path | Authored prose follows the path | Shared settings can change the preference; opening a path does not save it |
| Successful manual choice | Current document's chosen mode wins subsequent history/device events | Only this intent may save through owner-bound CAS |
| Denied localStorage | Current mode, retained in sessionStorage if available | Tab-only notice and explicit Retry; both stores denied is page-only |
| Catalogue failure | Last readable catalogue, with requested language and failure state | No false success or unbounded import retry |

Navigation fixes cover the root entry, history/BFCache recovery, owned book/passage and login links, palette, billing returns and checkout completion. Language updates retain the existing text/input controllers and do not invoke models, billing or reading-record writes.

## Red → green and local gates

The three reported counterexamples were first run against the unchanged baseline and **all three failed**. Their original red output is in [regressions-red.tap](get-219/regressions-red.tap); the same named tests now pass in the [final summary](get-219/tests-summary.txt).

| Gate | Command / result |
| --- | --- |
| Complete source suite | `node --test --test-concurrency=2 tests/*.test.mjs`: 3377 tests, 3373 pass, 0 fail, 4 skip; exit 0 |
| Local native-engine limitations | Three PostgreSQL tests were not executed on macOS without the binaries. The yearly test uses the existing explicit hosted-build skip. GitHub CI must install and run its mandatory native PostgreSQL checks. The fourth skip is the Linux-only modified Node-license test. |
| Copy | Export, checksum-pinned Vale 3.24.0/textlint lint, and planted canaries: exit 0; existing declared debt remains warnings |
| Reader runtime | `buildReaderRuntime`: 928 files, 9,404,531 bytes, initialized; no model requests |
| Hosted web build | `buildVercel`: success; separate from runtime construction |
| Public package | `check-public-build`, `release-policy`, `verify-release`: exit 0; 514 public files, 11 registered media assets, no private content directories |
| Static graph and size | Existing source-suite audits pass. [Exact bundle sizes and hashes](get-219/bundle-budgets.json); unchanged limits: 320 KiB JS / 200 KiB CSS |

Tests use an environment without production credentials, synthetic identities and task-owned temporary paths. Builds were directed to a registered task artifact; `dist` is a local ignored link to that output. The local dirty-tree release marker identifies the base commit, **not** a deployed revision. The final current-head CI and Production marker must identify the committed source separately.

## Real-browser acceptance

[Structured browser evidence](get-219/browser-report.json) records Chromium 153.0.8010.12 and WebKit 26.6, each in an isolated context with `ja-JP`. Both engines pass 14 interaction groups. Each also checks all four actual languages at 320 / 390 / 768 / 1440 px: 32 layout rows total, one selected mode, five readable labels, no horizontal overflow and targets at least 44 × 44 px. Keyboard radio navigation and CSS zoom 2 also pass.

Covered interactions include first-visit system, fixed four-language reloads, return to system, signed-in second context with `zh-CN`, live browser-language events, another tab's device write, history/root/full-document/billing navigation, denied storage plus a real Retry, native and enhanced Aa controls, and owner logout/B/A restoration. Failure injection covers base/retry catalogue rejection, the real three-second catalogue deadline, account offline/401/409, and missing select enhancement. Import/retry/POST counts are asserted, not inferred from screenshots.

The reader probe selects actual paragraph text, opens the annotation/thought panel, types a multilingual unsent draft, retains focus and selection range, begins a composition event, then changes language four times. The same input and text nodes, exact draft, selected text, scroll offset and paragraph anchor remain. The recorded language-action interval contains **zero model, billing or reading-record writes**.

Public evidence contains only synthetic local accounts and public Alice paragraphs. No real account's books, credentials, cookies or response bodies are included.

### Screenshots

| Engine | Initial system → fixed language, mobile | Initial system → fixed language, desktop | Reading draft |
| --- | --- | --- | --- |
| Chromium | [system at 320](get-219/chromium-320-system.png) → [Japanese at 320](get-219/chromium-320-ja.png) | [system at 1440](get-219/chromium-1440-system.png) → [Traditional Chinese at 1440](get-219/chromium-1440-zh-Hant.png) | [preserved draft](get-219/chromium-reader-draft.png) |
| WebKit | [system at 320](get-219/webkit-320-system.png) → [Japanese at 320](get-219/webkit-320-ja.png) | [system at 1440](get-219/webkit-1440-system.png) → [Traditional Chinese at 1440](get-219/webkit-1440-zh-Hant.png) | [preserved draft](get-219/webkit-reader-draft.png) |

### Console baseline and platform limits

There are no unexplained browser errors or failed requests. The probe attaches error, console and request-failure listeners to every test page, including auxiliary contexts, and retains each classified cancellation/message. [The unmodified-main console baseline](get-219/baseline-console.json) reproduces existing reader inline-style CSP warnings and local 503s for unconfigured billing/audio. Every archived source file is verified against its Git blob hash, and browser versions must match. WebKit screenshot capture itself injects a stylesheet and emits the same CSP warning; the baseline reproduces the same number of screenshots and reader contexts. Matching uses exact pathname/message fingerprints with a count budget. Intentional failures are registered against the injected request and a bounded phase/path/status console allowance. Cancellation allowances require an actual pending navigation, a later document generation or explicit page/context close. Production CSP was not loosened. All model-generator options are explicitly null, including chat/companion factories that otherwise consult the process environment.

The composition probe dispatches `CompositionEvent`; it does not prove physical macOS IME operation. CSS zoom 2 is a layout stress proxy, not native toolbar zoom. Synthetic persisted `pageshow` verifies the application recovery hook; actual BFCache admission is browser controlled. Browser language exposure may require restarting the browser on some platforms. These limits are not reported as physical-device acceptance.

To reproduce, archive the stated base with `git archive`, provide its exact locked dependencies, and use an existing Playwright installation (not a product dependency):

```sh
export LEAFHOUR_PLAYWRIGHT_MODULE=/absolute/path/playwright-core/index.mjs
export LEAFHOUR_WEBKIT_EXECUTABLE=/absolute/path/pw_run.sh
node tools/capture-system-language-baseline.mjs "$BASELINE_ROOT" "$ARTIFACT_DIR" 8b9838ddeab579c6a050021216785ef383635f87
export LEAFHOUR_BASELINE_CONSOLE_REPORT="$ARTIFACT_DIR/baseline-console.json"
node tools/verify-system-language-browser.mjs "$ARTIFACT_DIR"
```

## Independent review and delivery gates

The independent `review_language_contract` agent reviewed compatibility, owner/epoch races, URL boundaries, retries and the browser bridge. The final production-code review reports no unresolved P0/P1 and all five earlier P2 findings closed: restored tab Retry persistence, billing system navigation, same-effective owner link refresh, restoring tab failure disclosure, and verified authored-handoff intent/CAS. Its last focused run passed 86 tests (exit 0), including independent synthetic cross-tab/manual-priority and owner-revocation checks with zero extra writes. Its subsequent tool review identified missing auxiliary-page telemetry and implicit generator factories; both were corrected before the final browser run (eight observed pages per engine). The final console-classifier hardening was checked by replaying every captured browser message and planting HTTP 500, unsolicited 409, unknown errors and repeated budget consumption. All rejected cases remain unclassified errors. The reviewer then rechecked the final source and closed all product/tool findings: no unresolved P0/P1/P2 in its review scope.

Delivery requires a current-head CI run, normal merge, matching Production `release.json`, then live acceptance using only the designated account. Real-account verification must read its Auth identity and original preference first, restore the original preference afterward, and log out only the sessions created for this check. Until those receipts exist, this document claims local completion only.
