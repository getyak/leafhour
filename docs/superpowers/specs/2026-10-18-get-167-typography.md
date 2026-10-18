# GET-167 typography foundation — settled design (GET-173 / GET-174 / GET-175)

Date: 2026-10-18. Status: settled design, implemented locally in the GET-167
worktree. The implementation scope is settled; this document records the design and
the acceptance matrix. Rendered browser acceptance stays with the parent.

## 1. Font decision (settled)

- Self-host the **full Newsreader variable fonts with unchanged glyphs and metrics**, upright and
  italic (WOFF2), in `app/fonts/newsreader/`, licensed **OFL-1.1**.
- Source: Google Fonts `ofl/newsreader` at commit
  `8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5`; designer
  https://github.com/productiontype/Newsreader. Conversion recorded in
  `manifest.json` (fontTools 4.67.0, `flavor=woff2`, `recalcTimestamp=False`);
  glyphs, names, metrics and axes untouched. Parent independently verified
  TTF/WOFF2 cmap + metrics equality, U+2019 advance 455/2000 (upright),
  variable axes `wght 200..800`, `opsz 6..72`.
- `app/fonts/newsreader/` keeps `OFL.txt`, `manifest.json` (byte sizes +
  SHA-256 digests), and `README.md` (source/build attribution).
- No external font service at runtime, no npm dependencies, no glyph edits, no giant
  CJK font.

## 2. Family stacks — the `Leafhour Serif` alias

`app/typography.css` (the single shared module) declares two `@font-face`
blocks for the alias `Leafhour Serif` (`font-weight: 200 800`, normal + italic,
`font-display: swap`) and the stacks:

| Token | Order | Use |
|---|---|---|
| `--font-serif` | Leafhour Serif → Iowan Old Style → Georgia → Songti SC → STSong → Noto Serif CJK SC → Source Han Serif SC | headings, titles, editorial copy |
| `--font-latin` | Leafhour Serif → Iowan Old Style → Georgia → Songti SC → Noto Serif CJK SC | authored English spans (mixed labels keep a CJK fallback) |
| `--font-cjk-serif` | Songti SC → STSong → Noto Serif CJK SC → Source Han Serif SC | Chinese body text |
| `--font-sans` | system UI stack | interface text |
| `--font-hand` | Leafhour Serif → Iowan Old Style → Georgia → Kaiti SC → STKaiti → KaiTi → Noto Serif CJK SC → Songti SC | handwritten letter surfaces |

Because the Latin face always leads, Latin glyphs and English apostrophes
(U+2019, narrow 455/2000) use its Latin glyph when the face loads; Chinese glyphs
retain Songti / Noto Serif CJK (Newsreader has no CJK glyphs). Stacks were
replaced **at their source** (`--serif`, `--sans`, `--hand`, `--book`,
`--english`, `--interface`, `--leafhour-serif`, and inline Georgia/Iowan
stacks) — no override layer was added.

Reader integration: `reader.js` resolves song/kai through these same shared
families and retains an explicit sans choice. New books use normal tracking
(0em); saved per-book choices still win over account defaults, and both retain
explicit spacing. No persisted preferences or source text are rewritten.

## 3. Type scale tokens

`--type-hero: clamp(56px,7vw,104px)` · `--type-page: clamp(32px,4vw,48px)` ·
`--type-section: clamp(28px,3vw,40px)` · `--type-h3: 20px` · `--type-body: 16px`
· `--type-small: 14px` · `--type-caption: 13px` · `--type-label: 12px`.

Applied at source: homepage hero and page headings in the home/library reader surfaces; support
page headings retain their authored hierarchy, **all homepage sections at
the same level with weight 400** (reading-demo, daily, shelf, ownership,
closing, library sections), H3 20, body 16, secondary 14, captions/meta 13,
functional labels 12. Reader body size still follows user preferences.

## 4. Tracking tokens (language-aware)

`--track-hero-latin: -.035em`, `--track-latin: -.015em`, `--track-cjk: .01em`,
`--track-label: .08em`, `--track-meta: .02em`, `--track-body: normal`.
Resolution follows real `lang` attributes: `--track-heading`/`--track-hero`
resolve to the Latin values under `[lang|="en"]` and to `.01em` under
`[lang|="zh"]`/`[lang|="ja"]`, so mixed book labels carrying `lang="en"`
inside Chinese pages stay Latin-tight. Long reading paragraphs keep normal
spacing (the reader keeps its `--reading-tracking` preference). All px-level
letter-spacing was eliminated (the auth code field keeps an em value); random
heading tracking was replaced with `var(--track-heading)`; uppercase labels use
`var(--track-label)` only where needed.

