# Assessment B — GET-281 detector and browser evidence

Target source: `app/index.html` in `/Users/xiongxinwei/.codex/worktrees/get-281-reading-design/marginalia-reader`.
Live target: `http://127.0.0.1:8431/read?book=gutenberg-alice&ui=zh-Hans`.
Read: Impeccable critique Assessment B, PRODUCT.md, DESIGN.md. Assessment A report was not read. No product code edited. No account login, model calls, or personal data used.

## Deterministic results

| Pass | Primary | Advisory | Exit |
|---|---:|---:|---:|
| Static `impeccable detect --json app/index.html` | 0 | 1 | 0 |
| CDP desktop sleeping, 1280×800 | 0 | 0 | 0 |
| CDP desktop tools revealed, 1280×800 | 0 | 0 | 0 |
| CDP desktop guest conversation, 1280×800 | 2 | 0 | 2 |
| CDP mobile guest conversation, 390×844 | 2 | 0 | 2 |

Conversation has two unique rules, repeated across desktop and mobile; do not report four different issues.

1. **`low-contrast` / Low contrast text — genuine P1.** Selector: `section.library-chat-empty > button.library-chat-send`. Detector location: live target, line 0. Ratio **1.0:1**, foreground `#fdfcf8` on `#fdfcf8`. The guest action “登录后开始” is invisible on both screenshots, so the guest sees instructions to log in with no visible action. Browser computed style independently confirms foreground `rgb(253,252,248)`, transparent background, opacity 1, and a real 90×44 target. Cause: `app/library-chat.css:3` binds `--ink:var(--chat-ink)`, while `app/reader-chat-workspace.css:18` binds `--chat-ink:var(--ink)` and `--chat-strong:var(--ink)`. The cycle invalidates `--ink`, `--chat-ink`, and `--chat-strong`; `--chat-on-strong` remains paper. Fix the token ownership/cycle rather than changing the text to pass the detector.
2. **`flat-type-hierarchy` / Flat type hierarchy — contextual false positive.** Selector `body`, live target line 0. Desktop reports body 21px → h3 25px → h2 29px → h1 35px, max adjacent ratio 1.21. Mobile reports body 21px → h3 25px → h2 26px → h1 29px, max 1.19. The detector aggregates book and conversation/document semantic roles into one ladder. Rendered book heading, body, sidebar title and empty-state heading are clearly distinct and their quiet relative scale fits DESIGN.md. Do not enlarge literary headings merely to force every adjacent step past 1.25.
3. **`repeating-stripes-gradient` / Repeating-gradient stripes — static advisory, not release failure.** Raw static location is `app/index.html:0` because linked CSS is aggregated; snippet “repeating-gradient decorative stripes”. Linked sources include `app/reader-atmosphere.css:93`, `:94`, `:123`, `app/home-books.css:41`, `app/gift-compose.css:8`, `app/book-gift.css:20`. Those cover optional weather, covers and ruled gifting paper; none appears on the reviewed default sleeping reading surface. All rendered scans have zero stripe findings. Retain as contextual advisory rather than broadly deleting product semantics.

## Browser inspection and state reliability

A fresh native IAB tab was created first. The normal screenshot showed a clean paper reading surface with no sleeping shell; revealed tools and guest conversation were also inspected. IAB cannot present a visible tab from a subagent (“IAB visibility is not supported in a subagent thread”), so it stayed temporary/background and was closed after inspection.

For official CLI scans of actual states, launched an independent Chrome instance with a fresh isolated context, local DevTools port **9352**, and one fresh target tab. The port remained on localhost; the instance was closed on completion. Used the installed `impeccable detect --cdp 9352 --target 'http://127.0.0.1:8431/read?book=gutenberg-alice' --json` command. No parent browser tab/profile was reused.

The tools pass used a real completed pointer click at the top 44px edge. Focus then moved with Tab into the open tools to exercise the existing keyboard hold. `desktop-tools-after.json` confirms `data-expanded=true` after scanning; the detector was therefore inspecting tools rather than a timed-out sleeping state. Conversation JSON confirms the dialog remained open; mobile JSON confirms the mobile class and `aria-modal=true`.

Earlier attempts to click sleeping launcher/edge locators failed actionability because their pointer surface is deliberately transparent/disabled while sleeping. These were setup attempts, not claimed product failures. The document-level edge-click route succeeded. A first tools pass without keyboard hold timed out into sleep; its artifacts were replaced by the verified held-open pass.

## Overlay injection attempt — no confirmed overlay

1. Native IAB mutable preflight changed `document.title` to `[Human] …`, appended script id `get281-injection-preflight`, and read back title/script presence. Both DOM mutations succeeded. Inline script execution flag remained false.
2. Started the official `impeccable live-server --background` on localhost port 8400.
3. Appended a script with id `get281-impeccable-overlay` and src `http://localhost:8400/detect.js`. The tag was present, but no detector globals/overlay nodes appeared and native captured console returned no Impeccable messages. Read response CSP independently: `script-src 'self'` plus the existing first-paint hash excludes port 8400 and arbitrary inline scripts.
4. Therefore **the overlay did not execute and there is no reliable user-visible overlay**. Did not disable CSP or claim an overlay existed.
5. Ran official `impeccable live-server stop --keep-inject`, verified “Stopped live server on port 8400”, then closed the temporary IAB tab. This left product HTML untouched. The existing parent server on 8431 was left running.

## Console evidence

The scanner-attached browser captured **22 inline-style CSP errors**, all during initial page load and **zero additional console/page errors when opening tools, opening conversation, or switching mobile viewport**. A second fresh Chrome run with **no detector and no overlay injection** reproduced the same 22 initial-load errors. They are baseline application warnings, not injected detector failures. Most identify generated page lines 155–312; five identify `reader-atmosphere.js:24`. Full source locations/messages are in `baseline-console.json`. No Impeccable overlay console findings are available because injection was blocked.

These console warnings are a separate hardening observation. Their visible impact on the reviewed default paper route was not demonstrated, so do not claim the reader failed or broaden GET-281 into a CSP rewrite without checking the affected element.

## Artifacts

All JSON, screenshots and stderr files: `output/playwright/get281-detector/`.

- `source.json`
- `desktop-sleeping.json`, `desktop-sleeping.png`, `desktop-sleeping-state.json`
- `desktop-tools.json`, `desktop-tools.png`, `desktop-tools-after.json`
- `desktop-conversation.json`, `desktop-conversation.png`, `desktop-conversation-after.json`
- `mobile-conversation.json`, `mobile-conversation.png`, `mobile-conversation-after.json`
- `guest-button-computed.json`
- `browser-console.json` (scanner run) and `baseline-console.json` (detector-free reproduction)
- `baseline-desktop-conversation.png`, `baseline-mobile-conversation.png`

Assessment B is complete. Reuse these detector results; rerun only affected passes if the source changes, especially after fixing the guest button token cycle.
