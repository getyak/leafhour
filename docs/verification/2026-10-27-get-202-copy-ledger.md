# GET-202 bounded ledger supplement and canonical scope matrix

Integrated source base: public `getyak/leafhour` main `12e185775c6f0d60fc71cbf2ae5568f0f9db83c2`; original ledger baseline `556076d229528cb85767b1da24620b472b8ee2b9` retained as historical evidence. This supplement connects actual GET-218 work to the inventory; it changes no product wording, translation behavior, lint severity, debt or allowances. Agent review is explicitly not human/native-language approval. GET-202 remains open.


## Integrated source readback (2026-10-27)

Fresh GitHub main is `12e185775c6f0d60fc71cbf2ae5568f0f9db83c2` (merged public PR209; design documents and pure prototype tests only). This independent integration normally merges privacy `9db15ac09283f8090fac6a58a02f03873259f81d` and ledger `f02adb6d128a833972d386c8cfd527c8ddb33240`, preserving both source histories. No previous context hashes or decisions were refreshed. Current generated inputDigest is `e4a326111267eb89bffbe0f52c1328bc33ac13d917ab737a27c7c3a2d70224ea`.

The current scan has **2226 catalogue keys: 15 agent-reviewed / 2211 unreviewed**, and **8904 locale values: 60 reviewed / 8844 unknown**. Exactly 8 old keys / 32 locale decisions reopened after the privacy consumer/source changes: `sample.disclosure`, `sample.disclosureGeneral`, `sample.disclosureNone`, `sample.disclosureMetadata`, `translation.scopeBrief`, `translation.incomplete`, `translation.failed`, `reader.shell.aboutTranslation`. Five new `translation.firstUse.*` keys /20 values remain unknown; source review of privacy behavior does not automatically classify their wording. The original92 maintained decision records are historical scope, not92 current passes.

Static candidates: **4866 total, 3 admitted, 4863 unknown**, including all 132 protected-source candidates; 3134 computed references remain unresolved.19 structural records retain historical verified/current unknown states and stay outside catalogue counts. These are regenerated figures, not fixed denominators. The original556076d snapshot below is retained as history.

## Evidence and current generated coverage

[GET-218 decision source](get-218/copy-decisions.json) has111 records:92 catalogue locale decisions (23 keys ×4 locales) and19 structural decisions. Every admitted value still matches that record's `after` bytes at the baseline. Its [verification](2026-10-25-interface-copy-reduction.md), browser artifacts,136 host tests and independent review remain historical evidence; no new screenshots, account session or model calls were created here. Structural decisions keep historical record hashes and **current unknown** states; they never count as catalogue reviews or fresh interaction acceptance.

`docs/copy/copy-ledger.json` binds each catalogue record to exact key, locale, canonical file, actual value SHA256, historical array index/record SHA256, consumer coordinates and inspected source-file hashes. Context-only changes reopen unknown even if wording is unchanged. All four locale records must remain valid before their key counts as agent-reviewed. Missing/changed values, references, locale, source, consumer or evidence reopen unknown and carry reasons. No automatic refresh, debt admission or lint exception is created. A–F labels describe the historical issue adjudicated; they are not a claim that the replacement still violates those classes. The retained `sample.disclosureGeneral` wording has no established current caller and says exposure unknown.

The exporter derives denominators from the actual current inventory, never2221 or23 constants. At this integrated baseline:

| Measure | Agent-reviewed/admitted | Unreviewed/unknown | Total |
| -- | --: | --: | --: |
| Catalogue keys |15|2211|2226|
| Locale values |60|8844|8904|
| Static candidates |3|4863|4866|
| Structural decisions: historical evidence |19 verified|current acceptance19 unknown|19 outside catalogue counts|

132 static candidates are protected-source hints, included in the4863 unknowns, never force-added to lint.3134 computed consumer references remain unresolved; no static consumer is not proof of unused copy. Global HTML discovery is incomplete. These numbers bind the generated input/registry hashes; a later main or privacy integration must regenerate them and inspect reopened records.

Only three **source-inspected** visible English navigation nodes from `app/en/privacy.html` enter static lint: header Search &amp; commands, header Back to the reading room ↗, and content-end Back to the reading room →. Their actual containing `<button data-palette-open>` and library `<a>` elements establish source purpose; this is not a fresh rendered visibility test. Exact entity bytes/arrows are preserved. The legal body, contact/URL/source data and other candidates stay unknown. Full containing-file hashes and explicit `by: agent` prevent changing the surrounding source without re-review. A deliberately admitted synthetic UI literal `Retry the receipt` must produce a real Vale `Leafhour.DevSpeak` error at its manifest-mapped static line; the clean control must exit0 with no alerts. Unknown synthetic literals are separately excluded by the existing exporter/lint tests.

## Canonical GET-202 scope matrix

