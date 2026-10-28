# Explicit offline resource recovery

After the canonical hosting correction, additional acceptance found a separate recovery gap. An active Service Worker whose CacheStorage entries had been evicted could not prepare its unchanged release again. Repeated explicit Save actions only queried readiness; registering the same script did not rerun installation. Book chapters remained complete in IndexedDB, while the interface group stayed unavailable.

The failure was independently reproduced with the real worker and preparation helper, and with Chromium by removing only the public completion descriptor and clicking Save. The original UI correctly withheld offline readiness, but another explicit Save still fetched no resources and could not restore it.

An explicit Save now requests repair for its exact current reader entry. The worker checks the client origin and entry, shares the existing bounded installer, retains already verified bytes, fetches missing or damaged public resources without credentials or redirects, and writes the completion descriptor only after every expected byte passes verification. Concurrent retries share one preparation. Ordinary status checks remain read-only. No private API, book body, account record or model request enters this resource repair.

Four positive regression failures were observed before the change and passed afterward: complete eviction recovery without reinstalling, concurrent partial repair, digest-failure retry, and explicit-only transport authorization. A fifth regression checks foreign-client and mismatched-entry rejection without network activity. The combined worker/transport suite passed 43 tests; independent review found no material P1/P2 issue.

Real Chromium acceptance removed all entries from the active public resource group after a successful Save, then used the same visible Save button without reinstalling the worker. It restored 220 resources plus the completion descriptor. The book remained complete and pinned with the same 13 entries and 375,773 application bytes; a subsequent offline reload succeeded with an active controller.

Local `npm run verify:deploy` passed 4,164 tests: 4,163 passed, zero failed and one platform-conditional skip. The isolated runtime, production build, public assets and release allowlist checks passed. The configured copy lint passed with existing documented warnings retained.

A temporary mobile WebKit session also lost its CacheStorage entries while its saved book remained. A separate persistent WebKit profile passed offline navigation in English, simplified Chinese, traditional Chinese and Japanese with no horizontal overflow. This is kept distinct from real Safari/iPhone acceptance, which remains untested. Upstream context for ephemeral CacheStorage behavior is recorded in [Playwright issue 41618](https://github.com/microsoft/playwright/issues/41618); the independent Chromium recovery failure established the product issue without relying on that browser-specific observation.

Production verification and the exact deployed source are recorded on the corrective pull request linked from this document's commit history. PR #250's canonical path fix was published as `51ce8cf417452489915c99ba0ab2469e5c771f12`; all 220 of its public resource URLs returned HTTP 200 without redirects and matched their expected byte lengths and SHA-256 values.
