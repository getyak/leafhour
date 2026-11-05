# GET-408 · Pull to bookmark

The issue screenshot and the existing entry point are the native iOS reader. This change updates that entry point; Web has no matching pull-to-bookmark gesture and is unchanged. Device bookmarks remain separate from private notes and retain their source/display anchors, identifiers, names, colors and export format.

## Behavior

- The paper follows a downward paged-reading gesture with bounded resistance, then returns with a damped spring on release or cancellation. Layout and pagination stay fixed. Continuous text/PDF uses the existing UIScrollView rubber band and receives no extra displacement.
- A progress ring and release label expose the 72-point threshold. Existing 56-point hysteresis remains. Returning more than 18 points from the peak, departing horizontally, losing context, cancellation, multitouch and invalid coordinates cannot commit or rearm until the next touch.
- Threshold feedback is prepared once per touch. A light success impact runs only after a new bookmark has actually persisted. An existing bookmark retains its configuration.
- Success offers a direct configuration action for five seconds (ten with VoiceOver). Common colors and the optional name share the first section; custom colors are folded away. Done, changing the selected bookmark and jumping first persist a name draft. A failed write retains the editor for retry.
- Reduce Motion disables the added paper displacement and spring. VoiceOver retains the existing explicit add action and button; gestures do not own selection, links or long presses. Color choices also expose names, checks and selected state. Preset targets are at least 44 points and switch to two columns at accessibility text sizes.

## Verification

Local output is kept in the registered GET-408 artifact directory, with an isolated Debug app identity. All content is synthetic; no real account, uploaded book, cloud generation or paid model was used.

- LeafhourCore: 420 tests, two explicit user-selected-fixture skips, zero failures. Includes resistance/progress/reset, long reversal, invalid coordinate and new-touch regression cases, together with existing persistence, idempotence, export and translated/PDF/image-anchor tests.
- Native vendor hashes: passed. Release contracts: 105 Node tests and 11 Python tests passed; archive/upload shell syntax passed.
- Native application checks: 21 reader bookmark, tap and selection tests passed. The additional narrow-layout test initially lacked an explicit source anchor in its synthetic fixture; after fixing that setup, it passed with both 320×568 snapshots and unchanged bookmarks/anchor.
- iPhone 17 Pro / iOS 26.5 UI: three tests passed for pull/save/configure, repeat idempotence with retained name/color, short-pull cancellation, and accessibility text configuration. The final palette change fixes the check symbol size inside its 24-point swatch and passed the affected accessibility UI test again.
- Narrow and accessibility [screenshots](../../../apps/ios/verification/2026-11-06-get-408/) are actual native renders. `latest.xcresult` retains the 21 passing application checks and all three passing UI checks; `narrow.xcresult` retains the corrected narrow test and final accessibility check.
- Independent source review fixed an initializer argument-order error, a stale configuration target and name-draft loss on switching. Final review found no P0/P1.
- Early UI runs exposed the missing isolated bundle allowlist entry, feedback accessibility containment, a short-lived feedback action and a below-fold count assertion. These were corrected before the final run; early failed runs are retained locally.

The compact-device guard refused to start while a borrowed primary iPhone was already booted. That device was left running. The 320×568 native hosting snapshots are narrow-layout evidence, not an iPhone SE device run. Physical haptics, complete VoiceOver interaction and system-setting Reduce Motion gesture acceptance are not claimed from simulator tests/source review.

API references: [Apple spring animation](https://developer.apple.com/documentation/uikit/uiview/animate(withduration:delay:usingspringwithdamping:initialspringvelocity:options:animations:completion:)), [Apple impact feedback](https://developer.apple.com/documentation/uikit/uiimpactfeedbackgenerator/impactoccurred()).

## Delivery

Source merge, hosted CI, Web Production, TestFlight processing/distribution and physical installation are separate gates. Their actual results are recorded in the PR and Linear; this local record does not imply release or hardware acceptance.
