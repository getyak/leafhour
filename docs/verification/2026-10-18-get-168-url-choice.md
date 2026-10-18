# GET-176/177/179/187 — filters, view URLs and Aa choices

Verified 2026-10-18. [Design](../superpowers/specs/2026-10-18-get-168-url-choice.md).
The final candidate integrates main `eae0e9756a85d7d38d26b4c012b711d1d1cc6bc8`
(PR125 fonts) through merge `d952ae381e9181ec932461dcd0db4e57e0310842`,
then repairs the combobox selected-state issue described below. CI must bind
its actual PR head; a local dirty-source check is not a green PR check.

## Result and boundaries

- The library summarizes search, reading status, source, topic and original
  language. Each condition can be removed independently; clear-all restores the
  default view, which has no extra condition row.
- The shared progressive choice control uses immediate chips for up to six
  options and an editable combobox/listbox for larger groups. All nine Aa
  selects use the same primitive, including conditionally shown parallel and
  translation controls. Native values and normal change side effects remain
  authoritative. Programmatic writes use explicit sync.
- A bounded codec and history adapter own the five view keys and one supported
  overlay. Search replaces after debounce; discrete choices flush it before
  pushing. Back/forward, hydration, owner changes, IME, direct-modal closure and
  safe auth returns have explicit lifecycle handling.
- Fiction is curated on 17 unambiguous novels/stories. All 30 shipped editions
  remain English originals, with unchanged source bytes, content versions and
  paragraph IDs. Chinese-fiction selection honestly yields an empty shelf;
  Chinese trial translations are not classified as Chinese originals.
- No product model calls, paid translation generation, real private books,
  credentials, account mutations or new schedules were used in this batch.

## Checks actually run

All local tests used a registered temporary directory and concurrency 2.
The test process received a small explicit environment allowlist, excluding
production credentials. The final full check ran every `tests/*.test.mjs`:

```text
node --test --test-concurrency=2 tests/*.test.mjs
1604 tests: 1603 pass, 0 fail, 1 existing platform skip
node tools/build-reader-runtime.mjs
928 traced files, 9.0 MB; initialized without model requests
node tools/build-vercel.mjs
node tools/check-public-build.mjs
321 public files, 11 registered media assets
node tools/release-policy.mjs
683 allowed software files; private history/data excluded
node tools/verify-release.mjs
git diff --check
All commands exited 0.
```

The existing skipped modified-Node-license test requires the packaged Linux
binary; Linux CI remains the applicable runtime check. The 122-test targeted
integration check also passed before the final selected-state repair; after
that repair, its focused choice/settings/filter/profile suites passed 41/41.

Initial reader JS exceeded 320 KiB (333,551 bytes). The parent moved the Aa
choice enhancement behind an explicit drawer-open import. The bundler permits
it only from `reader-settings.mjs` and checks the release allowlist. The existing
share-font import and exact same-origin CJK CSS exception remain independent.
Final initial-reader JS is **327,532 bytes**, CSS **167,833 bytes**. The
320/200 KiB limits were not increased. A lazy-loading failure leaves labelled,
usable native selects visible. There is only 148 bytes of JS budget headroom;
future features must retain deliberate loading boundaries.

## Independent reviews and repairs

Three independent native reviewers examined the implementation, then reviewed
confirmed repairs. The integration reviewer matched all 42 freeze3 file hashes
and checked the merged release list against both parents. The URL/choice/Aa
implementations were unchanged by main integration, except the later small
selected-state fix. No confirmed P0/P1 remains.

Confirmed issues repaired include modal-entry ownership, stale session overlay
handoff, safe auth-next adoption/cleanup, owner epochs across refresh, pending
query cancellation and valid UTF-16 truncation; disabled option updates,
threshold remount/focus, IME/pointer state, native fallback naming and Aa async
focus transfer. Real portal callbacks were exercised in isolated VM scenarios;
this is separate from a real OAuth browser flow.

Native large-choice QA then exposed stale `aria-selected`/selected styling
following an internal commit when the caller did not call sync. A regression
failed first, then passed after internal commits synchronized their own state.
Native Chrome subsequently showed Français selected, native value `fr`, and
exactly one change. The reviewer independently checked pointer, keyboard,
repeated sync and a 7→6 transition. An old profile-shell test fixture lacked
`contains()`; it was reproduced independently and the fixture gained the DOM
method without weakening production focus checks.

## Actual native Chrome acceptance

Native CUA gestures in macOS Chrome Guest, at 1200px desktop and a
390×844 responsive viewport. A private, read-only observer measured rendered
DOM and recorded local receipts; it did not drive product controls. These are
browser observations, not physical-device, touch or screen-reader claims.

| Scenario | Observed result |
| --- | --- |
| Default shelf | 30 books; no condition or clear-all row |
| Filter → fiction → Chinese | 3 clicks, 17/30 then honest 0/30; independent removable conditions |
| Query `Alice` + unread + fiction | 1/30; all three conditions and URL agree |
| Open settings, switch appearance tab, reload | Query/status/topic/tab restored; explicit close and browser Back/Forward restore their corresponding entries |
| All nine Aa fields | Goal, preferred language, view, page layout, translation variant, parallel arrangement/style/color/background changed through actual UI; native values retained |
| Enhanced Aa | All nine underlying selects hidden; conditional controls appear coherently; range and switch targets measured 44px |
| Large-choice fixture | Clearly labelled disposable eight-option fixture; query does not commit, Enter changes once, disabled Deutsch skipped, Escape cancels, Tab exits; selected styling repaired and retested |
| Failed Aa enhancement | Deliberate HTTP503 on only the lazy module; visible native selectors remain operable; native view selection changes to Chinese and reveals translation variant |
| Width | Observed document widths exactly 1200 and 390 respectively; no horizontal document overflow |

Normal-page observer receipts contained no runtime errors. The failure scenario
intentionally produced a visible 503 network error, which is not reported as a
clean network pass. DevTools also showed existing password-form accessibility
advice and a short forced-reflow warning; neither is hidden as an all-console
clean claim. No real login/OAuth, physical touch or assistive-technology session
was run. Source/owner/auth boundaries also have deterministic automated tests.

Original native screenshots (browser chrome retained, no image retouching):

- [Desktop default](assets/get168/desktop-default.png)
- [Desktop Aa](assets/get168/desktop-aa-clean.png)
- [390px Aa](assets/get168/mobile-aa.png)
- [390px filter](assets/get168/mobile-filter.png)
- [Synthetic large-choice selected-state repair](assets/get168/mobile-large-choice-fixed.png)
- [Deliberate 503 / native fallback](assets/get168/mobile-native-fallback.png)

The existing long-author card CTA alignment and multiple reader-tool entries
remain assigned to GET-180 and GET-184. This record does not close their epics,
claim all cross-platform acceptance, or replace current-head CI, merge readback
and production verification. Those delivery receipts are recorded on the linked
Linear issues after their actual completion.
