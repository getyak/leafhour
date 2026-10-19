# GET-192 audio boundary implementation evidence

Implementation base: `df45f6ffb5d14c903b2feaca2742e7ec0fcb3be2`.
This is local implementation evidence, not GET-192 delivery or Production acceptance.
The [narrow design amendment](../superpowers/specs/2026-10-20-get-192-audio-boundary.md)
records the exact graph and lifecycle contract.

## Executed verification

- TDD RED: `node --test tests/audio-boundary.test.mjs` initially failed its only
  test with `pure explicit mount export`; there was no exported pure factory.
- The same initial test became GREEN after the explicit factory transformation.
- The related scope below passed **261 tests, 0 failures/cancellations**, using
  `--test-concurrency=1`. It includes the existing 81 complete-owner tests and all
  58 scene counterexamples, 62 bootstrap tests at that point, and 25 graph tests.
- Self-review then changed production lifecycle code: bootstrap now forwards the
  real pagehide synchronously before invalidating/disposal, deduplicates that
  event, and keeps action guards local to each async operation rather than in
  global state across awaits. Targeted lifecycle/intent checks passed **19/19**;
  a final partial-setup/transport/legacy-entry subset passed **5/5**. The full
  261-test scope was not rerun after these changes. The final bootstrap file has
  65 test cases, including the added pagehide and clean-retry cases.
- All **1935 existing keys per catalogue** compare exactly to the base; only
  seven `audioBootstrap.*` keys were added. The five approved scene functions
  (`captureAudioScene`, `acceptAudioScene`, `loadedSceneQuestion`,
  `askAudioScene`, `showAudioSources`) remain byte-identical to the base.
- Local synthetic HTTP GET/HEAD checks serve the controller, its fixed retry URL,
  bootstrap, metadata helper and raw dependencies with matching bytes. These are
  synthetic loopback fixtures; no real accounts, credentials, books, provider
  calls, browsers, Simulator, Docker, or external writes were used.

Related-scope command:

```sh
node --test --test-concurrency=1 \
  tests/audio-boundary.test.mjs tests/audio-boundary-graph.test.mjs \
  tests/ui-locale-reader-audio.test.mjs tests/audio-ui.test.mjs \
  tests/ui-locale-audio-transport.test.mjs tests/reader-controls.test.mjs \
  tests/reader-navigation.test.mjs tests/audio-state.test.mjs \
  tests/listening-guide-state.test.mjs tests/ui-locale-graph.test.mjs \
  tests/ui-locale.test.mjs tests/ui-locale-ui.test.mjs tests/ui-locale-lazy-ui.test.mjs
```

## One actual build, explicitly before the final self-review fixes

There was **one** actual `buildReaderWeb` invocation. It passed on the source
snapshot identified in the accompanying JSON `buildSourceHashes`. Production
changed afterward as described above; **these numbers are not a build of the
final commit**. The parent must build the final integrated source again.

| Artifact | Measured source snapshot | Unchanged cap |
|---|---:|---:|
| Initial compiled JS | 309259 B | 327680 B |
| Initial compiled CSS | 170141 B | 204800 B |

The complete **static initial JS graph** for that English build snapshot is
488531 B across five modules (compiled entry, locale runtime/codec/English, and
arrival catalogue). Static CSS, including the existing external CJK font-face
stylesheet, is 263360 B across two files. These totals expose external initial
assets; the unchanged compiler caps above apply to its emitted JS/CSS artifacts.
A non-English route adds its selected catalogue. These are uncompressed graph
bytes; font binaries, transport compression and actual startup requests were not
measured.

The parent measured the immutable base at 338400 B JS. The built implementation
snapshot therefore saved **29141 B**. These are actual compiled file sizes,
not the earlier speculative 32953 B saving. The compiler input graph contains
neither `reader-audio.js` nor `ui-locale.mjs`. The existing API and navigation
remain compiled once; raw audio imports neither.

At that build snapshot, the six additional cold audio source modules total
**58519 B**. The full possible raw closure, including the already existing
locale runtime/codec and all four catalogues, is **12 files / 616213 B**.
This is source-graph arithmetic, not measured browser network requests/latency.
The active locale runtime/catalogues are reused, and audio does not load all
inactive dictionaries. Both full closure and additional-file details are in the
[JSON receipt](2026-10-20-get-192-audio-boundary.json). Subsequent lifecycle fixes
change the controller/bootstrap byte sizes; final build figures remain pending.

