# GET-226 — Preserve the reading error caption

Follow-up baseline: `f61db86efdeabe7087c41ab0f97ec097b581aea8` (PR #191). The new position caption was hiding the existing reading toolbar label even when its controller published `data-attention=true` and `Unsaved`. The controller's error message, retry action and accessible description remained intact, but the compact pill lost its visible error caption.

A real packaged-reader regression at 320px failed before the fix: the error label's computed display was `none`. Two CSS rules now give the existing attention label priority; clearing attention restores the position caption. The unchanged header remains the on-demand position view while an error is present. No timer, record, storage, persistence or model path changes.

The public verifier explicitly labels this as a controller-state fixture on actual CSS. It proves caption priority and compact layout; it does not simulate or claim a new end-to-end storage failure. Existing toolbar tests cover real `toolbar.update()` state, translated error labels, retry visibility and accessible descriptions. The independent reviewer separately exercised that real controller, matched both [source fingerprints](fingerprints.json), and closed the P2 with no unresolved P0/P1/P2.

Targeted tests: 77/77. Packaged Chromium/WebKit matrix: 8/8, including the new attention fixture, four locales, paper/night, 320px/200%, long titles, page navigation and native document fullscreen. Budgets remain unchanged: JS 327547/327680 bytes, CSS 204721/204800 bytes. Complete host/copy/runtime/release gate receipts are retained alongside this document.

Complete host suite: **3485 pass, 0 fail, 1 existing platform skip**. Repeatable copy export, pinned Vale/textlint, canaries, runtime, public build, assets and release policy/contents all passed on the frozen two-file source.
