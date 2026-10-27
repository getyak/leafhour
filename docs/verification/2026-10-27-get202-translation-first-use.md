# GET-202: first-use translation explanation

This supplements [GET-202's canonical PR #150](https://github.com/getyak/leafhour/pull/150). It addresses the missing explanation before the first actual paragraph translation. It does not complete GET-202's site-wide copy review, reader/native-language review, or screenshot matrix.

## Behavior

- Existing saved translations still open locally without a prompt or generation request.
- The first translation explains that the current paragraph and up to one paragraph on each side go to AI, without private notes. This matches the existing backend translation context. Keep reading / Escape cancels before a quote, retry identity, or translation task is created.
- The explanation is remembered in this browser only for the captured authenticated owner, book ID, content version and `paragraph-neighbors-no-notes:v1` policy. Unknown owners or versions are never stored under an anonymous/shared key. Blocked storage means explaining again next time. The stored value contains no source text, notes or results.
- Selection/chapter changes, including A → B → A, invalidate a pending decision. Source/version, account, policy and view/disposal changes are checked before acknowledgement and again at actual dispatch. A submitted translation retains the existing background-result/retry behavior.
- Point quotation and cost confirmation remain independent. `readerFetch.onDispatch` starts the task only after that existing gate has completed. Free requests now also carry the captured `contentVersion`; existing backend owner/source checks remain authoritative.
- The explanation and localized privacy link remain in Settings → Source and translations. No routine sending-scope paragraph is added to the reading surface. Actual errors, original text, drafts, billing recovery, selection and reading position remain available.

The UI/storage helper and its small stylesheet load only after an explicit translation action. The existing 320 KiB reader-script / 200 KiB stylesheet budgets are unchanged. The release allowlist, local static routes and the exact deferred importer/path are registered; the helper does not import another mutable locale or tools-coordinator instance. The existing paid retry-identity helper is moved unchanged into this already loaded action module.

When the backend paragraph/context or notes policy changes, update the policy identifier with the explanation. This record is an acknowledgement of information, not billing consent, permission to run automatically, a whole-book translation grant, or permission to read notes.

## Verification

- Baseline related tests: 30 passed. Five new behavior tests first failed against the original implementation (requests preceded explanation, missing cancellation/ack scope/version and settings recovery).
- Current affected host/UI-state, real credit-helper, locale, settings, release and reader-build tests: **105 passed, zero failed or skipped**. They cover delayed/cancelled decisions, source/selection/account/policy races, unknown-owner/storage failure, retry identities, four-locale in-place dialog changes, safe overlay/focus return, the localized privacy destinations, and point-confirmation ordering.
- Real Vale 3.24.0 and textlint 15.8.0 corpus run: **zero new T1 errors**, 371 documented debt, 2027 retained warnings, zero stale bindings. Existing debt and warnings are not declared reviewed or resolved. Shared tooling was reused without installation or download.
- An earlier serial full-suite attempt recorded 3581 passed, 12 failed and 15 skipped. Eight release/bundle failures led to the exact allowlist/deferred-loading fixes and now pass in the affected suite. Four host/dependency failures remain separately recorded: required native PostgreSQL is unavailable; the task's read-only `node_modules` link cannot be copied by the PDF package test; two reader-runtime tests cannot find the cached DSH `lib/bin.js`. This is **not a full-suite pass** or a clean-install CI result.
- The checked-in generated copy inventory belongs to the concurrent GET-202 ledger integration. Regenerate it once against the combined changes before PR CI; this supplement does not overwrite that ledger or the existing 111 copy decisions.

No real model/OCR/provider, account or payment was used. No browser, Simulator, native build, deployment, PR or Linear write was performed for this supplement. Actual browser appearance, Production and human/native-language acceptance remain unverified.
