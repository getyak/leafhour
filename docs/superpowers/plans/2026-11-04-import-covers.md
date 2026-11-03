# Imported covers implementation plan

**Goal:** Preserve source artwork and generate a suitable private cover when missing.
**Architecture:** A configured Ark adapter supplies normalized WebP bytes. The library authorizes first, checks original artwork, then leases and caches generated artwork. Existing Web/iOS cloud URLs remain shared.
**Spec:** ../specs/2026-11-04-import-covers-design.md

- [x] Write failing tests for TXT generation, source-cover priority, missing EPUB artwork, restart persistence, account isolation, concurrent requests, provider failures and disabled configuration.
- [x] Add `server/generated-cover.mjs`: concise metadata-only prompt, configurable provider, bounded responses and sanitized failures.
- [x] Extend `server/imported-cover.mjs` raster normalization and `server/library-service.mjs` source-first cache/lease; configure from `server/portal.mjs`.
- [x] Extend private cover eligibility in `app/book-binding.mjs` and native shelf metadata. Add environment placeholders and release dependency.
- [ ] Run affected tests, full suite and release build. Review branch before one consolidated push/PR; merge only after CI succeeds.
- [ ] Use 剑来.txt under the real Supabase identity of test@cubxxw.com for live acceptance; preserve source bytes and reading records. Record real generation, UI, merge and production outcomes separately.

Review focus: never send book contents to Ark; never generate over original artwork; no cross-account cache access; no paid stampede on cold starts; no permanent cache of transient failures. No private artifacts in Git.
