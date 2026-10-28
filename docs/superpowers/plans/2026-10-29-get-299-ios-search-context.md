# GET-299: reveal the matching sentence in native search

The native result currently previews only the beginning of a passage. A match far into a long paragraph therefore has no visible explanation. Filtering uses localizedStandardContains, while navigation performs another search with different options.

Keep the current native list and one result per matching passage. Introduce a small, pure LeafhourCore excerpt value that uses one localizedStandardRange for both displayed context and the Unicode-scalar destination. Preserve source spelling, composed characters, chapter and passage IDs. Bound context to 32 characters before, 96 characters of the match and 64 after; ellipses mark omitted source. Preview styling expands to complete graphemes while the destination retains the exact matched scalar offset. Display whitespace as spaces only in the summary. Let the bounded excerpt grow with Dynamic Type rather than truncating it before the match. Bold the source match without adding a theme-dependent highlight color. Treat whitespace-only input as empty. Evaluate the result list once per body update.

This is the selected small increment under the user's autonomous optimization request. It does not certify long-book performance or introduce an asynchronous search engine. Cancellable work, measured latency and iPad layout remain in the separate proposal ledger.

Validation: core tests for late matches, accented/case-insensitive input, scalar offsets after emoji/combining text, omitted context and empty/no-match input; a native simulator search/result/jump probe with isolated public-domain text; build, independent review and current-head CI before normal merge. Source/simulator acceptance is separate from TestFlight, real-device and website publication.

Primary API reference checked 2026-10-29: [Apple localizedStandardRange(of:)](https://developer.apple.com/documentation/swift/stringprotocol/localizedstandardrange%28of%3A%29). Its documented locale-aware behavior matches user-level search; exact options may evolve, so the same returned range must own the destination and excerpt.
