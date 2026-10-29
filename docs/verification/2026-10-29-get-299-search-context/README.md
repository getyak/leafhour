# GET-299: matching source context in native book search

Long paragraphs previously showed their first four lines even when the query appeared much later. Results now show bounded original context around the first match and bold the matching source. Each passage still produces one result. Leading/trailing input whitespace is ignored, and whitespace-only input shows the existing empty prompt.

One `localizedStandardRange(of:)` result owns both the excerpt and the Unicode-scalar destination. Its documented locale-aware, case/diacritic-insensitive behavior is appropriate for user-level search ([Apple API reference](https://developer.apple.com/documentation/swift/stringprotocol/localizedstandardrange%28of%3A%29)). A real core test exposed a range ending before a decomposed accent: preview styling now expands to whole graphemes, retaining the exact search scalar offset. Source spelling is unchanged; summary whitespace becomes spaces, and ellipses identify omitted context.

The excerpt contains at most 32 preceding characters, 96 matching characters and 64 following characters, plus at most two ellipses. Rows grow instead of truncating after four lines. Independent review found that legal TXT line breaks could otherwise push the match entirely beyond that limit; the fix and a CRLF/tab regression test were re-reviewed with no remaining confirmed issue. This does not establish maximum Dynamic Type or VoiceOver acceptance.

## Actual validation

| Check | Result |
| --- | --- |
| Host LeafhourCore suite | 28 tests passed, including seven new contextual/Unicode search cases |
| Existing Primary iPhone, iPhone 17 Pro / iOS 26.5 | Native build and one focused UI probe passed |
| Whitespace-only query | Existing empty prompt remains visible |
| Query with leading/trailing spaces | A late `waistcoat-pocket` match appears in the visible result with original surrounding words and bold match |
| Tap result | Returns to quiet source reading with the matching phrase visible; saved `text-2` scalar offset is exactly 370 |

The live anchor check read only the isolated task app's bounded public-domain Alice fixture. [Anchor proof](anchor-proof.json) records expected and actual offsets. No real account, notes, cloud data or model service was used. [Source hashes and scoped results](evidence.json) identify the exact implementation that was built. The temporary UI probe was preserved with the raw results and restored out of the production test source before commit; it introduces no app test hook.

[Search result](screenshots/01-search-context.png) · [Return to matching source](screenshots/02-matching-source.png). Both exported native screenshots were inspected. The fixture's hard-wrapped TXT source and underscores remain unchanged in the reader; only search-summary whitespace is flattened.

Whole-book scanning remains synchronous. This change evaluates the result list once per body update and bounds displayed context, but it is not an asynchronous/cancellation or long-book latency result. Compact iPhone, iPad, hardware keyboard, full VoiceOver, maximum Dynamic Type, physical devices and TestFlight remain unverified. Website production is separately quota-limited; a native source merge does not establish distribution.
