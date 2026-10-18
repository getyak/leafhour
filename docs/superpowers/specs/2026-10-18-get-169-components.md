# GET-169 component foundation — settled design (GET-181/182/183/185)

Status: implemented on the GET-169 worktree baseline `b542cbe`, including the
confirmed independent-review repairs. This document records the final design
and the exception inventory. All contrast numbers are WCAG arithmetic computed
from source token values, not rendering measurements; real browser acceptance
stays with the parent (see the verification record for the exact gates).

Canonical source: parent design decision `get169-design-decision.md` (read-only)
plus the repair feedback. Scope excluded: GET-184 reader launchers, reader
first-scroll, filters/palette/URL state, the markdown parser, language-wide
redesign, mobile navigation, MCP layout redesign.

## 1. Shared module

`app/interface-tokens.css` is the small shared module. It is loaded on every
product page (home/library, reader, gift, privacy, mcp, **and** the technical
tools source-review and evals) and owns:

- the two interface line tokens `--line-hairline`, `--line-control`,
- the green-toned shadow family `--shadow-popover`, `--shadow-modal`,
- the brand focus ring `--focus-ring` (+ width/offset/halo) and its input
  variant,
- the action vocabulary (`--action-radius`, `--action-target`,
  `--action-text`) and the canonical pills,
- the appearance popover chrome used by `app/site-appearance.mjs`.

**Local palette derivation.** Static tokens (shadows, radii, widths) live on
`html`; every derived token (`--focus-ring`, `--focus-ring-halo`,
`--line-hairline`, `--line-control`) is declared in one
`:where(*)` block so it re-resolves against the palette actually surrounding
each focused control, not only the document root. Action foreground is a separate
inherited token with an html default and local palette overrides. Locally scoped palettes bind
their own aliases: the chat dock (`--ink:var(--chat-ink); --accent:
var(--chat-accent); --paper:var(--chat-panel); --line:var(--chat-line)` on its
dialog/launcher/companion roots, light and dark), support (`discovery.css`
day/night `--paper/--ink/--line/--accent` aliases), source-review and evals
(their existing colours as day/night palette values). One focus formula, local
bindings; no ad-hoc per-surface rings.

Routes registered: `server/portal.mjs`, `server/server.mjs` reader asset map,
`release-files.json`, plus one `<link>` per HTML page including
`source-review.html` and `evals.html`. `tools/build-vercel.mjs` needs no
change: the hosted build copies `app/` and the reader bundle test confirms the
module joins the single bundled reader stylesheet in order.

## 2. Actions (GET-181)

One solid primary pill, one paper/hairline secondary pill, quiet text
navigation. The vocabulary covers every real source class: `.primary`,
`.gift-primary`, `.public-primary`, `.reading-primary` (manual-reading, guide,
ending), `.share-primary` (share export), `.echo-submit` (echo), `.audio-primary`/`.audio-secondary`, the dynamic note form submit, chapter-end
actions, chat login/back actions, and secondary `.outline`/upload/share
actions; `.text-link` stays quiet navigation. All pills share `--action-radius`,
theme-aware text (the root default is inherited so local night foregrounds
are preserved), hover/pressed feedback and the brand focus ring. Committing
pill actions use brightness and 1px press travel; contextual chat actions keep
their own local palette and feedback. Layout/type stay with each surface.

- The header sign-in `#account-button` is now the paper/hairline secondary
  pill: the competing `border-radius:6px` and the `border:0` +
  `--interaction-fill` override were removed at their source, hover/pressed
  feedback is explicit.
- Conflicting source shapes removed: portal.css (two competing `.primary`
  definitions with 3px/6px radii, hover lift), auth.css (auth-green button),
  gift-compose.css/book-gift.css (handmade radii and drop shadow),
  discovery.css (4px `public-primary`), library-craft.css (handwritten
  `2px 5px 3px 4px` primary with drop shadow), reading-session.css/share.css/
  experiences.css (independent 6px/4px primaries), interaction-craft.css (two
  night auth-primary overrides). A test asserts no source keeps a competing
  action radius on these classes.
