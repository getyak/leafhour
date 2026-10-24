# Homepage catalog language and book showcase

Date: 2026-10-24. Base: `a6476d2` on public `getyak/leafhour` main. Branch: `codex/home-book-showcase-locale`.

## Problem and implementation

On `/en`, the dynamically loaded public catalog translated action labels but rendered the Chinese editorial description, translator attribution and cached chapter label verbatim. The static homepage locale check did not exercise these later card nodes.

The three bundled editions now format this metadata from the committed interface locale and their chapter index. Old guest caches with only a chapter label are resolved against the same edition's known chapter titles. Formatting retains the saved passage destination, source metadata and stored progress. Imported content and unknown labels remain literal. Locale changes update the existing owned nodes without another catalog request or replacing the cards.

The public bookshelf uses a quieter cover composition, page edges and a floor shadow. The opening camera move and light sweep run once, for 4.6 seconds, only after the book enters the viewport. The actual link does not move. Focus, page hiding and reduced motion cancel active animation. Reduced motion renders a static cover. The private bookshelf is outside the CSS scope.

## Local verification

- 71 relevant tests passed across `home-locale`, `home-motion`, `home-navigation`, `ui-locale-portal`, `ui-locale-label-cache` and `reading-progress`. Both new regression cases failed before their implementation and passed afterward.
- The actual card factory regression covers an old Chinese guest cache, `Chapter 1 · Down the Rabbit-Hole`, English descriptions and translator attribution, language changes on existing nodes, the retained passage link and unchanged source/cache input.
- HTTP checks confirm the new `home-books.css` is served as CSS.
- In-app browser: desktop and 390px layouts checked with no horizontal overflow. Long cover titles fit after correction. The normal-motion camera transform was observed in the browser; the system reduced-motion setting also produced a static cover. Temporary viewport and media emulation were reset.
- [Desktop](desktop.jpg) and [390px mobile](mobile.jpg) are local screenshots using only bundled public catalog data.
- Product copy inventory regenerated. This is inventory bookkeeping, not manual approval of existing copy candidates.
- Independent read-only review completed against the source diff, actual catalog/chapter/cache contracts, locale node ownership, CSS and release allowlist. No actionable P0–P3 findings were reported. This review did not repeat browser or production acceptance.

The legacy saved-resume scenario is covered by the actual card factory regression; the local browser did not create a saved reading position during its brief reader visit. No real account, uploaded book or model service was used.

## Delivery state

Implementation, local checks and independent review are complete. On 2026-10-24 the user explicitly authorized this task's read-only independent review, cloud CI and production release while retaining the existing `/Users/cubxxw/.agent-pause` marker. Cloud CI and delivery are in progress; no production success is claimed at this checkpoint. The marker has not been changed or removed.

Local QA server PID: 6098, started 2026-10-24 17:50:40 Asia/Shanghai, loopback port 64347, temporary isolated records. Existing services were not restarted or stopped. Temporary artifacts are registered as `/private/tmp/ai-test-home-book-showcase.MTIQqE`; screenshots and this report are the durable evidence.

Checkpoint cleanup: PID 6098 received SIGTERM after checking its recorded start time and exited. The agent-created browser tab was closed after resetting viewport/media emulation. [Local test output](local-tests.tap), screenshots and this report were saved before reclaiming the registered temporary artifact. Source changes and the task branch are retained for the pending release decision; no worktree or other task resource was removed.
