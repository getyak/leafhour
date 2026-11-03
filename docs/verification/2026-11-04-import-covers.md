# Source-first private covers: pre-merge verification

Base: `be467c95` from public `getyak/leafhour`. Scope: imported covers and their existing Web/iOS cloud delivery path. This is a pre-merge record; it does not assert a production deployment or physical-device acceptance.

Implemented: original EPUB artwork and PDF first page take priority; TXT/Markdown and EPUBs without usable artwork use optional Ark Seedream 5.0 Pro. The private account/source-hash cache survives restarts and copies, with an atomic hosted lease, local exclusive lease, and 15-minute failure cooldown. Provider responses are size-bounded and raster-decoded; provider URLs are never followed. Only title/author metadata goes to Ark. A soft wash and existing bundled font subsets typeset actual metadata without generated slogans. Web and iOS retry transient cover failures; private iOS requests allow 120 seconds.

Observed checks:

- Full JavaScript suite: 4,632 tests; 4,618 passed, 14 skipped, zero failures.
- Full LeafhourCore Swift suite: 352 tests, two skipped, zero failures. Existing compiler warnings remain. The new timeout test first failed at 45 seconds and passed at 120 seconds; pending-cover retry also passed.
- All four provider adapter tests passed with system font loading disabled.
- Production asset build and release allowlist/provenance checks passed. The Vercel inclusion expression is 203 characters, within the 256-character platform limit; it includes existing font subsets and preserves PDF/Canvas assets.
- Independent review found and then verified fixes for a stuck failed image and the iOS timeout mismatch. A real isolated Chrome run returned 503 once, retried, then observed `ready` and a visible image.
- The account model listing returned the configured Pro model; real Ark generation succeeded. An initial complete-cover sample added unsolicited lettering, so the final implementation requests artwork only and typesets metadata itself. No credential or generated private asset enters Git.

The first full-suite attempt used a symlinked dependency directory and failed the PDF function-package test and three reader-runtime packaging tests. An actual dependency copy removed that artifact; those tests then passed. A later full-suite run caught the Vercel expression exceeding its platform limit; the equivalent nested glob fixed it, followed by the green full run above.

Live acceptance uses the full 23,964,345-byte 剑来.txt in the current Supabase Auth identity of test@cubxxw.com. Its 1,107 chapters and 230,392 paragraphs are published to that test shelf. The first chapter-projection attempt hit a network interruption; continuation reused the saved source through the library service and completed. All three downloaded original parts and the combined SHA-256 match the local file. The production reading endpoint returns a partial chapter view with 1,107 chapters; the loaded paragraph matches the source after whitespace normalization. Live cover display, merge and new Production provenance remain separate acceptance steps. No new TestFlight binary or physical iPhone test is claimed.

The first GitHub run passed native iOS and catalog checks but stopped before web tests because the deterministic copy candidate/inventory outputs had not been regenerated after the source edits. The follow-up refreshes those exact generated records; it does not change lint rules, debt bindings or review decisions. Copy export/inventory tests passed (22 tests), and lint passed using the pinned real Vale/textlint tools with warnings and documented debt preserved. A repeated export produced no further changes. Hosted verification also completed its full suite, isolated reading runtime initialization, public build and provenance checks.