- Normal controls target `--action-target: 44px`. Stateful controls keep their
  own shape vocabulary and are deliberately not pills: shelf tabs, calendar
  date cells, theme swatches, radio cards (`.appearance-choice`, stance
  choices), type steppers, toggles, range inputs.
- Manual-reading, guide, ending, share export and echo behavior are unchanged.
- Reduced motion disables hover/press transitions and the 220ms theme colour
  fade; home-motion's entrance craft keeps its own guard.

## 3. Focus (GET-182)

- One brand ring: `--focus-ring: color-mix(in srgb, var(--accent) 72%,
  var(--ink))`, `outline: var(--focus-ring-width) solid var(--focus-ring)` at a
  3px offset on `button, a, summary, select, input, textarea, [tabindex],
  .passage`. The outline follows each element's corners. The conflicting
  `.passage{outline:none}` reset that cancelled the paragraph ring (same
  (0,1,0) specificity, later in source) was removed; no at-source rule cancels
  the shared ring on a keyboard stop.
- One coherent input variant at low specificity (type exclusions live inside
  `:where()`): a halo `box-shadow` on focus, and a `border-color` join that
  explicitly excludes `[aria-invalid=true]`, so aria-invalid keeps its semantic
  red border while the outer keyboard ring stays brand. Wrapper focus variants
  (sidebar search, chat composer) keep their documented ring-around-the-field
  treatment.
- The 72% accent mix is verified arithmetically against the actual adjacent
  surfaces of every local palette (37 pairs; arithmetic, **not** rendering):

