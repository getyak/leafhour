# Bounded native font fallback diagnostic

Date: 2026-10-29. This diagnostic recreates the current native reader's `UIFont.systemFont → withDesign(.serif) → UIFontMetrics(.body)` construction, then queries the supplied character ranges with [Apple Core Text's fallback API](https://developer.apple.com/documentation/coretext/ctfontcreateforstring%28_%3A_%3A_%3A%29). It ran as a read-only simulator process through the existing Primary iPhone guard, using the iOS Simulator SDK. It neither modifies the reading app nor loads a book or account.

The exact [source](font-probe.swift), [output](output.txt) and [hashes](evidence.json) are retained. The final run explicitly reports iOS 26.5. An earlier compiler invocation had a host-sysroot warning; the retained run uses `xcrun --sdk iphonesimulator swiftc` and has no such warning.

| Literal range / query | Observed result |
| --- | --- |
| Primary native serif and `Reading` | `.NewYork-Regular` |
| `阅读` | `.PingFangUIDisplaySC-Regular` |
| `読書` | `.PingFangUIDisplaySC-Regular` |
| `한글` | `.AppleSDGothicNeoI-Regular` |
| `UIFont(name:)` for SongtiSC-Regular, SongtiTC-Regular and HiraginoMinchoProN-W3 | Unavailable for those names in this runtime |

Core Text chooses a font for the specified string range from the current font's cascade. A result for two Han characters must not be generalized to all Japanese text, all CJK glyphs, another system version or another language configuration. The failed name queries are not a full installed-font inventory. No new Chinese-serif visual or physical-device acceptance is claimed.

To reproduce, use a directory returned by `dev-storage-guard new-artifact`, check resources and audit, and run compilation and the process through `dev-ios-session run`. Compile the saved source with `xcrun --sdk iphonesimulator swiftc`, an explicit `-sdk` path from that SDK, target `arm64-apple-ios17.0-simulator`, and UIKit/CoreText frameworks. Run the resulting binary using `xcrun simctl spawn` on the selected existing Primary iPhone. Retain the complete output and source hash. Do not install or download fonts to make a missing-name query appear successful.
