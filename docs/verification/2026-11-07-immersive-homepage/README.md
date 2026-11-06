# Leafhour public homepage verification

The public site now leads with real Web reading/parallel-reading captures and a real native iOS listening capture. Optional Three.js curved pages and GSAP native-scroll depth frame those surfaces. Public marketing delivery has its own small entry and stylesheet; the private library keeps its original application entry, palette and account behavior.

## Reference analysis

Observed https://www.ambi.ai/en in live Chrome on 2026-11-06: a large centered headline, foreground/background panels, changing depth while scrolling, editorial feature sections and quiet intervals. These are visual observations, not a claim about Ambi's implementation libraries. Leafhour adopts the spatial composition and pacing while retaining its own paper/green palette, typography, public-domain book and product interfaces. No Ambi artwork, branding or source was copied.

The main change from the earlier Leafhour homepage is evidence: a visitor sees the actual original/parallel reader and native listening UI, then can open the real public sample. Voice, reading translation and AI capabilities have separate explanations. The authored AI answer example is visibly labelled as an example rather than a live output or app screenshot. Browser voice preview is opt-in and labelled as a browser voice, with no recording or model request. Native screenshots use the retained November 4 build; their scope and public sample provenance are in `app/brand-assets/product/NOTICE.md`. iOS is labelled beta and links to native setup documentation because no public App Store/TestFlight URL was found.

## Measured audit results

Lighthouse 13.0.1 against the actual generated public `/zh-hans` build. Default mobile simulation and desktop preset; standard performance/accessibility/best-practices/SEO categories; no category weights or throttling reductions changed. `tools/preview-homepage.mjs` serves the build locally with gzip, public files only. This models compressed static delivery, not a completed Vercel production acceptance. Vercel documents automatic CDN compression: https://vercel.com/docs/how-vercel-cdn-works . Raw local application delivery was measured separately.

| Audit | Performance | Accessibility | Best practices | SEO |
|---|---:|---:|---:|---:|
| Initial implementation, raw local delivery | 25 | 100 | 92 | 100 |
| Public/private resource separation, raw | 48 | 100 | 100 | 100 |
| Dedicated CSS and small static fonts, raw | 81 | 100 | 100 | 100 |
| Responsive captures and small locale codec, raw | 92 | 100 | 100 | 100 |
| Final compressed public build, mobile | **96** | **100** | **100** | **100** |
| Final compressed public build, desktop | **100** | **100** | **100** | **100** |

Final category scores, timing metrics and exact audit configuration are retained in `mobile-audit.json` and `desktop-audit.json`. A preceding mobile run scored 97; the table uses the last complete run. Audits establish these measured categories, not a universal aesthetic score or real-device field performance.

## Functional and visual checks

- All four authored languages render their metadata, text and real reading links before JavaScript. Source examples retain their identity.
- English 360, 390, 768 and 1440px: no horizontal overflow; all three gallery controls fit; the AI example's return action stays within the panel. Chinese 390px and desktop paper/night views were visually inspected. `desktop.jpg` is a real browser viewport; `mobile.jpg` is the final Lighthouse capture.
- Original/parallel/example switching works; returning to the original updates pressed states. The existing four-language passage example continues to work.
- Mobile menu anchor activation closes the modal and moves to `#how`; repeated appearance opens/closes create exactly one menu. Escape closes the appearance popover.
- Reduced motion leaves the complete static product stage and skips the WebGL scene. WebGL refusal retains the CSS paper fallback. A real scroll activated `paper-orbit is-ready`; Three renders on progress updates, without an idle render loop. Scene resources and GSAP contexts are disposed on hide/navigation; the platform choreography survives leaving the hero.
- Voice stop/replay, old callback rejection and hidden-document cancellation are covered by behavioral tests. Browser voice quality and native physical-device speech quality were not equated.
- Public delivery omits the private library bundle, private dialogs and palette host; `/library` keeps its application and makes hidden marketing images lazy. New browser module paths, fonts, vendor bundles and public captures are backed by explicit release entries. Fonts/vendor bytes are integrity-pinned.

## Verification and review

Node 22.23.4 full suite: **4,807 passed, 0 failed, 14 skipped** (4,821 tests). An earlier Node 26 run exposed incompatible Node permission/reporter behavior and a checkout dependency symlink; verification was repeated using the supported Node 22 and an actual checkout-local dependency tree. No product changes were made to suppress those environment failures.

After synchronizing main (the intervening change was native iOS only), affected tests: **157 passed, 0 failed**. Hosted build, public-build integrity check, release allowlist and copy lint with the actual pinned tools passed. Existing documented copy debt remains visible. Chinese UI strings were reviewed as short interface copy; original book examples and qualifications were retained.

Independent reviews found one missing browser-module route and four lifecycle/menu/voice issues. All were fixed and the final targeted re-review reported no remaining blockers.

The live reader endpoint returned “Deployment Paused” during capture. The local scores and screenshots do not assert production availability. Merge, deployment and live acceptance status must be reported separately. No paid CI, plan upgrade or deployment quota bypass was enabled.

## Platform CI follow-up

The first Linux/Windows font run exposed a native-scroll observer defect. Its saved receipt was already at scrollTop 2470 with a quote at y=452.3125 and height=84.5 in the 90–900px padded viewport. A second center request asked for 2469.5625px, which maps to the same physical pixel at DPR 1; Chrome correctly emitted no scroll event. The observer incorrectly required one and timed out. A receipt-based regression test now requires `unchanged` at DPR 1 while still requiring real movement for the distinct half-pixel destination at DPR 2. Edge/padding and fixed-viewport guards remain strict.

The small public menu also stamps its authored language. Its CSS retains the existing byte-verified Noto CJK fallback declarations needed by public copy, so stock Linux/Windows/Android hosts without a native serif CJK face retain real glyphs; the reader keeps its full font index. The focused platform/home/typography checks passed **264/264** after these changes. Actual remote platform outcomes are separate from this local regression evidence.