| palette | accent | ink | ring = 72% accent + 28% ink | adjacent surface | ratio |
| --- | --- | --- | --- | --- | --- |
| site paper | #365b45 | #263b32 | #325240 | --paper #f7f5ef | 7.97:1 |
| site paper | #365b45 | #263b32 | #325240 | --surface #edf0e7 | 7.54:1 |
| site paper | #365b45 | #263b32 | #325240 | --surface-soft #f0f1eb | 7.65:1 |
| site night | #a8c395 | #e7ece3 | #baceab | --paper #19221c | 9.72:1 |
| site night | #a8c395 | #e7ece3 | #baceab | --surface #253126 | 8.09:1 |
| site night | #a8c395 | #e7ece3 | #baceab | --surface-soft #202b22 | 8.74:1 |
| reader paper | #3f594c | #292a25 | #394c41 | --paper #faf9f5 | 8.73:1 |
| reader paper | #3f594c | #292a25 | #394c41 | --wash #f0f0e9 | 8.03:1 |
| reader paper | #3f594c | #292a25 | #394c41 | --panel #fdfcf8 | 8.96:1 |
| reader night | #b0c5b5 | #e4e5dc | #bfcec0 | --paper #181b19 | 10.59:1 |
| reader night | #b0c5b5 | #e4e5dc | #bfcec0 | --wash #252b25 | 8.83:1 |
| reader night | #b0c5b5 | #e4e5dc | #bfcec0 | --panel #1d221e | 9.85:1 |
| reader warm | #775535 | #373027 | #654b31 | --paper #f5efdf | 7.03:1 |
| reader warm | #775535 | #373027 | #654b31 | --wash #ece4d2 | 6.37:1 |
| reader warm | #775535 | #373027 | #654b31 | --panel #fbf7ec | 7.53:1 |
| reader mist | #466569 | #293334 | #3e575a | --paper #edf0f0 | 6.75:1 |
| reader mist | #466569 | #293334 | #3e575a | --wash #e1e7e7 | 6.18:1 |
| reader mist | #466569 | #293334 | #3e575a | --panel #f5f7f7 | 7.19:1 |
| reader leaf | #47673d | #29372c | #3f5a38 | --paper #eaf2e7 | 6.72:1 |
| reader leaf | #47673d | #29372c | #3f5a38 | --wash #dce9d7 | 6.11:1 |
| reader leaf | #47673d | #29372c | #3f5a38 | --panel #f3f8ef | 7.13:1 |
| gift paper | #385b48 | #29463c | #345545 | --paper #ecefe5 | 7.13:1 |
| gift paper | #385b48 | #29463c | #345545 | --sheet #f7f4e7 | 7.53:1 |
| support day | #365b45 | #263b32 | #325240 | --paper #f7f5ef | 7.97:1 |
| support night | #365b45 | #e3eade | #668370 | --paper #18251f | 3.81:1 |
| source review day | #315d49 | #24352d | #2d5241 | --paper #f6f5ef | 8.03:1 |
| source review night | #b1d6b7 | #e0e9de | #bedbc2 | --paper #17221c | 11.00:1 |
| evals day | #315548 | #292c28 | #2f4a3f | --paper #faf9f5 | 9.18:1 |
| evals night | #b4cdb9 | #d9ded7 | #bed2c1 | --paper #1b201d | 10.37:1 |
| chat light | #35584d | #282e2a | #314c43 | --chat-panel #ffffff | 9.35:1 |
| chat light | #35584d | #282e2a | #314c43 | --chat-soft #f3f4f1 | 8.47:1 |
| chat dark | #adc6b5 | #e8ece8 | #bed1c3 | --chat-panel #242826 | 9.31:1 |
| chat dark | #adc6b5 | #e8ece8 | #bed1c3 | --chat-soft #303632 | 7.71:1 |
| auth day | #304e3e | #26382f | #2d483a | --auth-paper #fffdf7 | 9.83:1 |
| auth day | #304e3e | #26382f | #2d483a | --auth-field #fffefa | 9.91:1 |
| auth night | #c0d0ad | #e6ebde | #cbd8bb | --auth-paper #253127 | 9.10:1 |
| auth night | #c0d0ad | #e6ebde | #cbd8bb | --auth-field #202b23 | 9.84:1 |

  Minimum 3.81:1 (support night on its paper), every pair ≥ 3:1. The chat
  rows cover the real "OS dark + reader warm/mist/leaf" combination: the chat
  dock switches to its own dark palette while the page palette stays warm, and
  the ring resolves against the chat palette locally. The previous matrix had
  23 pairs (an earlier count of 24 was wrong); the repaired matrix adds
  support day/night, source review day/night, evals day/night and chat
  light/dark; the final matrix also covers authentication paper/field day and night. `tests/component-foundation.test.mjs` recomputes all of it from
  the palette sources, so drift fails the suite.

- Contradictory focus rules were removed at their source across portal, styles,
  auth, book-gift, discovery, gift-compose, library-*, reader-*, reading-*,
  share, experiences, source-review and interaction-craft. The source-review
  amber ring (`outline:3px solid #c78d2d`) is gone. The audit now also rejects
  any competing `:focus-visible` outline that is not the shared ring token,
  forced-colors `Highlight`, or `none`, and it covers evals.css and
  source-review.css instead of excluding them.
- Pointer-opened dialogs: every static `<dialog>` in `app/home.html` and
  `app/index.html` carries the HTML-spec-recommended `autofocus` attribute on
  the dialog element. This is static markup intent only; it does not prove
  that the close button will be bypassed. Actual focus destination can be overridden
  by page JavaScript (`library-shell.mjs` `openSettings` focuses the selected
  tab, `share.js` focuses its close control) and JS-built dialogs
  (`pdf-preview-dialog`, `atmosphere-dialog`) are separate code paths — those
  are parent-owned; actual observations are recorded separately in the verification document. Modal trapping
  and close-time focus restoration in `interaction-craft.mjs` are untouched;
  `tabindex` is never set on dialogs.

## 4. Hairlines and shadows (GET-183)

