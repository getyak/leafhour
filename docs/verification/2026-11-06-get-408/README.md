# GET-408 · Pull to bookmark

The issue screenshot and the existing entry point are the native iOS reader. This change updates that entry point; Web has no matching pull-to-bookmark gesture and is unchanged. Device bookmarks remain separate from private notes and retain their source/display anchors, identifiers, names, colors and export format.

## Behavior

- The paper follows a downward paged-reading gesture with bounded resistance, then returns with a damped spring on release or cancellation. Layout and pagination stay fixed. Continuous text/PDF uses the existing UIScrollView rubber band and receives no extra displacement. Zero overscroll stays idle; scrolling into the document revokes the touch before a reversal can return to the top.
- A progress ring and release label expose the 72-point threshold. Existing 56-point hysteresis remains. Returning more than 18 points from the peak, departing horizontally, losing context, cancellation, multitouch and invalid coordinates cannot commit or rearm until the next touch.
- Threshold feedback is prepared once per touch. A light success impact runs only after a new bookmark has actually persisted. An existing bookmark retains its configuration.
- Success offers a direct configuration action for five seconds (ten with VoiceOver). Common colors and the optional name share the first section; custom colors are folded away. Done, changing the selected bookmark and jumping first persist a name draft. A failed write retains the editor for retry.
- Reduce Motion disables the added paper displacement and spring. VoiceOver retains the existing explicit add action and button; gestures do not own selection, links or long presses. Color choices also expose names, checks and selected state. Preset targets are at least 44 points and switch to two columns at accessibility text sizes.

## Verification

Local output is kept in the registered GET-408 artifact directory, with an isolated Debug app identity. All content is synthetic; no real account, uploaded book, cloud generation or paid model was used.

- LeafhourCore: 420 tests, two explicit user-selected-fixture skips, zero failures. Includes resistance/progress/reset, long reversal, invalid coordinate and new-touch regression cases, together with existing persistence, idempotence, export and translated/PDF/image-anchor tests.
- Native vendor hashes: passed. Release contracts: 105 Node tests and 11 Python tests passed; archive/upload shell syntax passed.
- Final native run: 23 application tests and three iPhone 17 Pro / iOS 26.5 UI tests passed, zero failures (`verified-latest.xcresult`). This includes paged/continuous gesture ownership, native selection and links, translated/PDF/image anchors, 320×568 normal/accessibility layouts, pull/save/configure, repeated pull retaining a single name/color, short cancellation, and accessibility-size quick configuration.
- The final scroll-boundary core run again passed all 420 tests with the same two explicit fixture skips. The final incremental source review found no P0/P1.
- Narrow and accessibility [screenshots](../../../apps/ios/verification/2026-11-06-get-408/) are actual native renders. The selected check symbol stays inside its swatch at the largest accessibility size.
- Independent source review fixed an initializer argument-order error, a stale configuration target and name-draft loss on switching. Final review found no P0/P1.
- Early UI runs exposed the missing isolated bundle allowlist entry, feedback accessibility containment, a short-lived feedback action and a below-fold count assertion. A narrow-test setup also needed an explicit synthetic source anchor, and the continuous-mode test now inspects the real recognizer instead of a private coordinator member. These were corrected before the final run; early failed runs are retained locally. A valid shared iOS lock caused a 600-second queue timeout before test startup; the supported 3600-second wait completed without interrupting another task.

The compact-device guard refused to start while a borrowed primary iPhone was already booted. That device was left running. The 320×568 native hosting snapshots are narrow-layout evidence, not an iPhone SE device run. Physical haptics, complete VoiceOver interaction and system-setting Reduce Motion gesture acceptance are not claimed from simulator tests/source review.

API references: [Apple spring animation](https://developer.apple.com/documentation/uikit/uiview/animate(withduration:delay:usingspringwithdamping:initialspringvelocity:options:animations:completion:)), [Apple impact feedback](https://developer.apple.com/documentation/uikit/uiimpactfeedbackgenerator/impactoccurred()).

## Delivery

Source merge, hosted CI, Web Production, TestFlight processing/distribution and physical installation are separate gates. Their actual results are recorded in the PR and Linear; this local record does not imply release or hardware acceptance.