## Review and remaining acceptance

Self-review checked shared API/metadata identity, readiness rather than a started
flag, restoration priority and unchanged request payload/idempotency key, no
restore autoplay, original file-stage ordering, exact raw public dependencies,
and rollback/disposal. The original invalid guide-marker priority remains: a
nonempty guide marker takes precedence; the existing runner validates its ID and
does not silently fall through to a pending request or position. This does not
create new work or alter markers.

The importer cannot cancel native code evaluation; stale results cache code only.
Actual browser first-gesture picker activation, selection/focus and 503 retry
remain unmeasured here. Synthetic loader retry is not proof of native module
cache recovery. Parent independent review, final source build/full tests, native
acceptance, current-head CI, merge, Production and live verification are required.


## Independent review fix round 1

Repair base: `1b314b9e2818c6ccc6c5fcc8a8dbecc4df7ff401`.
The independent review found R1–R6: canceled initialization resumed deferred
restoration; the newly released test fixture lacked a selected dependency; real
selection-end did not invalidate pending source input; body-sibling loading
controls were inert behind a native modal; viewport height was captured at mount;
and stale export errors could alter a replacement panel. All six were confirmed
against the actual owners and addressed in this repair. Review closure remains
subject to the parent's independent re-review.

- Re-ran the original five independent counterexamples unchanged: **0 PASS / 5
  FAIL**, then after fixes **5 PASS / 0 FAIL**. The original release gate was
  **5 PASS / 1 FAIL**; after adding only `tests/reader-audio-fixture.mjs`, it was
  **6 PASS / 0 FAIL**. The earlier broad statement that the selected release
  closure was already complete was incorrect; this round verifies the real gate.
- Retained those five counterexamples in `tests/audio-boundary.test.mjs` and added
  14 related actual-owner regressions (19 new cases total). These cover deferred
  restore stages, retention of completed playback, clean remount with original
  payload, the dispatcher's own dismissal versus later selection-end, modal
  controls/focus/close, changed viewport follow visibility, and stale export
  resolve/reject without a replacement-panel error or object-URL creation.
- An additional stacked-modal case first failed (**1 PASS / 1 FAIL** with the
  viewport case); tracking all originally open dialogs fixed it. The lifecycle
  subset then passed **72/72**, including that case and the original five. A
  final added remount case passed **1/1**. The file now contains 84 cases; no
  fresh claim is made that all 84 ran together.
- Legacy audio, exact audio graph and release gates passed **44/44**. Five
  approved scene functions remain byte-identical to the original base, and all
  four catalogues retain exactly the original 1935 values plus seven new keys.
- No full suite or new build was run in this round. The single build recorded
  above still predates these production changes. Parent final integrated build
  must enforce the unchanged caps. Modal tests establish actual DOM ownership and
  synthetic focus behavior, **not native pointer/keyboard/top-layer acceptance**.

Focused repair commands (serial, task TMPDIR):

```sh
node --test --test-concurrency=1 <original-counterexamples.test.mjs> tests/release.test.mjs
node --test --test-concurrency=1 --test-name-pattern='review R|first |pending |restore|restoration|file |partial |pagehide|BFCache|repeated direct|intent before|original records' tests/audio-boundary.test.mjs
node --test --test-concurrency=1 tests/audio-ui.test.mjs tests/audio-boundary-graph.test.mjs tests/release.test.mjs
node --test --test-concurrency=1 --test-name-pattern='canceled initialization can' tests/audio-boundary.test.mjs
```


## Independent review fix round 2: R7 reader event integration

Repair base: `f351e7bc40182e119650ab5da25ecd0070cf5053`. The first re-review
closed R1–R6 at its source/focused-test level but found R7: a Retry click outside
a modal reached the reader's real document click callback, which dismissed the
selection and canceled that very retry. The module's second request ran, but the
prepare count was zero.

The unchanged independent Acorn-extracted real reader callback probe reproduced
**0 PASS / 1 FAIL**, then passed **1/1** after the four precisely authorized
`#audio-bootstrap-status` selector exclusions. Eight new regression cases use
the actual reader click/pointerup/keyup/keydown callbacks and actual
`dismissTools` with the bootstrap. Before the production fix they returned
**1 PASS / 7 FAIL**; ordinary outside interaction was the sole passing case.
After the fix, the R7 tests plus existing R3/finite-retry checks passed **13/13**.
Existing reader control tests passed **9/9**.