Tokens (derived from the palette's green-toned ink/line/accent, re-resolved
per element, so night and every local palette stay in family and quiet):

- `--line-hairline: color-mix(in srgb, var(--ink) 8%, transparent)` —
  separators, dividers, panel and dialog edges. This low ink alpha keeps the
  sage library quiet instead of amplifying its darker decorative line colour.
- `--line-control: color-mix(in srgb, var(--line) 82%, var(--accent))` —
  interactive borders (inputs, selects, secondary pills, drop zones).
- `--shadow-popover` / `--shadow-modal` — one green-toned family
  (`rgba(31,52,38,…)`) for popovers/menus/panels and modal sheets.

Applied at the original source in the named surfaces: homepage/portal, library
(shell, craft, workspace, personal, filters, daily-reading, chat), settings and
reader controls (styles, reader-settings, reading-session, reader-navigation,
reader-audio, reader-atmosphere, reader-pagination, reader-companion), calendar
(portal reading dashboard/calendar), filter (library-filters), support
(discovery), gift (book-gift, gift-compose), share (`share.css` headings,
selects, details, action buttons) and experiences (`experiences.css`
xray/response/feedback/chat-answer separators, echo textarea, clipboard
fallback).

**Exception inventory** (deliberately not converted to the line/shadow tokens):

1. Semantic strokes: focus rings and the input variant, error/invalid borders
   (`--interaction-error`, `[aria-invalid=true]`), selected/highlighted states —
   `.calendar-day.is-today::before`, `.calendar-day:hover/[aria-pressed=true]`,
   `.theme-swatches button[aria-pressed=true]`, `.appearance-choice
   input:checked + .appearance-swatch`, `.font-choices button[aria-pressed=true]`,
   `.passage.is-selected::before`, `.passage.is-locating::before`,
   `.panel-source` accent wash, `.book-action-menu .book-menu-item` active
   state, `experiences.css` `.is-source-target` target stroke.
2. Illustrated book-cover and ornamental strokes: `book-cover`, `cover-inner/
   cover-ornament`, book spines, gift envelope/letter/seal art, hero desk-scene
   art, `closing-page`, sample sheet paper stack, source-review page images.
3. Print rules and actual content marks: reader highlights
   (`.reader-highlight`, `.panel-reference-mark`, `::highlight`), quote blocks
   (`.selected-quote/.saved-record/.highlight-record blockquote`,
   source-review `.pending-note blockquote`), experiences/source-evidence
   evidence markers (`.experience-surface,.source-evidence` left rule),
   source-review `#revision-result` result rule, `.echo-segment`.
4. Focus wrapper variants (ring on the wrapper, inner control silent):
   `.library-page .sidebar-search:focus-within`, `.library-chat-composer:has(textarea:focus-visible)`;
   clipped `.book-menu-item:focus-visible{outline-offset:-2px}` and the
   expanded `.book-drag-handle:focus-visible` keep the shared ring.
5. Forced-colors outlines (`outline: 2px solid Highlight`) in
   interaction-craft.css, parallel-reading.css, library-personal.css.
6. Neutral preview/media shadows (share preview image, home atmosphere
   illustration) and inset shading (paper depths).

## 5. Appearance selection (GET-185)

`app/site-appearance.mjs` replaces the ambiguous cycle:

- The header trigger `#site-theme` opens a small labelled popover
  (`fieldset`/`legend` + three native radios named `site-appearance-menu`:
  System / Paper / Night). The current mode is visible as the checked choice,
  on the trigger glyph (◐/☀/☾), in `title` and in the localized `aria-label`.
- Opening gives feedback: `aria-expanded`, `aria-controls`, `aria-haspopup`
  plus the `[aria-expanded=true]` surface. Click toggles; ArrowDown/ArrowUp
  opens with focus on the checked choice.
