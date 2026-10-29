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

The final local result is **13 passed, zero failed/skipped**, including a negative control that rejects a cold-font probe without a live current hold. Independent review ran the preceding 12-test scope successfully before that additional preserved-gate control. These deterministic tests execute the real homepage acceptance stanza against current authored HTML and controlled CDP boundaries, plus Git's actual worktree conversion. They do not establish Linux, Windows, Android, native browser glyph, or production acceptance. No full suite, Node installation, SDK run, browser launch, provider call, cloud data write, or CI rerun was performed for this follow-up by its implementation agent. Fresh remote CI remains required.
