# GET-328 current-source preparation — November 7

This is **phase A: source and host preparation**, not a native acceptance run.
The original [GET-328 failures](2026-10-30-get-328-reader-controls/README.md)
remain failed/unaccepted. No product rendering or edit-menu fix is inferred from
these test changes, and no experience score is assigned.

## Source and updated scenarios

The managed worktree is on `codex/get-328-current-acceptance`, based on fresh
public main `d302393d4ed01a82af6828d7200969be3b8addc9`. The base native tree was
`be5007319507d68bc105fecb168a9459d72c0c6c` (a tree object, not a commit).

| Original method | Prepared current behavior | Still requires native execution |
|---|---|---|
| `test38SavedRecordsAndExpandedSettingsPassNativeAccessibilityAudits` | Explicit text/paper/reading categories; records, text controls/preview, first/last paper rows and reading controls expose their actual foreground UI. Original `.all` audit and `return false` handler stay unchanged. | All raw audit findings, including maximum OS type. No finding is suppressed or rewritten as a pass. |
| `test41SystemTypeProfileKeepsTheRealTypographyPreviewAndResetUsable` | Correct `阅读风格` title, bounded bidirectional positioning, actual `.subheadline` text and slider values, font/spacing changes, persistent 44pt reset and restored preview. Full viewport/font-height/preview-growth checks remain. | Real App/runner OS category, lazy-row reachability, native slider values and preview geometry at both system sizes. |
| `test54PagedNativeCopyAndReflowKeepTheVisibleSourceParagraph` | Product and test method body unchanged; only shared launch support selects the new isolated identity. | Original actual Copy → second menu → Note/Paste → reflow/rotation/cold chain, especially AX5. |
| `testPDFSystemImportAndLastPage` | Exact native Files source, fresh queries and directory-ready waits. Current contents entry replaces removed slider/next controls. Prove original page 72 → native turn to 73 → same forward gesture stays on 73 → cold resume 73. | Actual Files hierarchy, PDFKit original rendering, visible page witnesses, persistence and postflight manifest. A witness/OCR failure alone is not a confirmed rendering defect. |

## QA identity, storage and preservation

- Exact unsigned Simulator-only configuration/scheme:
  `GET328Acceptance` / `LeafhourGET328CurrentAcceptance`.
- Exact application ID: `org.leafhour.get328.acceptance20261107`; widget and UI
  runner derive from this same prefix. The scheme selects only the four methods
  above, not unrelated or real-account UI suites.
- The UI runner opt-in `LEAFHOUR_GET328_CURRENT_ACCEPTANCE=1` selects that exact
  identifier; arbitrary IDs and unknown opt-in values are rejected. It appends
  both `--get328-current-acceptance` and `--get317-acceptance`.
- The app admission is inside `#if DEBUG`. That identity or the new flag without
  the matching identity, both flags, and absence of `--get385-live` fails closed
  before any real credential fallback. Existing synthetic URLProtocol/credential
  injection remains; no real account/model bypass is introduced.
- Application Support child is `GET328CurrentAcceptance`; Documents children are
  `GET328AcceptanceSources` and `GET328AcceptanceExports`. Reset is confined to
  the exact support child in this app's container. The PDF source is not imported
  by fixture initialization.
- The dedicated Info file displays `Leafhour GET328` in Files and omits real
  authentication URL registration. Existing default app Info and all ten
  Debug/Release configuration objects compare unchanged against the base.
- **No device container has been inspected or touched in phase A.** Allowlisting
  never establishes ownership of `org.leafhour.get317.testing`; it is not used
  for this follow-up. The new ID also requires fresh collision/activity checks
  after lease handoff. An unexpected installation/container means stop before
  install/reset, rather than overwrite or uninstall it.

The [execution plan](../superpowers/plans/2026-11-07-get-328-current-acceptance.md)
requires a fresh-device ownership receipt, actual container/executable/Info hashes,
verified task-state snapshots before resets and restored system state in `finally`.
Those device receipts are **not yet available**, because native phase B has not
started. No current claim of device ownership or restored device state is made.

## Complete new PDF original