- One document-level Escape path closes from anywhere (trigger, choices, or
  outside) and returns focus to the trigger. Focus leaving the whole
  trigger/menu pair closes the popover without moving focus; trigger ↔ choice
  transitions stay open. An outside `pointerdown` closes quietly. Tab is never
  captured (no focus trap) and arrows move/choose within the native radio
  group. `closeMenu` is idempotent: no duplicate close events, no focus jumps
  on the focus-leave paths.
- State: the compatibility key `marginalia-portal-appearance` is kept. Invalid
  stored values recover to `system`; a cleared/removed key and a full `storage`
  reset (`key === null`) fall back to `system`; cross-tab `storage` updates sync
  every tab. Choice changes dispatch the existing `site:appearance` event so
  the library settings radio cards stay in sync; `getSiteAppearance`/
  `setSiteAppearance` keep their signatures.
- System mode keeps the `prefers-color-scheme` behaviour of the surface CSS;
  reader palette preferences (`data-theme`, warm/mist/leaf/night) stay owned by
  the reader. A 220ms colour transition is optional and removed under reduced
  motion.
- All introduced strings are localized for en / zh-Hans / zh-Hant / ja in the
  module's copy table. No global runtime translator; original text untouched.
- The trigger keeps its 44px target and fits the 390px header.

## 6. Tests and boundaries

- `tests/site-appearance.test.mjs` (9) — synthetic DOM + storage: state,
  keyboard, choice persistence, invalid storage recovery, cross-tab updates,
  Escape from anywhere, focus-leave for the whole pair (trigger→outside and
  radio→trigger→outside), no duplicate close events or focus jumps, no trap,
  four-locale labels.
- `tests/component-foundation.test.mjs` (13) — esbuild parse of every app
  stylesheet (including evals/source-review), token inventory and local-palette
  derivation, the 37-pair contrast arithmetic above computed from sources,
  input-variant specificity/aria-invalid behaviour, the no-competing-ring and
  no-removed-focus audits across all CSS, action-vocabulary completeness and
  radius audit, dialog `autofocus` inventory, technical-tool wiring.
- `tests/component-foundation-http.test.mjs` (5) — isolated HTTP fixture:
  module serving; home/library/reader/support/gift routes load it after
  typography; source-review and evals load it too; served dialogs keep
  `autofocus`; compatibility key and localized labels survive.
- Worker/code boundaries: only `app/*.css`, `app/*.html`, `app/**/*.html`,
  `app/site-appearance.mjs`, `server/portal.mjs`, `server/server.mjs`,
  `release-files.json` and tests/docs were changed. `app/home-locale.mjs` and
  `tools/build-vercel.mjs` needed no change. Stored preferences, source data,
  IDs, compatibility keys, typography baseline, daily reading and companion
  contracts are untouched.
- The worker checks alone did not prove real rendering. The parent subsequently
  ran the native Chrome checks, current Ambi/Notion comparison and final full
  suite recorded in the verification document. Cross-OS typography, physical
  touch, all-state target geometry and the final product score remain separate
  acceptance work.

## Parent review repairs and rendered checks

The final source also removes the generic share button paint that overrode its
primary hover/radius, restores the sibling `.share-status` selector, and sends
reader secondary hover through `--surface` → `--wash` so night never falls back
to a light field. Chat's keyboard textarea draws the shared ring on its wrapper.
Authentication binds its own raw palette before deriving shared tokens; error
borders retain their semantic colour. Its foreground variable remains inherited,
not reset on every descendant.

The consolidated line audit covers 40 ordinary boundary consumers plus the
discovery night alias; palette source colours and the documented exceptions
remain. This is a consumer audit, not a claim of zero colour literals in CSS.
The parent also migrated ordinary auth/nav dividers and the daily summary, and
reused the modal shadow on authentication. Final ordinary hairlines use 8% local
ink after comparison with the current public Notion product page.

Real native Chrome checks, reference comparison limits and final command output
are in [the verification record](../../verification/2026-10-18-get-169-components.md).