Tests cover both source-action retries exactly once, Retry/Cancel/Reload click
and keyboard/pointer isolation, a later outside click or independent
selection-end canceling the waiting retry, and unchanged outside reader
pointer/keyboard effects. These are actual-owner event integration tests using
explicit target-to-document callback ordering; they are not native browser
pointer/keyboard receipts. No bootstrap selection listener or propagation rule
was weakened. Only four existing reader selector strings changed in production.

```sh
node --test --test-concurrency=1 <independent-fix-round-1-integration.test.mjs>
node --test --test-concurrency=1 --test-name-pattern='review R7|review R3|real reader selection-end|explicit retry consumes|second native loader failure' tests/audio-boundary.test.mjs
node --test --test-concurrency=1 tests/reader-controls.test.mjs
```

Syntax and diff-whitespace checks passed. No whole-suite run or new build was
performed; the earlier build remains inapplicable to this source. Independent
round-2 re-review and all final integrated/native/delivery gates remain open.


## Integration fix round 3: shared focus-ring ownership

Repair base: `7ef9f08d8aecaa460cf416461900cf10df52193f`. The parent full-suite
run found a competing focus outline in the new audio recovery surface. A fresh
local run of the existing `tests/component-foundation.test.mjs` reproduced
**12 PASS / 1 FAIL**: `reader-audio.css declares a competing focus outline in
.audio-bootstrap-status button:focus-visible`.

Removed only that local `focus-visible` rule. Recovery buttons continue to use
`app/interface-tokens.css`'s shared button rule with `--focus-ring-width`,
`--focus-ring` and `--focus-ring-offset`; no keyboard focus was removed and no
test exemption or token/contrast requirement changed. The existing component
foundation and audio graph tests then passed **38/38**, including stylesheet
parsing, single-owner focus enforcement and the shared ring's 3:1 contrast
across the reviewed local palettes.

```sh
node --test --test-concurrency=1 tests/component-foundation.test.mjs
node --test --test-concurrency=1 tests/component-foundation.test.mjs tests/audio-boundary-graph.test.mjs
```

Only the audio CSS and verification evidence changed. No new full suite, build,
network or native acceptance run occurred; parent final integration and delivery
gates remain required. The older build still does not apply to this source.


## Native follow-up: canonical voice labels and descriptions

Base: `7e8e9edc40456876d91fadadf1bab87032ce4a83`. Parent native acceptance found
that canonical Kore still displayed `沉稳` in English. New actual-owner tests
using the service's four real fixed definitions reproduced **2 PASS / 3 FAIL**;
with the pure exact-pair descriptor helper they pass **5/5**. They cover eager
English→Japanese summary without importing audio; mounted Kore selection,
options and descriptions across four locale changes without API/preferences/
reader/media effects; player metadata; and known-ID customized/unknown prose
remaining literal. The helper is checked against actual media configuration
created with an empty synthetic environment, without credentials or providers.

Exact audio graph plus legacy tests passed **38/38**; four existing complete-owner
voice/media/record/literal-content tests passed **4/4**. All five frozen scene
functions are byte-identical. Every existing 1942 catalogue entry in this child
base is unchanged; exactly eight voice keys were added per catalogue. Parent's
separate portal keys and hidden-label index edit are outside this child patch.

One newly authorized exact child `buildReaderWeb` passed on the final production
source for this patch: **310984 B JS / 170196 B CSS**, with unchanged caps
327680 / 204800. The possible raw closure is **13 files / 620627 B**, including
all possible dictionaries; it is source-graph size, not measured network traffic.
Only the existing pure metadata module was added to the exact raw allowlist.
This new build applies to the child patch source; parent still builds its final
integrated source independently. Older build figures earlier in this document
remain explicitly historical.

```sh
node --test --test-concurrency=1 --test-name-pattern='canonical voice UI' tests/audio-boundary.test.mjs
node --test --test-concurrency=1 tests/audio-boundary-graph.test.mjs tests/audio-ui.test.mjs
node --test --test-concurrency=1 --test-name-pattern='voice, speed|actual audio owner preserves|historical errors|saved records' tests/ui-locale-reader-audio.test.mjs
```

No browser, real account/provider, recursive delegation, source/scene behavior,
API/cache/default/idempotency change or parent index edit occurred. Limited
independent review and final parent delivery/native gates remain required.
