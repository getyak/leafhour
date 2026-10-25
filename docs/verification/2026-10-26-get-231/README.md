# GET-231 reader cleanup

Scope: [GET-231](https://linear.app/getyak/issue/GET-231), public `getyak/leafhour`, isolated `codex/get-231-b2` checkout. Baseline main is `0329f9c26fee75dc5bb05257908a6729ea1738e3`. GET-219/220/221 behavior is retained. Related progress work is GET-226 (GET-227 is command search); neither that issue nor parent GET-222 is changed.

## Baseline and contract

Native Linear MCP verified the GetYak workspace, GET team, issue UUID, full description, relations and its two screenshots. Original screenshots remain local. The live 1280×800 English reader was at `8b9838ddeab579c6a050021216785ef383635f87`, older than main. Its scene thumbnails load successfully after opening the native dialog, but have an unlabelled empty loading area and no failed-image recovery. Just the page still exposes inactive sound controls and asks for a scene. The screenshot identified as B2 actually shows a generated `§2` in Thought; user prose and source metadata must remain intact.

The actual main reader was served from a Git archive, with an isolated synthetic account and public-domain Alice. Its baseline replay confirmed visible quiet-mode prompts, absent read ARIA/reload feedback, absent header location and no account entry. The original mark action met 4.5:1 in the measured paper configuration, but lacked a persistent visible read state. A blanket claim that all old configurations failed contrast would be incorrect.

## Implementation

- Artwork displays real loading/error status and an independent image retry. Retrying does not choose a scene or start sound. No-scene hides unused playback controls and prompts in both the Atmosphere dialog and settings, while a real storage notice remains visible.
- Existing chapter marks expose `aria-pressed`, an explicit check and readable opaque controls. The header chapter chooser uses the existing chapter fraction and updates through the original chapter navigation path; no additional progress listener, timer or record writer exists. Opening existing reading tools reveals that same header in immersive mode.
- The reader account dialog uses the captured reader identity and existing request transport, with guest login return, keyboard/touch/Escape/outside dismissal, focus return, explicit logout confirmation and recoverable failure. It loads on activation. A late module cannot replace newer focus, popover or concealed tools intent; a module failure has an explicit fresh-URL retry.
- Owner validation occurs inside the existing local/hosted session revocation transaction. A stale owner cannot revoke the cookie's other account. Provider verification is not a logout prerequisite; remote session revocation retains the existing explicit local scope and best-effort behavior. No provider, permission, schema or billing changes are made.
- Thought suppresses generated section labels and uses page-only translations for actual printed/PDF pages. Section IDs, original B2 text and language-level data remain unchanged.

## Review and regression

Eight initial checks failed against the original implementation before source changes. Independent reviewer `/root/get231_review` found four P2 issues (late account import, settings quiet-mode bypass, logout outage dependency, numbered page labels); each received failing regressions, a fix and independent recheck. The reviewer reported no unresolved P0/P1/P2 and independently passed 43 targeted checks. It also caught the first contrast probe using paper rather than the button's panel; final probes compose actual computed ancestor backgrounds.

The first full local run is retained: 3440 pass, 9 fail, 1 skip. All nine failures came from the old audio fixture treating every grid child as a scene button; the new retry wrapper changed that DOM shape. The fixture now finds the actual nested scene buttons, preserving all real audio expectations; the focused combination passed 39/39. The one existing skip is the Linux-only pinned-Node-license mutation on macOS.

Further independent and real-browser regressions closed the short viewport audio overlay, the 44px back-link hit area, and pending mark-focus listener ownership. Chapter marks now retain keyboard focus after the asynchronous save without stealing a later focus intent; unresolved transports synchronously release their focus trackers on session disposal. At 200% equivalent layout (640×400 CSS pixels on a 1280×800 viewport with DPR 2), the account entry remains reachable with the existing audio dock and translation notice, including their combined state. These dock class probes are synthetic geometry tests, not provider acceptance.

The first final matrix stopped after 30 successful cases because the next synthetic login correctly returned HTTP 429. The final matrix is split into sub-batches below that existing limit; neither production authentication nor throttling was weakened. Screenshots wait for finite native dialog animations to finish before capture. Thought scroll comparisons wait for the existing smooth-scroll arrival to settle; they do not force scroll or change application behavior. Native mouse text selection is established before testing typed quote retention.

The same main source and exact browser versions provide the console/lifecycle baseline. Existing CSP inline-style diagnostics and local disabled-audio 503s remain visible and are compared by message/path. No CSP permission is relaxed. A synthetic non-persisted pagehide compares actual reader disposal: baseline retains one existing presence interval; new surface listeners and timers must be zero. Browser contexts, browsers and the local server close in finally blocks.

Final local, build and delivery receipts follow. Local fixtures do not constitute real Production acceptance.

## Final local validation

- Complete serial suite: **3453 passed, 0 failed, 1 existing platform skip** (3454 tests, 189.39s). Native PostgreSQL was an isolated task-owned instance; no Docker, iOS simulator or model provider was started.
- Browser matrix: **64/64** ordinary/scene cases across Chromium 153.0.8010.12 and WebKit 26.6, widths 1280/390/320, four UI locales and paper/night themes. **6/6** additional desktop, narrow and 200%-equivalent boundary cases passed. The measured mark contrast range is **12.73–14.09:1**. See the machine-readable reports in `browser/`.
- Copy export, pinned Vale 3.24.0/textlint 15.8.0 lint, planted-violation canaries and pricing checks passed. Existing documented debt and warnings remain explicit. The initial shallow-clone copy failure was resolved by fetching the same frozen public source object required by CI, without changing debt rules.
- The final single-line close-button CSS has a separate four-locale narrow replay and Japanese logout-boundary replay; those results, exact built-entry checks and engineering receipts will be appended after completion.

[Independent review](review.md) binds all 26 source/test/tool hashes in [the manifest](source-fingerprints.json). The source manifest, test log and browser reports are preserved here; original issue screenshots remain local and unpublished.
