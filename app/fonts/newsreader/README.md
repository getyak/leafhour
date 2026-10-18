# Newsreader (self-hosted web fonts)

Leafhour ships full Newsreader variable fonts with unchanged glyphs and metrics, upright and
italic, for the Latin editorial and reading surfaces ("Leafhour Serif").

- Typeface: Newsreader, designed by Production Type — https://github.com/productiontype/Newsreader
- Source: Google Fonts, `ofl/newsreader`, commit `8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5`
  (https://github.com/google/fonts)
- License: SIL Open Font License 1.1 (OFL-1.1) — see `OFL.txt` in this directory.
- Build: converted from the upstream variable TTFs with fontTools 4.67.0
  (`TTFont` with `flavor="woff2"`, `recalcTimestamp=False`). No glyphs, names,
  metrics or axes were edited; TTF/WOFF2 cmap and metrics are equal, the
  upright U+2019 advance stays 455/2000, and the variable axes stay
  `wght 200..800`, `opsz 6..72`.
- Files: `newsreader-var.woff2` (upright), `newsreader-italic-var.woff2`
  (italic). Exact byte sizes and SHA-256 digests are pinned in
  `manifest.json`; `tools/check-public-build.mjs` verifies them before any
  public build ships.

`app/typography.css` declares both faces as the `Leafhour Serif` alias with
`font-display: swap`. The upright face is the only preloaded first-screen
font; the italic face loads lazily. No font request leaves the site.