| Acceptance area | Verified evidence/state | Unknown or remaining boundary |
| -- | -- | -- |
| Inventory, trigger and source ledger | Current deterministic scan; the original23-key ledger with current15 valid keys/60 values,32 reopened values and3 static admissions above; source/consumer/evidence drift reopens unknown | Remaining catalogue/static denominator above; computed consumers; no complete all-site visible UI inventory |
| Quiet title-to-prose, source details and truthful save/error copy | Existing GET-218 report, decisions and linked browser/host evidence; reused without re-running | Current full-site/runtime acceptance not re-attested by ledger |
| Passage translation affordance | Existing source click/Enter selection exposes the action; GET-218 keyboard evidence is scoped historical evidence | Dedicated hover behavior and every-page/mode affordance coverage not established here |
| First actual translation privacy notice, cancel and owner/book/version policy | Integrated first-action explanation precedes quote/POST and remains retrievable in Settings; source review and actual host ordering/ABA/cancel tests pass; existing billing consent stays distinct | Privacy source9db15ac is integrated with its independent review and105 affected tests; current integration reruns the combined host checks. Changed contexts have reopened; actual browser, latest-head CI and Production remain pending |
| Four-locale values and all page states | Exact key parity at current scan;60 existing decisions retain valid locale/context bindings;32 reopen and20 new values stay unknown | Full ZH/Hant/EN/JA idiom, all page/error/offline/auth states and static-page coverage remain unreviewed |
| Vale/textlint policy and new T1 | Actual Vale3.24.0 + textlint15.8.0:70 focused tests/0 failures/0 skips,11 real canaries passed; full current corpus0 new T1,2023 warnings,371 existing-debt hits,0 exceptions/stale bindings | Final integrated-head CI and Production still pending; existing debt/warnings are not reviewed copy |
| Screenshots, accessibility and reader studies | GET-218 scoped browser/keyboard artifacts exist; source navigation admission here only | Site-wide before/after, screen-reader speech, nontechnical5-second/read-aloud/portability studies and native-speaker/two-person review remain unknown; require real humans where specified |
| Delivery | Both source branches independently reviewed; current combined host299/299 and10+8 extra probes pass; local generated evidence only | Third-party independent review of this ledger, latest integrated-head CI, normal merge and required production acceptance still separate |

## Reproduce and maintain

Run `node scripts/export-copy.mjs --root . --out build/copy` twice and compare tracked artifact bytes. Read `auditLedger.reopened`, per-key `localeReviews`, derived counts and the registry SHA256. Do not erase reopened records or bulk refresh hashes: inspect the affected wording and its new appearance/trigger, explicitly adjudicate only those records, then regenerate. Keys and locales outside this ledger remain unknown. Static stale source/value bindings fail closed and leave the candidate unknown, outside the lint corpus, until explicit re-review.

Use the explicit pinned Vale binary for local tests: `LEAFHOUR_VALE_BIN=/Users/cubxxw/ops/symphony/runtime/tools/vale/3.24.0/darwin-arm64/vale node --test --test-concurrency=1 tests/copy-ledger.test.mjs tests/copy-inventory.test.mjs`. No package installation, browser, Simulator, real account or provider call is needed. Test logs and final candidate blobs are held in the authorized delivery-audit evidence directory; this matrix is not a remote CI receipt.

## Pre-integration ledger validation (historical f02adb6 source)

The new ledger boundary suite first failed17/17 before implementation. The new static attribution/context test first failed on missing rejection. Final affected five-file host suite passes70/70 with0 skips using real Vale3.24.0 and textlint15.8.0; its41 inventory/ledger tests include a manifest-bound admitted static T1 and clean control. All11 unchanged real-CLI canaries pass. Full corpus lint reports2394 raw alerts,0 new T1,2023 visible warnings,371 existing-debt alert hits,0 exceptions and0 stale debt/allowance bindings. Vale/textlint raw exit1 is expected for the retained documented error debt; the binding-aware gate exits0. Debt entries, allowances, configs and rule severities are byte-unchanged.

An initial fully enabled run was63 pass/7 fail because the existing shared Japanese-tool cache lacked `kuromoji/src/kuromoji.js`; a prior unconfigured run was58 pass/12 explicit tool skips. Both failures/skips remain in evidence. Repair used only the existing npm cached official kuromoji0.1.2 tarball, checked against the full lockfile SHA512 before extracting63 package members to a task-private tool directory. A process-only resolver points only kuromoji/package metadata there; shared dependencies, package versions and the lockfile were not changed. A private wrapper preserves the existing sibling-preset lookup. No dependency installation or network download was needed. The actual preset still loads all23 rules.

Two consecutive exports are byte-identical across the three tracked generated files, manifest and all four corpus files. Registry SHA256 and inputDigest are retained in the generated inventory. Release allowlist export checks1009 software files; the verification matrix remains source-only under the existing exclusion policy. There was no product-source edit, model/provider/account call, browser/native build, simulator, external write, remote CI claim or global GET-202 completion claim.

## Integration verification boundary

This integration does not rerun the entire application suite or claim its known five host/dependency failures are green. The frozen privacy source full run is3609 tests:3601 passed,5 failed,3 skipped (native PostgreSQL1, PDF package symlink-copy1, missing DSH runtime entries3). Final fresh-head PR CI must resolve/verify those in its actual environment. Existing debt remains326 unique frozen bindings;371 current alert occurrences are multiple hits of those bindings, not371 exemptions.
