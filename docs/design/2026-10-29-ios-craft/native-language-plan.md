# Plan language support for the native iOS app

Date: 2026-10-29, Asia/Shanghai. Task: [GET-301](https://linear.app/getyak/issue/GET-301), under [GET-296](https://linear.app/getyak/issue/GET-296). Source reviewed: `93630028ff29e61af566af9fb454a6f5c120a11b`.

This is a source-backed proposal, with candidate copy and an implementation/acceptance sequence. It adds no app localization, catalog, preference, data migration or native runtime evidence. The machine's operations pause was present during this round, so no local build or simulator test was started. The latest fetched main includes a separate Web offline-reading change; no iOS source changed between the accepted GET-300 merge and this baseline.

## Reader benefit and language boundaries

Someone whose device uses English or Japanese should be able to find the book's contents, change type, save a note and recover an interrupted import without guessing Chinese controls. Interface language must be independent of the book being read. An English interface can show Chinese source text; a Chinese interface can show English source text. Neither choice creates a translation.

Use the app's supported system-selected localization first. Keep the current settings panel about reading appearance; an extra in-reader language picker would duplicate an app preference and suggest it changes the book. If a future app-language shortcut is added, identify it as interface language and use the native app settings route. Validate the actual per-app language settings entry only after localized resources are packaged. Unsupported-language fallback must be deliberate and tested, not inferred from the project declaration.

Preserve authentic book/chapter titles, author names, filenames, source passages, selected quotations and personal note/draft bodies verbatim. App-generated page/chapter labels are a different case: BookParser currently stores Chinese page titles for PDF and fallback chapter titles for EPUB without a source heading. Localize those labels in presentation only when their generated origin can be established from book kind/import provenance; never guess from a title's Chinese wording. Keep unknown/legacy titles verbatim until provenance is reliable. No existing title, chapter/passage ID or source fingerprint is rewritten to switch UI language. Theme tags (`paper`, `night`, `system`), scalar offsets and backup format identifiers also remain stable. Keep author source, missing translations and personal writing visibly distinct in every locale.

## What the source actually contains

This is a representative flow inventory, not an exhaustive string extraction. [Source fingerprints and observed examples](../../verification/2026-10-29-get-301-native-language-plan.json) make the review reproducible.

| Surface | Owning source | Observed issue / implementation implication |
| --- | --- | --- |
| App localization declaration | [project.pbxproj](../../../apps/ios/Leafhour.xcodeproj/project.pbxproj), [Info.plist](../../../apps/ios/Leafhour/Info.plist) | Development region is `en`, known regions are `Base` and `en`; no checked-in native string catalog or `.lproj` resources were found outside Vendor. This is not evidence that displayed UI is English. |
| Shelf, import recovery and local ownership | [LibraryScreen.swift](../../../apps/ios/Leafhour/LibraryScreen.swift) | Chinese literal navigation and retry controls; a dynamic `String` for job errors/status; book-title interpolations in accessibility labels. Device-local ownership notices must not acquire a cloud-sync promise during translation. |
| Book details, integrity and export | [BookDetailScreen.swift](../../../apps/ios/Leafhour/BookDetailScreen.swift) | Page/chapter noun chosen inside an interpolated sentence, plus dynamic integrity messages. Localize page and chapter messages separately, with count variants. Preserve original filenames and the exported record schema. |
| Generated chapter/page titles | [BookParser.swift](../../../apps/ios/LeafhourCore/Sources/LeafhourCore/BookParser.swift) | Heading-less EPUB fallback titles and PDF page titles are generated app copy, unlike authentic source headings. Do not localize every stored title or infer provenance from matching a Chinese title pattern. |
| Quiet reader and accessibility routes | [ReaderScreen.swift](../../../apps/ios/Leafhour/ReaderScreen.swift) | Visible controls, invisible-but-accessible wake controls, previous/next page vs chapter labels and slider labels all need the same locale. Do not restore permanent chrome just to expose translated controls. |
| Search, settings, records and editor | [ReaderPanels.swift](../../../apps/ios/Leafhour/ReaderPanels.swift) | SwiftUI literals coexist with dynamic ternaries and concatenated source/quote text. Search counts are matching paragraphs, not occurrences or translated results. Numeric `pt` labels and spoken point values are separate surfaces. |
| Native text selection menu and image fallback | [TextReadingView.swift](../../../apps/ios/Leafhour/TextReadingView.swift) | `UIAction` titles take strings outside SwiftUI's literal path. Image alternative text belongs to the source; only the app-owned fallback wrapper is localizable. |
| Errors, saved jobs and fallback metadata | [Models.swift](../../../apps/ios/LeafhourCore/Sources/LeafhourCore/Models.swift), [OfflineLibrary.swift](../../../apps/ios/LeafhourCore/Sources/LeafhourCore/OfflineLibrary.swift) | `LibraryError.invalid(String)` exposes the supplied message; import jobs can persist error text. Adding a UI catalog alone will not translate these values. Recovered placeholder titles are distinct from authentic source titles. |
| Existing UI automation | [ReadingUITests.swift](../../../apps/ios/LeafhourUITests/ReadingUITests.swift) | Tests locate many controls by Chinese labels. Introduce stable app-owned identifiers before broad locale changes; keep separate assertions that the accessible names are correctly localized. |

## Resource and rendering approach

Use an app-target `Localizable.xcstrings` catalog, keeping the existing English development-region choice consistent with complete English development values and explicit Simplified Chinese, Traditional Chinese and Japanese translations. This is a proposed implementation choice, not a change made by this document. Add/advertise each app locale only with its intended complete flow; translating navigation alone must not be reported as a fully localized app.

SwiftUI literals passed to localizable view initializers can be extracted by Xcode, but already constructed `String` values and UIKit titles need a deliberate localization boundary. Use localized resources/default values for app-owned status and menu messages. Use verbatim text for reader-owned content. Avoid converting arbitrary book text or legacy error messages into localization keys.

Use whole localized phrases with typed interpolation and translator comments. The comment should identify the count's meaning, the book-title placeholder, the point unit and the fact that a quote must remain source text. Do not concatenate translated noun fragments, or encode English plural rules in `count == 1` branches. For source/quote rows, prefer a localized ownership label beside a separate verbatim content view; verify their combined accessible reading order.

Keep locale resolution in app presentation, not in persisted reader preferences or a cached global singleton. Native app resources and any Swift-package resources are separate bundles: pick the owning bundle explicitly. Do not merely call `String(localized:)` inside LeafhourCore and assume it finds the app's catalog. A typed error code plus app-owned presentation is a later option; it needs compatibility coverage for existing persisted job errors and must not discard their diagnostics. Do not silently change saved job schemas in the first navigation batch.

## Candidate terminology

These are review candidates, not translator-approved or runtime-accepted copy. “Notes and drafts” describes the current records panel more directly than suggesting a complete reading-history service. Keep each route's title and its accessible name consistent in meaning; a long discovery hint need not be the title repeated word for word.

| Meaning | English | 简体中文 | 繁體中文 | 日本語 |
| --- | --- | --- | --- | --- |
| Personal library | My library | 我的书房 | 我的書房 | マイライブラリ |
| Book contents | Contents | 目录 | 目錄 | 目次 |
| Search this book | Search this book | 书内搜索 | 書內搜尋 | この本の中を検索 |
| Reading appearance | Reading settings | 阅读设置 | 閱讀設定 | 読書設定 |
| Return from a panel | Continue reading | 继续读 | 繼續閱讀 | 読書に戻る |
| Personal records route | Notes and drafts | 笔记与草稿 | 筆記與草稿 | メモと下書き |
| Author's text label | Source text | 作者原文 | 作者原文 | 著者の原文 |
| Verify the quote | Check source text | 核对原文 | 核對原文 | 原文を確認 |
| Keep an unfinished note | Keep draft | 保留草稿 | 保留草稿 | 下書きを残す |
| Commit a personal note | Save note | 保存笔记 | 儲存筆記 | メモを保存 |

Review the Traditional Chinese and Japanese candidates in context before shipping; these four columns do not establish support for every script/region. Match the same actual save/flush behavior across all wording. A translated success notice must never imply cloud synchronization or a completed save before the service confirms it.

## Counts, units and errors worth testing first

| Case | Proposed treatment | Evidence required |
| --- | --- | --- |
| Search result count | Locale-aware whole phrase; English candidates “1 matching paragraph” / “N matching paragraphs”. Chinese candidates “找到 N 段原文”; Japanese “N 段落が見つかりました”. | 0, 1, 2 and many matching paragraphs, including multiple matches within one paragraph. Preserve GET-300 cancellation/current-query behavior and exact result anchor. |
| Chapters vs PDF pages | Separate messages for page count and chapter count; preserve PDF's actual fixed-page meaning. Generated TOC/page labels need a presentation boundary separate from source headings. | One and many chapters/pages, PDF and heading-less EPUB TOCs, genuine source titles resembling generated labels, current/total progress and previous/next boundaries; read aloud without a misleading “chapter” for PDF. |
| Type and spacing | Localize the full visible point value and a spoken value with its unit, using locale-aware formatting. Preserve stored numeric preferences and OS Dynamic Type scaling. | Minimum/default/maximum values; decimal/grouping conventions where relevant; VoiceOver speaks value and unit; no clipped control in large type. |
| Source, title and filename placeholders | Keep actual content unchanged; localize only the surrounding app phrase. | Quotes with composed accents, emoji, `%`, braces, quotes and mixed directions; visible/copy/export text and saved scalar anchors remain correct. |
| Import/integrity/save failure | Translate app-owned diagnosis/action without strengthening the persistence promise. Keep unknown or legacy diagnostics available as detail. | Cancellation, corrupt original, absent file, interrupted job, save failure and retry. Assert retained-original or saved-record wording only when that state is confirmed. |

## Implementation order and acceptance gates

1. **Prepare without changing reader data.** Add stable accessibility identifiers for app-owned navigation and controls; retain meaningful localized labels as a separate assertion. Add the catalog and its actual target membership. Verify English-development fallback and the existing Chinese flow. Do not equate a checked-in JSON catalog with a packaged localization.
2. **Complete one connected flow.** Cover shelf → book → contents/search/settings → return, including PDF and heading-less EPUB contents, native selection-menu actions, notes/drafts, local ownership and reachable errors. Use whole phrases/count variants, and audit dynamic `String`/UIKit/Swift-package boundaries. Define generated-label provenance and legacy-title fallback before changing display logic; any future provenance field needs backward-compatible decoding, not a rewrite of existing titles. Expand to the four proposed UI locales only with truthful coverage.
3. **Exercise appearance and recovery.** On the guarded Primary, launch each supported UI locale through the normal native mechanism, using isolated public text. Test an unsupported locale's fallback, portrait/landscape, large/maximum accessibility type, keyboard-open note editing, dismissal, relaunch and exact return to source. Compact/iPad checks wait for an available guarded profile; do not borrow or stop somebody else's active device.
4. **Check meaning and accessible use.** Confirm localized names and discovery hints with real VoiceOver traversal, focus return and software/physical input where available. Screenshots and identifier-based automation do not prove pronunciation, focus order or keyboard behavior. The current TextKit1 reader's mixed-direction selection remains a separate regression surface; this plan does not migrate the engine.
5. **Compare data, then deliver.** Before/after locale changes, compare original files, source fingerprints, book/chapter/passage IDs, saved preferences, notes/drafts and their anchors/exports. Check compiled resource presence and relevant current-head tests/review/CI, merge normally, then record main CI, website publication and native distribution separately. Do not mark implementation accepted from this planning PR.

The current plan's validation is source/link/fingerprint review and repository checks only. It contains no new screenshots, simulated locale pass, native build, VoiceOver result, physical-device test or TestFlight release.

## First-party references checked

- [Apple: Localizing and varying text with a string catalog](https://developer.apple.com/documentation/Xcode/localizing-and-varying-text-with-a-string-catalog): catalog extraction, language-specific plural variants and per-locale testing.
- [Apple: SwiftUI Text localizable initializer](https://developer.apple.com/documentation/swiftui/text/init%28_%3Atablename%3Abundle%3Acomment%3A%29): literal vs string-variable localization behavior.
- [Apple: String localized initializer](https://developer.apple.com/documentation/swift/string/init%28localized%3Atable%3Abundle%3Alocale%3Acomment%3A%29): explicit table/bundle/locale boundary for non-view strings.
- [Apple WWDC25: Enhance your app's multilingual experience](https://developer.apple.com/videos/play/wwdc2025/222/): separate UI/content preferences and the TextKit2/multiple-selection boundary. It does not establish Leafhour's runtime behavior.
