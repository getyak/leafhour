# Platform typography CI follow-up

The first PR #268 head, `57480e6c12bacebbe09a512843dd1f29603e0405`, failed its [platform typography workflow](https://github.com/getyak/leafhour/actions/runs/40922149436) for three different reasons. These are failing-run observations, not cross-platform acceptance.

## Desktop contract and checkout fixes

The [Ubuntu job](https://github.com/getyak/leafhour/actions/runs/40922149436/job/123617956047) timed out waiting for `.hero-copy h1 .hero-line`. The current authored homepage uses a direct `h1` and its story stylesheet selects Leafhour Serif; that old wrapper and the subsequent stock-sans headline expectation were stale. The anonymous failure screenshot showed the current homepage. Its receipt also recorded the root document's held Newsreader preload being retired when automatic locale entry replaced `/` with `/en`.

The harness now binds the cold-font observation directly to the existing authored `/en` document. It still requires a live intercepted font, visible actual fallback glyphs before release, and actual custom Newsreader glyphs after release. It probes the real current headline and requires Newsreader there too. Automatic root-to-locale entry is then verified separately with its observed route and language saved in the receipt. Retired interceptions are never accepted as current cold-font evidence. Product markup, CSS, font files, interception-retirement rules, viewport checks, and runner admission remain unchanged. This follow-up does not add or claim a numeric CLS result.

The [Windows job](https://github.com/getyak/leafhour/actions/runs/40922149436/job/123617956935) stopped before browser observation: the people seed loader rejected a raw SHA-256 mismatch. Unlike book originals, `catalog/people/*.json` had no byte-preserving Git attribute. Git's real Windows-style checkout filter reproduced the failure without editing the worktree: `virginia-woolf.json` changed from manifest hash `8e599ded0116eb6af71167195e6cec5f082209f8a9a0323868bca048b1ac9d74` to CRLF hash `f910e5966c6ab30ae8f9ba0fc9d7ddb18c1e52aec14cdfbb64ac137087c518dc`. The new `-text -diff` rule preserves the reviewed people seed bytes. It does not normalize data at runtime or weaken manifest validation.

The regression exercises Git's actual `core.autocrlf=true` worktree filter for every source listed by the public-book manifest and all three people seeds. Existing `.txt` and structured-world originals were already protected; people seeds were the missing scope. Embedded excerpt digests are parsed string values, while font/media hashes refer to binary assets; their owners and bytes are unchanged.

## Android installation failure

The [Android job](https://github.com/getyak/leafhour/actions/runs/40922149436/job/123617958016) failed before launching the product. The official SDK manager reported `Error on ZipFile unknown archive` while installing its missing emulator package. The typography step was skipped; absent typography evidence caused the subsequent artifact-upload error. The supplied log does not distinguish an incomplete download from another archive-preparation failure. This change does not alter Android versions, SDK installation, or acceptance gates. The next normal commit run must establish whether that external installation succeeds.

## Verification

Before either fix, the new focused regressions produced **4 tests: 1 passed, 3 failed**: the two homepage contracts and the people checkout-byte contract failed as expected. The book-original byte contract passed.

Focused command:

```sh
node --test tests/platform-home-contract.test.mjs tests/catalog-checkout-bytes.test.mjs tests/platform-font-hold.test.mjs
```

That first local checkpoint was **13 passed, zero failed/skipped**, including a negative control that rejects a cold-font probe without a live current hold. Independent review ran the preceding 12-test scope successfully before that additional preserved-gate control. Those deterministic tests execute the real homepage acceptance stanza against current authored HTML and controlled CDP boundaries, plus Git's actual worktree conversion. They do not establish Linux, Windows, Android, native browser glyph, or production acceptance. No full suite, Node installation, SDK run, browser launch, provider call, cloud data write, or CI rerun was performed during that first checkpoint. Fresh remote CI remained required.

## Second run: actual public shelf and complete focus roundtrip

The next [platform run at `21e1422`](https://github.com/getyak/leafhour/actions/runs/40923568767) passed the previous desktop startup/homepage failures. Both [Ubuntu](https://github.com/getyak/leafhour/actions/runs/40923568767/job/123622977230) and [Windows](https://github.com/getyak/leafhour/actions/runs/40923568767/job/123622976929) then timed out at the public-shelf readiness check. The Ubuntu receipt included successful cold stock glyphs, loaded Newsreader glyphs, the actual serif headline, and all three locale-menu glyph/keyboard checks, with no runtime/background errors. Its failure screenshot showed the functioning illustrated public shelf.

The public book renderer now emits `.cover-title` and `.book-title-link`; `.binding-original` and `.binding-title` belong to its older fallback bindings and are absent on these illustrated public covers. The harness now uses the actual Alice public card and visits `/library?ui=en` explicitly, so an earlier Japanese homepage visit cannot change the intended Latin punctuation probe. The real metadata title retains the stock-sans and proportional U+2019 checks. Its actual Latin cover title gets a separate custom Newsreader check. A subsequent explicit Chinese UI route checks real Chinese metadata glyphs. Both Android routes keep their independently observed native viewport checks. Missing or invisible current titles fail; no old-binding unsupported branch skips these checks.

Two short, owned macOS Chrome contexts checked anonymous source pages on an isolated server with model providers disabled. Actual CDP `CSS.getPlatformFontsForNode` returned 31 custom Newsreader glyphs for Alice's existing English `.cover-title`, and 31 stock `.SFNS-Regular` glyphs for its `.book-title-link`. An independent reviewer reproduced both results. These are node/font-owner facts on macOS, not Windows/Linux/Android acceptance. The reader's actual pill, book-info, cited emphasis, and optional gift/share nodes were also checked; their current IDs and user-open lifecycle still match the remaining harness contract, with no page exceptions. Product text and styles were not altered for these checks, and both owned browser processes were closed.

The [Android job](https://github.com/getyak/leafhour/actions/runs/40923568767/job/123622976334) successfully installed the official SDK packages, launched the owned AVD, and passed startup verification plus cold/loaded Newsreader checks. It then rejected the first Chinese homepage menu's Escape roundtrip because the immediately observed focus was not yet on the opener. `closeMenu` clears open/ARIA synchronously, while the native dialog's queued `close` event restores focus. The old observer waited only for the hidden/ARIA state before asserting focus. The receipt does not contain a later focus sample, so it does **not** prove the old Android run eventually restored focus.

The observer now waits within the same four-second bound for all closing conditions: hidden panel, collapsed ARIA, focus on the actual opener, and that opener still visible/enabled/non-inert. It sends one real Escape, preserves the URL roundtrip assertion, and never retries input. A permanently missing focus restoration still fails. This handles the permitted asynchronous close sequence without accepting a broken final focus state. Fresh Android CI must establish the actual outcome.

Second checkpoint:

```sh
node --test tests/platform-shelf-contract.test.mjs tests/platform-popover-observer.test.mjs tests/platform-home-contract.test.mjs tests/catalog-checkout-bytes.test.mjs tests/platform-font-hold.test.mjs
```

The new shelf/close regression run first produced **19 tests: 16 passed, 3 failed**: desktop shelf, narrow Android shelf, and delayed close-focus restoration. After the fixes, the combined checkpoint is **32 passed, zero failed/skipped**, including the four-second permanent-no-focus negative control. The shelf tests execute the real portal card and public cover renderers plus the real harness stanza; observer tests exercise the real keyboard sequence with controlled protocol state. No full suite, installation, SDK change, model call, account write, or manual CI rerun was performed by this agent. Source build/full-suite and new-commit remote acceptance remain separate gates owned by the main agent.

## Third run: painted reading navigation and its actual keyboard owner

At `71e2332`, the next [Ubuntu](https://github.com/getyak/leafhour/actions/runs/40925602643/job/123630145845) and [Windows](https://github.com/getyak/leafhour/actions/runs/40925602643/job/123630146098) jobs reached the reader, then timed out waiting for the reading pill to expose navigation. The Ubuntu receipt had already accepted the current shelf metadata/cover glyphs, Chinese metadata, and cited source italic glyphs. No runtime or background failure explained its navigation timeout.

An owned local Chrome context reproduced the same `DOM.focus` plus trusted CDP Enter sequence after the actual cited italic font probe. Both existing focus attempts occurred while CSS still reported `visibility:hidden`: immersion's synchronous header focus and the hub's same-click microtask focus silently failed. The pill retained focus even after navigation became visible. The observer also expected header focus exclusively, although the mounted hub intentionally moves the directory/settings actions into the actual tools panel.

The header fallback and optional hub now share one bounded, paint-qualified keyboard handoff. The hub supersedes the header request for the same activation. The handoff observes actual control/ancestor visibility, opacity, inert state and viewport geometry; it preserves the authored transitions. New input, focus, an overlay, concealment, session changes, page hiding, window blur or unmount cancel pending work. A cleanup deadline also releases work if animation frames stop. The keyboard top edge disappears when navigation opens, causing native blur to body without a new focus event; only that known disappearing opener permits the original handoff to continue. Captured descendant blur is distinguished from actual window blur. Explicit newer body focus still cancels the request.

The serialized observer now reports complete `ready` evidence. Acceptance requires expanded tools, a visible non-inert header, its actual usable book-info control, and usable focus within the header or the visible non-inert tools panel. Pill/body/outside focus, hidden/transparent/disabled/inert/offscreen controls, and unavailable book-info still fail. The actual harness gate consumes this field; it retains one native Enter and its four-second bound.

The final real-owner regression against an isolated copy of the three original `71e2332` modules produced **12 tests: 1 passed, 11 failed**. The observer regression first failed both selected contracts; the two additional top-edge refinements each had a failing regression before their fix. Final affected checks:

```sh
node --test tests/reader-tool-focus.test.mjs tests/reading-hub.test.mjs tests/reader-immersion.test.mjs tests/reader-tools.test.mjs tests/reading-toolbar.test.mjs tests/reader-location.test.mjs tests/platform-popover-observer.test.mjs tests/platform-shelf-contract.test.mjs
```

This checkpoint passed **118 tests, zero failed/skipped**. Independent reviewers checked the product lifecycle/fences and observer/harness contract separately.

The same owned native CDP sequence then passed on local macOS Chrome `156.0.8078.48`: the pill focused the actual moved `open-toc`; book-info opened, settled its paint, initialized the real enabled share control and closed gift dialog, then returned focus after one Escape with the URL preserved. Actual Newsreader italic identity used four `very` glyphs and both font responses matched checkout bytes. The screenshot visibly retained the italic source emphasis. Extra native sequences verified the top edge's header handoff and a header-only pill fallback with the optional hub stylesheet unavailable. The main reader recorded zero runtime/network errors, and the owned browser was closed. These are anonymous local source observations, not fresh Linux/Windows/Android or production acceptance. Complete host gates, generated release inventories and new-head CI remain the main agent's delivery checks.
