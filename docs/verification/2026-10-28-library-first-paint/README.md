# Library first-paint transport — 2026-10-28

The first delivery (#232, Production `3c4c70cc6062b9de4246add0279779eee0d16998`) passes the actual default-account recap, same-day dismissal, book-first metadata, calendar isolation and archive laziness checks. It did not materially reduce total cold guest startup: one before/after pair was 10.573/10.571 seconds. This follow-up addresses the remaining module waterfall rather than presenting that result as a speed improvement.

## Change and boundaries

Build the existing `/portal.js` and `/library-shell.mjs` into two minified ESM assets, respectively 184,857 and 74,687 bytes. Each remains below the existing 200 KiB public JavaScript limit. Across the two assets, 44 source modules are bundled with no overlapping inline input. Modules reachable by sibling page entries or any portal lazy boundary retain their exact public URLs and transitive dependencies. Lazy queries/fragments remain intact; unlisted inputs and nonliteral imports reject the build. The original global locale-source audit still runs first.

Only the library HTML omits homepage motion, atmosphere and sample scripts/styles. Authored homepage routes keep them. No authorization, account state, copy, reading records or storage keys change.

## Verification

- 32 focused builder, document, reader bundle, release, arrival and lazy-boundary tests passed. Synthetic generated modules were actually evaluated with shared mutable state across sibling and lazy entries; they verify one evaluation and delayed lazy execution.
- Release export, public asset checks and source-provenance checks passed. Generated copy values are unchanged; its source manifest is regenerated.
- Fresh read-only review found no actionable defect. The reviewer independently reran six builder/document tests and checked actual sizes, disjoint inputs, mutable singletons, lazy closure, import URLs and allowlist coverage.
- `browser.json` is a real headless Chrome run against a temporary isolated local library using the generated assets at their real URL names. It verifies locale and appearance identity, palette behavior after sign-out, shelf focus, no default calendar/inbox work, daily recap/dismissal, mobile bounds and archive loading only after an explicit data-file action. No actual user's book or notes appear in the screenshots; the synthetic interval/book are removed after the run.

## Network experiment

`network-experiment.json` compares two fresh guest browser contexts against the same Production backend. The experimental context overrides only the two compiled assets (adding 120 ms delay to each response) and removes the known homepage-only asset tags from library HTML. It records 89 → 44 module requests, 126 → 78 resources, DOM readiness 11.467 → 2.772 seconds, and first usable books 15.832 → 6.135 seconds. Both contexts kept archive compression deferred and had no page errors.

This is a directional network-overlay experiment, not Production acceptance or a general speed guarantee. Identity and library API reads still contribute several seconds. The current commit must pass full CI and its deployed version must be measured separately before completion.

Primary API reference: https://esbuild.github.io/api/#bundle and https://esbuild.github.io/api/#external.
