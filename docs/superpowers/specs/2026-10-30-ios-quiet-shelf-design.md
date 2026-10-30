# iOS quiet shelf and bilingual reading

The reader wants a personal library that feels like books, with controls appearing when useful. Scope: the six requested changes, existing SwiftUI iOS 17+ application, existing account/data/AI services.

## Direction and alternatives

A — cover-led personal shelf: two columns on phone, uninterrupted book art, title/author below, one compact range menu and one presentation menu in a single shelf heading. Tap any book to open/download; downloaded books receive only a small upper-right check. Progress/cancel belongs to its book. Settings use a real-page preview, concise groups and tactile theme choices.

B — compact editorial catalogue: small covers alongside text rows; a unified toolbar handles range/sort. Better density, less presence for book art. Retained as the list view; A is the default because covers and quietness are the requested priorities. Neither introduces decorative dashboard cards, fake progress or achievements. Two composition mockups and native rendered evidence accompany the source audit. Each is distinct from provider or physical-device acceptance.

Settings covers both the account sheet and reading settings. Account: personal identity first, records and summaries together, sync/data below, provider management behind a disclosure. Reading: real source excerpt, mode, typography, paper, navigation; explanations appear only where a choice needs them. Native semantics and 44-point touch targets; Dynamic Type uses full-width rows; dark mode preserves contrast.

## Cover contract

Library metadata supplies a relative cover image path: public checked-in artwork or the existing authenticated original-file cover endpoint. Native fetching permits only these two path families on the configured origin, never sends cookies to public/static or external URLs, fences owner changes, bounds image size, and caches under an owner/version key. Missing covers use restrained title typography; a failed image never prevents reading. Existing metadata without the new field remains usable. No external title search or unrelated third-party cover matching.

## Reading contract

Persist independent `source | translation | parallel` and `literal | interpretive` preferences, with backward-compatible defaults. Source is immutable. Translation mode uses saved translation with provenance/status; missing translation clearly retains source. Parallel is stacked by passage on phone. Stable source paragraph IDs anchor every mode, including translated selections. PDF source pages remain intact; translated/parallel modes use extracted cloud text when available, and explicitly explain unavailable text.

Read cached translations first, refresh current and next chapter from the existing versioned endpoints and update paragraph-by-paragraph. Never relabel source as translation. Source mode and changing typography make no model calls.

An explicit per-book switch enables sequential AI preparation of current/next chapter only while foregrounded in translation/parallel mode. Show bounded scope and maximum reading-point cost before starting; obtain/validate each quote with the existing billing path. Persist the exact request before submission, reuse it after an uncertain response/relaunch, skip existing complete pairs, stop on partial pairs, failed billing/provider/ownership/version, mode exit, background or cancellation. Never start whole-book generation; no private notes. Cached results survive offline/relaunch.

## Validation and delivery

One issue, one PR, separate commits per optimization. Cover metadata/transport/ownership/cache tests; preference compatibility; rendering/selection/anchor tests; bounded generation/cancel/retry tests; native small/large text, dark, missing/slow image, item-only download and all reading modes. Core baseline: 147 tests passed on this task. Verify native build and UI separately from CI, merge, deployment and TestFlight/device acceptance.

References checked 2026-10-30: Apple HIG menus, collections and settings; SwiftUI task lifecycle and URLSession image loading. Minimum deployment stays iOS 17; do not use iOS 27-only AsyncImage APIs.

Builder review rulings: translated selections carry origin/variant and quote text through draft/note/export/cloud sync; without sentence alignment the source anchor identifies the whole paragraph. Stopping translation stops subsequent submissions; an already submitted request can finish and consume its quoted point, and its exact receipt remains recoverable. Freeze chapter IDs, passage IDs and version at confirmation; navigation never silently expands a confirmed budget. Chapter cache updates merge once per chapter. Device EPUB uses declared OPF cover-image/cover metadata, PDF its actual first page.

Implementation findings: the shelf cache must retain `coverImage` across synchronize/reload; a visible-artwork pixel assertion caught its omission. Current translated viewport offsets are temporary display positions and never source-language offsets; re-rendering preserves them when the translated text is unchanged, and native selection defers background replacement. Preview follows the selected reading layer.