## 5. Small-type policy

Functional labels/meta/help text are ≥ 12px (labels 12, captions/meta 13),
with hierarchy carried by colour/weight instead of tiny type. Documented
decorative exceptions that keep microtype: reproduced cover art
(`cover-inner`, `binding-*`, `book-info-cover`), mailed-paper marks
(`envelope-postmark/stamp/colophon`, `letter-mark`, `gift-colophon`), the hero
desk-scene mock (`open-book`, `margin-note`, `note-bottom`, `page-running`,
`scene-caption`, `scene-index`, `print-lines`), brand wordmark microtype
(`brand-name small`), ornamental glyphs, and the reader's theme/font preview
swatches. Caption growth was audited against cards/drawers/mobile; flexible
rows (`book-label`, `book-bottom`, `sample-heading`, `sample-footer`) gained
wrap/gap protection.

## 6. Loading, serving and policy

- `typography.css` is loaded consistently by the homepage/library document,
  the reader, the gift letter and all support pages (en/zh-hans/zh-hant/ja
  mcp + privacy). It comes before each surface stylesheet.
- `font-display: swap`. Only the **upright** face is preloaded on first-screen
  entry pages (home + reader) with `as="font" type="font/woff2" crossorigin`;
  italic is lazy. No external font requests anywhere.
- Registered everywhere: local reader (`server/server.mjs`), portal static map
  (`server/portal.mjs`, exact `font/woff2` MIME), release allowlist
  (`release-files.json`), public build policy (`tools/check-public-build.mjs`
  pins reviewed bytes and digests independently of the distribution manifest, rejects duplicate faces and unregistered/substituted
  WOFF2), hosted static output (`tools/build-vercel.mjs` → `dist/fonts/…`).
- CSP/privacy boundaries unchanged (`default-src 'self'`, no font-src
  loosening, no new external origins).

## 7. Acceptance matrix

| Acceptance item | GET-173 (font) | GET-174 (scale/consistency) | GET-175 (tracking/microtype) | Local status | Browser acceptance |
|---|---|---|---|---|---|
| Full glyph/metric-preserving Newsreader upright+italic WOFF2 self-hosted, OFL + manifest preserved | ✓ | | | implemented + tested | parent |
| `Leafhour Serif` alias ordered before Iowan/Georgia then Songti/Noto; U+2019 stays narrow | ✓ | | | implemented + tested | parent |
| `font-display: swap`; upright-only preload (type+crossorigin); italic lazy; zero external font requests | ✓ | | | implemented + tested | parent |
| Fonts/CSS served on local + hosted routes with `font/woff2` MIME and reviewed bytes | ✓ | ✓ | | implemented + tested | parent |
| Release allowlist + public build policy include and verify the fonts | ✓ | | | implemented + tested | parent |
| One shared token module loaded on homepage/library/reader/support pages | | ✓ | | implemented + tested | parent |
| Hero 56–104, page 32–48, section H2 28–40 all same level/400, H3 20, body 16, small 14, caption 13 | | ✓ | | implemented | parent |
| Reader body text follows user typography preferences | | ✓ | | preserved | parent |
| Tracking tokenized (hero ≈ -.035em, Latin heading ≈ -.015em, CJK ≈ .01em, label .08em only where needed) and language-aware via real `lang` | | | ✓ | implemented + tested | parent |
| No px-level letter-spacing; long reading paragraphs keep normal spacing | | | ✓ | implemented + tested | parent |
| Functional labels/meta/help ≥ 12px; colour/weight for hierarchy; decorative marks documented | | | ✓ | implemented + tested | parent |
| Cards/drawers/mobile audited for overflow after caption growth | | ✓ | ✓ | audited in source | parent |
| Authored title/original/path/sample text byte-for-byte (incl. Alice’s U+2019) | ✓ | | | implemented + tested | parent |
| Paper/sage/quiet editorial identity and existing layout preserved; no new marketing design | | ✓ | ✓ | preserved | parent |
| GET-155 daily-reading changes and the existing test baseline preserved | ✓ | ✓ | ✓ | verified locally | parent |

For actual parent integration, browser observations and remaining acceptance gaps,
see `docs/verification/2026-10-18-get-167-typography.md`. The supplied A–H rubric
has an 11/16 baseline; no original-author rescore or untested platform is claimed.
