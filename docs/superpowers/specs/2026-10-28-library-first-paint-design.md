# Library first-paint transport follow-up

PR #232 is live and its real-account recap, calendar isolation and archive laziness pass Production acceptance. Its first guest render still takes about 10.6 seconds in this environment. The trace shows 126 resources, a roughly five-second module dependency waterfall, followed by sequential identity/library reads. Metadata deferral alone did not solve first usable books.

Build the existing portal entry into two minified ESM assets at the existing `/portal.js` and `/library-shell.mjs` URLs, each below the existing 200 KiB public-asset limit. Retain the exact public URL for shared modules reached by other home-document entry scripts and by any portal lazy boundary; retain their transitive static/dynamic dependencies, too. This preserves mutable locale, appearance, palette cache and bootstrap identities. Every dynamic import stays an external literal public URL, with its original query/hash. Validate every bundled input and retained dependency against the existing release allowlist. Keep the global UI-locale source audit in the build before compilation. No app logic, authorization, copy or persistent data changes.

The library renderer removes three homepage-only motion/atmosphere/sample scripts and their styles. Homepage routes keep them. The private library continues to use its own styles, locale bootstrap, reading arrival, interaction and palette entries.

Rejected alternatives: preloading every source would retain the high request count; bundling without shared-state boundaries can duplicate mutable state and defeat lazy loading. A fresh builder review requires the portal lazy-target closure as well as sibling entries, literal-edge validation, runtime URL preservation and generated-page behavior checks.

Test the synthetic generated entry for one shared module evaluation and live state shared with a sibling and lazy module; failed allowlist/opaque imports must reject. Verify the actual generated page's locale, theme, palette owner reset, shelf/recap and lazy archives. Compare cold first usable books and requests, and state the remaining identity/library latency honestly. Full CI, normal PR merge and same-commit Production acceptance remain separate gates.

Implementation: tools/build-portal-web.mjs, tools/build-vercel.mjs, server/portal-document.mjs, focused tests and release-files.json. No new dependencies. Reference: https://esbuild.github.io/api/#bundle and https://esbuild.github.io/api/#external.
