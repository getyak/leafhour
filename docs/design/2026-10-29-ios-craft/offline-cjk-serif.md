# Evaluate offline CJK serif fonts for native reading

Date: 2026-10-29, Asia/Shanghai. Task: [GET-302](https://linear.app/getyak/issue/GET-302), under [GET-296](https://linear.app/getyak/issue/GET-296). Leafhour source baseline: `51ce8cf417452489915c99ba0ab2469e5c771f12`.

This is an upstream-metadata review and a proposal for a bounded native comparison. No font binary was downloaded, registered or added to Leafhour; no app source, preference or data schema changed. The operations pause remained active. All glyph, rendering, performance and device acceptance below is future work.

## What prompted the investigation

The earlier [native diagnostic](../../verification/2026-10-29-ios-font-diagnostic/README.md) found New York for the literal Latin sample and PingFang for the checked Chinese/Japanese samples on iOS 26.5. Three queried Songti/Mincho names could not be loaded. That does not establish that every CJK serif is absent or that every language follows the same fallback. A generic serif request is insufficient evidence of Chinese serif output.

First inventory actual usable native faces on the target runtime when guarded native work resumes. A suitable installed face would avoid a bundled font's storage cost. If an additional offline font is needed, compare one Regular face in a region subset against the corresponding upstream full-CJK configuration before adding a font selector or changing the default.

## Reproducible upstream snapshot

[Candidate metadata](../../verification/2026-10-29-get-302-font-candidates.json) pins the commits, Git blob object IDs, exact repository paths, tree API URLs and byte counts. Noto was checked at `f8d157532fbfaeda587e826d4cd5b21a49186f7c`; Adobe's `2.003R` tag was verified to resolve directly to `7889f11bf31170b5d092a083b357c8c8130f89e0`. Pinned directory/tree references were checked and were not truncated. These are candidate filenames, not verified UIFont/PostScript names.

The sizes below are upstream Git file sizes. MiB means bytes divided by 1,048,576; no IPA, installation, memory or latency delta was measured. Upstream release ZIPs group multiple weights/configurations, so their download sizes must not be substituted for one font's cost. “Full CJK” names the upstream configuration and does not promise every Unicode character.

| Upstream configuration / filename | Exact bytes | MiB | Prototype implication |
| --- | ---: | ---: | --- |
| Noto regional SC Regular: `NotoSerifSC-Regular.otf` | 11,625,800 | 11.09 | Smaller known-Chinese candidate; investigate missing-character fallback |
| Noto full CJK SC Regular: `NotoSerifCJKsc-Regular.otf` | 24,543,080 | 23.41 | Broader upstream configuration with SC default forms |
| Source Han regional CN Regular: `SourceHanSerifCN-Regular.otf` | 11,626,108 | 11.09 | Alternative pinned distribution; `CN` is the subset filename here |
| Source Han full CJK SC Regular: `SourceHanSerifSC-Regular.otf` | 24,543,332 | 23.41 | `SC` here is the full configuration, not the CN subset |
| Noto regional SC variable: `NotoSerifSC-VF.otf` | 22,613,272 | 21.57 | Compare only if multiple weights/weight interpolation have a reader need |
| Noto full CJK SC variable: `NotoSerifCJKsc-VF.otf` | 55,379,832 | 52.81 | More storage than a single Regular; variable support still needs native verification |
| Noto five-language variable OTC: `NotoSerifCJK-VF.otf.ttc` | 57,488,648 | 54.83 | Shared multi-face packaging; file size alone does not settle registration or memory behavior |

For scale, the pinned Noto JP and TC Regular subsets are 6,210,492 bytes (5.92 MiB) and 7,936,104 bytes (7.57 MiB). Adobe JP/TW counterparts and all selected metadata are in the JSON. These counts do not compare visual quality or prove identical outlines between packages. Start with one upstream for the first comparison rather than installing every distribution and weight.

## Language and coverage decisions

The upstream guides distinguish region subsets from language-specific full configurations, and describe language tagging/`locl` for alternate localized glyphs. Correct Han forms require more than detecting “contains Chinese-looking characters”. Japanese and Chinese can share code points while requiring different shapes. Interface language is not the source passage's language.

Current [LocalBook/Passage models](../../../apps/ios/LeafhourCore/Sources/LeafhourCore/Models.swift) have no explicit source-language property, and [BookParser](../../../apps/ios/LeafhourCore/Sources/LeafhourCore/BookParser.swift) does not capture EPUB language metadata. Therefore a global SC face chosen from the UI locale would be an unvalidated policy. For the first prototype, use a public/synthetic fixture whose language and region are explicitly known. Before broader adoption, define how reliable source-language metadata and mixed-language passages are handled; preserve unknown/legacy content and its existing rendering route. Do not rewrite source strings or infer locale from a stored title.

Subset omissions, rare Han characters, variation selectors, kana, hangul, punctuation, composed accents, emoji and Latin all need actual fallback tracing. A CJK candidate can also change Latin metrics, line breaks and appearance. Record which font renders the checked ranges, not merely the requested family name. Missing-glyph fallback must remain usable offline and must not silently initiate a font download during reading.

## Application integration boundary

The [UIKit reader](../../../apps/ios/Leafhour/TextReadingView.swift) currently derives its font from `withDesign(.serif)` and `UIFontMetrics`; the [settings preview](../../../apps/ios/Leafhour/ReaderPanels.swift) separately requests SwiftUI's system serif. A future candidate must use the same resolved face, region choice and scaling policy in both places. Otherwise the immediate preview would misrepresent the book. Body typography can change while interface controls retain their semantic system fonts.

Verify the exact registered PostScript names and successful UIFont construction from the actual chosen binary before exposing a choice. An upstream filename or a guessed family string is not proof of registration. Preserve Dynamic Type and a known working fallback. Measure headings/weight behavior separately instead of silently substituting a synthesized style.

Font changes also exercise the [reflow/anchor lifecycle](../../verification/2026-10-29-get-296-rotation-baseline/README.md). Test selection, source quotes, explicit search jumps, rotation and cold return while changing typography; do not treat a settled paragraph screenshot as exact-anchor preservation. Before persisting a new font preference, define backward-compatible decoding and handling of unknown choices. Current `ReaderPreferences` is Codable with no font-choice field; old notes/drafts/state must not become unreadable or be reset when a field is added.

## License and provenance facts

The pinned [Noto license](https://github.com/notofonts/noto-cjk/blob/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Serif/LICENSE) and [Source Han license](https://github.com/adobe-fonts/source-han-serif/blob/7889f11bf31170b5d092a083b357c8c8130f89e0/LICENSE.txt) declare SIL Open Font License 1.1. Their text permits software bundling/embedding subject to its conditions, including retaining notices/license and the font's license. Adobe's checked license explicitly identifies `Source` as a Reserved Font Name. This does not relicense a bundled font under the app's AGPL license.

For a chosen binary, record its own copyright/name metadata and retain the corresponding unmodified upstream notice/license with the distributed resource. The repository's generic license alone is not a binary metadata inspection. Prefer an upstream-provided subset for the initial comparison; a custom subset would require reviewing the modification/naming conditions and recording the derivation. This research adds neither a font nor a new font notice to the application bundle.

## Bounded validation sequence and decision

1. **Confirm the target runtime.** Under the device guard, inventory usable installed faces and reproduce the relevant per-range fallback with exact fixture text. Preserve the diagnostic's limited scope; do not generalize three failed font names to an exhaustive system inventory.
2. **Load two controlled candidates.** Once the pause is cleared, retrieve the selected upstream Regular subset and full configuration at the recorded commits, calculate actual file SHA-256, inspect their name/license metadata, and verify registration/loading in an isolated prototype. The Git blob IDs in this document are provenance references, not completed binary SHA-256 validation.
3. **Compare the same reading state.** Use fixed public/synthetic Chinese plus mixed-language samples at 16/22/36 pt and large accessibility sizes. Compare baseline/subset/full on the same text, spacing, device and build mode. Check actual font runs, rare-character fallback, punctuation/line breaks and preview/body agreement. Preserve source bytes, notes/drafts and scalar anchors.
4. **Measure costs and interruption.** Record raw bundled size separately from release archive/thinned-install delta, first display time, scrolling latency and resident memory. Include rapid preference changes, active selection, immediate search navigation, rotation and cold resume. State simulator/build mode and sample size; do not promote a simulator result to physical-device performance. iPad and physical/VoiceOver checks remain separate until those surfaces are available.
5. **Choose from observed benefit.** Keep the reliable native default until a loaded candidate visibly improves the intended source-language reading experience and its costs are acceptable. Adopt a regional Regular only with verified coverage/fallback and language handling. If multiple weights or regions are needed, compare variable/collection packaging with measured app behavior instead of summing nominal file sizes. An unavailable candidate never becomes a selectable option. Do not automatically select a bundled SC face solely because a book's language is unknown.

This is a recommendation to run a narrow comparison, not a commitment to a new default or a claim that a smaller subset wins. The current observation supports keeping native behavior and preparing a reproducible offline experiment. Native loading, glyph forms, typography acceptance, bundle costs, performance, physical devices and TestFlight remain unverified for these candidates.

## First-party format guides

- [Noto Serif CJK pinned deployment guide](https://github.com/notofonts/noto-cjk/blob/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Serif/README.md)
- [Source Han Serif pinned deployment guide](https://github.com/adobe-fonts/source-han-serif/blob/7889f11bf31170b5d092a083b357c8c8130f89e0/README.md)
- [Source Han Serif 2.003R release](https://github.com/adobe-fonts/source-han-serif/releases/tag/2.003R), used to distinguish grouped ZIP assets from individual font files
