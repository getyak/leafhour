# GET-202 integrated engineering supplement

This is a local integration receipt for GET-202's bounded privacy and source-audit work. It supplements canonical PR150, preserves its foundation history, and does not complete the whole issue or human/native-language acceptance.

## Source and merge provenance

Fresh authenticated GitHub main was `12e185775c6f0d60fc71cbf2ae5568f0f9db83c2`, rather than the earlier556076d. It merges public [PR209](https://github.com/getyak/leafhour/pull/209), authored/merged by cubxxw, head8927daa75e756dac9e4f61208b1cf3a50fc2c229. Its82 files are design documents/prototype artifacts and the two pure prototype-test imports; no app/server/catalogue/packaging/copy policy changed. Its exact-head test check completed successfully. No active task or source workspace was taken over.

An independent public-only snapshot cache was seeded through file transport (privacy depth3; ledger depth2), with no alternates, hardlinks, promisor or remote Git fetch. The new official main signature payload was reconstructed byte-exact and matched its Git SHA. The public unsigned PR209 parent metadata likewise reconstructed its exact SHA; missing79 unique blobs (2,159,908 bytes) were individually fetched through GitHub's official blob API and verified by Git blob hash.148 trees were recomputed and matched the official complete tree `67a5e8ccc263713697cf11bc6cd10c29849dbab5`. One transient blob API failure was resumed only for that missing blob; already verified objects were retained. The PR209 head is a shallow snapshot boundary, with the real main first-parent556076d path preserved. Connectivity checks passed.

Normal local merges preserve both reviewed histories:

- Privacy `9db15ac09283f8090fac6a58a02f03873259f81d` (source05ab5fc plus documentation-only full-suite correction), independently reviewed without remaining P0/P1/P2.
- Ledger `f02adb6d128a833972d386c8cfd527c8ddb33240`, independently reviewed with its single documentation P2 closed.

Both merges completed without conflicts. The release allowlist contains the union of the privacy helper/CSS and ledger tooling source; no policy or budget was weakened. The originals remain unchanged in their own workspaces. The combined candidate still requires its own independent review and final-head CI; source-branch approval is not combined approval.

## Recomputed ledger and current unknowns

The maintained92 GET218 decision records and three static admissions are byte-unchanged. No context hashes, review classifications, debt or allowances were refreshed. Current regenerated state:

| Coverage | Reviewed/admitted | Unknown/unreviewed | Total |
| -- | --: | --: | --: |
| Catalogue keys |15|2211|2226|
| Locale values |60|8844|8904|
| Static candidates |3|4863|4866|

All20 values of the five new `translation.firstUse.*` keys remain unknown. Eight existing keys/32 values reopen after real consumer or source changes: `sample.disclosure`, `sample.disclosureGeneral`, `sample.disclosureNone`, `sample.disclosureMetadata`, `translation.scopeBrief`, `translation.incomplete`, `translation.failed`, and `reader.shell.aboutTranslation`. This is deliberately conservative, including source-context drift where a value itself did not change. It is not repaired by mechanically refreshing hashes. An agent must inspect a changed trigger/context, explicitly re-adjudicate it and obtain review before restoring that claim.

The three existing English privacy-page navigation admissions remain source-bound;132 protected candidates remain unknown.3134 computed references remain unresolved.19 structural decisions keep historical evidence verified/current acceptance unknown and remain outside catalogue totals. `by: agent`/`humanReviewed: false` remain explicit. The [canonical matrix](2026-10-27-get-202-copy-ledger.md), writing standard and inventory guide distinguish current counts from the original556076d history.

The exporter regenerated all8 semantic artifacts together: the three checked-in inventory/candidate files, ignored manifest and four locale corpus files. Only the three intended generated files are committed. Run metadata is ignored. Two consecutive runs must be byte-identical; final hashes and actual source/registry bindings are retained in the permanent integration evidence.

## Actual validation

- Combined affected host suite: **299 tests/19 files,299 passed,0 failed/skipped**, serial execution, provider environment removed. Covers ledger/export/lint/tool guards, privacy/real billing preparation, locale/graph/system state, release, reader settings and actual reader-web budget build, plus new-main prototype pure tests.
- Additional independently rebound probes: **10/10 privacy** (lazy-load failure/retry, duplicate click, pre-load source/selection ABA, session/disposal, scope isolation and terminal identity) and **8/8 static admission negatives** (unknown/stale/context/cross-attribution/locale/state/rationale/protected source), with fresh inventory deepEqual and all326 frozen value hashes verified. These are not extra unique counts added to the299 suite.
- Actual pinned Vale3.24.0/textlint15.8.0 current corpus:2398 raw alerts =2027 retained warnings +371 existing-debt occurrences; **0 new T1,0 exceptions/stale bindings/problems**, binding-aware gate passed. All11 real canaries passed.
- Existing debt is **326 unique frozen bindings**, not371 waivers:285 bindings hit once,38 twice,1 four times,2 three times; the exact binding set is unchanged, missing/unused0. Existing allowances remain empty. Rules, severity, manifests, locks and original111 GET218 decisions remain byte-unchanged.
- Before this scoped run, resources read115 Node/npm processes,10.05GiB swap and41.71GiB free. This caused serial tests and no overlapping heavy/native build; no other task was terminated.

The frozen privacy source's earlier complete suite is separately recorded as3609 tests:3601 passed,5 failed,3 skipped (native PostgreSQL1, PDF package symlink-copy1, missing DSH runtime entries3). The integrated full suite is not claimed green or re-run by inference. Final fresh-head PR CI must verify the actual clean environment. No browser, Simulator, provider/model/OCR/payment, real account, deployment or external write was performed here.

## Reproduction and review handoff

From this integrated source with the existing audited dependencies:

```sh
node scripts/export-copy.mjs --root . --out build/copy
node --test --test-concurrency=1 tests/copy-ledger.test.mjs tests/copy-inventory.test.mjs tests/copy-lint.test.mjs tests/copy-install.test.mjs tests/copy-ci-environment.test.mjs tests/ui-locale-reader-async.test.mjs tests/credit-client.test.mjs tests/reader-credit-routing.test.mjs tests/translation-state.test.mjs tests/translation-disclosure.test.mjs tests/reader-web-build.test.mjs tests/reader-settings.test.mjs tests/release.test.mjs tests/ui-locale.test.mjs tests/ui-locale-graph.test.mjs tests/ui-locale-reader-foundation.test.mjs tests/ui-locale-ui.test.mjs tests/ui-locale-system.test.mjs tests/ios-design-interaction.test.mjs
node tools/copy-lint.mjs --manifest build/copy/manifest.json
node tools/copy-canaries.mjs
```

Local execution explicitly pins Vale to `/Users/cubxxw/ops/symphony/runtime/tools/vale/3.24.0/darwin-arm64/vale`. Textlint15.8.0 uses the already audited task-private wrapper/resolver and SHA512-verified kuromoji0.1.2 package from the existing npm cache; it still loads all23 original JA preset rules. No repeated dependency installation or download was used for tools. The exact environment/command,299-test process,10+8 probes, fresh-main provenance, object recovery, dual-export hashes and final candidate blobs are held under the authorized permanent delivery-audit evidence directory.

Only local integration commits are authorized in this batch. Root owns external push/PR, canonical PR150 linkage, latest-head CI, normal merge and task-status readback. GET202 remains open for its actual remaining engineering/runtime/human acceptance.