The historical `Alice-complete.pdf` bytes were not recoverable. This is explicitly
a **NEW source / NEW hash** derivative, not recovery of the old byte identity.
[Generator and complete-content verification](2026-11-07-get-328-pdf73-fixture.md)
use only public `catalog/alice.txt`:

- Source: 174,311 bytes, SHA-256
  `01b38ea4c710a84bc18d0bd41271a5a1a92b94e97b2812f4dece97d4a694725e`.
- PDF: `Alice-complete-GET328-20261107.pdf`, 243,472 bytes, SHA-256
  `0e5810fe2dfe46470a388382d3a0149a42bf36e54df354980a312f05483650b9`.
- Actual-byte PDF.js readback: exactly 73 substantive pages, all 26,441 narrative
  words and 811 paragraphs in order. Each page contains 273–485 words and at least
  24 real lines. Page 73 includes `happy summer days.` and `THE END`.
- Each page has an extractable visible `GET328_PUBLIC_ALICE_PAGE_<n>_OF_73`
  header; the manifest retains source/PDF hashes and per-page text/range/witness
  receipts. Host renders of 1/72/73 are retained; these are not PDFKit screenshots.
- Binaries, manifest, renders and logs are local evidence outside Git. Before
  native import, stage into the receipt-proven task app's exact Documents child
  without overwriting different bytes; read back hash/page count and prove the
  book is not already imported. Afterward verify the actual imported manifest,
  73-page asset and saved last-page/cold state separately.

## Actual phase-A checks

| Check | Result and limit |
|---|---|
| New PDF host tests | **4/4 pass, 0 failed/skipped**. Independent real-byte complete-text reconstruction, deterministic generation, no-clobber/source admission, and removed/blank/reordered/duplicated pages. The 73-page sample with only final `END` deleted must also fail validation. |
| Existing prepare/release/private-delivery host contracts | **11/11 pass, 0 failed/skipped**. Synthetic providers; no live release or credential access. |
| Existing signing/package/vendor host contracts | **9/9 pass, 0 failed/skipped**. No signing changes, build or provider writes. |
| XcodeGen + plist/XML metadata readback | Generation succeeded; all ten existing Debug/Release configuration objects are unchanged; the new helper is only a UI-test source; the new scheme selects exactly four methods and references the dedicated DEBUG xcconfig. No compilation. |
| Earlier Files Swift syntax parse | Exit 0 before the later OCR witness correction. Parse only, not typecheck/link/build; it does not validate the final modified method. Original receipt retained. |
| Final whole-branch independent review / diff check | **No unresolved P0/P1/P2** after source corrections; final whitespace/config/XML checks passed. Native compilation and runtime remain **UNRUN**. |

The first project-metadata probe looked for the Swift DEBUG setting inline and
raised `KeyError`; the setting is actually in its referenced xcconfig. The
corrected metadata readback passes and records the earlier probe error. Host
Poppler renders emitted a fontconfig default-config warning but completed; no
font or environment installation was performed. Neither event is native evidence.

## Next gate

No build-for-testing, Simulator control/lease, account login, model request, PR,
merge, Apple readback/upload or Vercel activity occurred in this phase.
The seven-target serial plan remains pending coordinated lease handoff and fresh
guard/audit/cache/actual-loaded-source checks; it is not a full 56-case pass.

Before eventual merge, publication handling must be resolved: current
`scripts/ios/prepare.mjs` counts all `apps/ios` paths as release-relevant, including
tests/configs. This phase does not silently alter the shared workflow or provider
variables. Test-only preparation must not automatically create a TestFlight
upload. If Release product content is unchanged, reuse the existing build only
after later exact 1.0.83/source/Apple mapping readback; phase A has not verified
that mapping. A real product fix requiring a new binary uses the existing unique
release chain and its actual CI/Apple receipts. GET-317/276 remain separate and
unaccepted.

Independent review caught and rechecked three P2s: an overbroad new scheme,
unsupported PDFKit AX-node assumptions, and folders unreachable offscreen. The
scheme now selects exactly four methods; original-page OCR supplies visible
witnesses; exact-directory reveal is bidirectional and bounded. The final reviewed
`ReadingUITests.swift` SHA-256 is
`387444c39e72513392c77073ef8a4500b1535fb450f681333e43b7e089e8f7e8`.
This is a source-review result, not runtime or compilation acceptance.
