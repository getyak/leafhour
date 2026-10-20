# Copy inventory and lint evidence (GET-202 foundation batch A)

The inventory JSON and CSV files in this directory are generated evidence for [GET-202](https://linear.app/getyak/issue/GET-202). The review record and this guide are maintained source files. The inventory contains checked-in repository strings, including protected examples; it contains no private library or runtime data. Regenerate with:

```sh
node scripts/export-copy.mjs --root . --out build/copy
```

Two consecutive runs are byte-identical. The tracked artifacts carry **no timestamps and no git commit ids**: they bind the bytes of every scanned input file (paths + SHA256 + a combined `inputDigest`), so committing or squashing history can never change them. The executing commit of a run is recorded only in `build/copy/export-receipt.json`, which is untracked run metadata and never claims the scan represents any commit.

## What each file says

| File | Content |
| -- | -- |
| `copy-inventory.json` | the one source inventory: four-locale catalogue values with exact `file:line:column` source locations, consumer references, unresolved dynamic references, literal candidates with unique stable identities, parity state and coverage counts |
| `copy-inventory.csv` | one row per catalogue key: `id, kind, file, line, surface, trigger, classification, decision, review, en, zh-Hans, zh-Hant, ja` |
| `copy-candidates.csv` | hardcoded literal candidates (JS DOM assignments, CJK literals, HTML text and `aria-label`/`title`/`placeholder`/`alt` attributes) with `protected` labels and reasons |
| `copy-reviewed.json` | the source-bound adjudication record for static literals (see below); empty in batch A |
| `../writing.md` | the writing standard these rows are reviewed against |

The lint corpus is generated into `build/copy/<locale>.txt` (git-ignored) together with `build/copy/manifest.json`, which maps **every emitted line** to one stable item id, locale, kind and value SHA256. Before any debt or exception matching, `tools/copy-lint.mjs` recomputes each item's exact bytes from its line range and compares them with the manifest declaration — changed bytes are an inventory failure and can never ride a documented debt binding. The export refuses to run on an empty corpus, parity gaps, duplicate ids or a declared hash that does not match the actual value.

## How to read the counts (batch A truth)

- **Reviewed catalogue rows: 0.** Nothing has been individually reviewed yet. Every catalogue row is `unreviewed` with `classification: unknown`; every candidate is `unknown`. Context hints (namespace, DOM property, HTML attribute) carry confidence and evidence only — they are not decisions.
- **Candidates are not copy decisions.** A discovered literal is evidence that text exists in source, not proof it is user-visible, unused or safe to rewrite. Regex/AST discovery can never prove complete coverage; global HTML coverage is not complete.
- **Dynamic references stay unresolved.** Computed key lookups and string concatenations are listed with their literal fragments and marked `unresolved`; they must never be read as "unused keys".
- **Parity is enforced.** Four locales must carry identical catalogue key sets; the export fails on any gap or duplicate id.
- **Protected-source hints** identify code-like keys/identifiers (containing `.`, `_`, `-`, `/` or digits), pathnames, URLs and recognizable quotations. Plain UI labels such as "Close" are not automatically protected. These heuristics cannot identify every book title, author, quote, numeric limit or legal fact: individual adjudication must preserve those facts even when no hint exists. Hints do not grant lint immunity; alerts remain visible. No product copy or source material is rewritten in batch A.

## Reviewed static literals (`copy-reviewed.json`)

The plan requires the corpus to contain all catalogue copy **plus explicitly reviewed static UI literals**. A candidate can only join the corpus through an explicit entry in `copy-reviewed.json` that binds its exact candidate id and original value SHA256 and names locale, surface, trigger, a concrete rationale and `state: "reviewed"`. The exporter hashes the actual static value before writing any corpus files. Stale hashes, unknown candidates, duplicates, missing rationale, protected source material (quotes/paths/URLs/author text) and any non-`reviewed` state are rejected. Unknown candidates never enter the corpus automatically and never become waivers.

The CLI requires the default `docs/copy/copy-reviewed.json` or an explicit `--reviews <file>` to exist and contain a valid `reviews` list. An empty list is an explicit decision; a missing file or missing option value is an error. The library API retains its optional empty reviews list for isolated callers.

Batch A has adjudicated **zero** static literals: all 3726 discovered candidates (including the 90 protected-source rows) remain `unknown` in the coverage counts, and the corpus covers catalogue copy only.

## Debt and exception bookkeeping (manual only)

- `tools/copy-lint-debt.json` — frozen **existing wording debt** captured against the accepted GET-201 source revision (`43187d0ecaa63aa6575700677744c7cf4b3d099e`). Each entry binds item + locale + rule + value SHA256 and is labelled `existing-debt`/`unreviewed`. Every lint run re-validates these bindings against the frozen revision through git object reads, so newly worded T1 can never add itself to the baseline.
- `tools/copy-lint-allowances.json` — **narrow justified exceptions** only: exact item + locale + rule + value hash + concrete reason + review location. Intentionally empty in batch A: no item has been reviewed.

Maintenance rules:

1. Fixing debt wording: change the copy, watch the lint fail on the stale binding, then prune that one entry in the same change. This is the reduction path; it is manual on purpose.
2. Adding an exception: only after individual review, with a concrete reader-facing reason. The entry is bound to the exact value hash: any later edit re-opens review automatically.
3. There is no regeneration or bulk-refresh command anywhere. A tool that could re-record current violations as debt would erase the audit trail, so none exists.

## Current frozen numbers (regenerated 2026-10-21, inputs bound by `inputDigest`)

- catalogue keys: 2067 (four locales complete, 8268 locale values)
- export: 2078 lines per locale (11 values carry internal line breaks); 0 reviewed static literals appended
- reviewed catalogue rows: 0 — deferred to batch B
- unreviewed literal candidates: 3726 (90 labelled protected source; 3726 unique identities)
- unresolved dynamic references: 2610
- existing-debt bindings: 348 (394 raw T1 alerts; EN 54 / zh-Hans 130 / zh-Hant 126 / ja 38)
- justified exceptions: 0
- retained warnings on a passing run: 1882 (T2/T3 evidence, never dropped)

Batch B (full four-language rewrite, reader affordances, native review, screenshots and human studies) is explicitly not done; see `docs/writing.md`.
