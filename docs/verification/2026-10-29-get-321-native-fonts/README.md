# GET-321: iOS native font inventory

Date: 2026-10-29, Asia/Shanghai. Scope: inspect the existing iOS 26.5 simulator's UIKit/Core Text font inventory and a small synthetic language matrix before choosing whether a bundled reading font is needed. This does not change Leafhour's font, UI, preferences, data, or offline behavior.

## Runtime observations

On the existing iPhone 17 Pro simulator (iOS 26.5), UIKit reported 86 font families and 303 face names across UIKit/Core Text. Each of the 303 enumerated names produced a UIFont whose resolved PostScript name exactly matched the request. The system serif Dynamic Type sample resolved to 22 pt at the Large category and 62 pt at Accessibility XXXL.

The diagnostic shaped seven synthetic samples (English, Simplified Chinese, Traditional Chinese, Japanese, an ambiguous two-character Han sample, Korean, and mixed/unknown text) with and without a declared language hint at both sizes. It recorded Core Text's actual font per UTF-16 range. In this bounded sample:

| Sample | No language hint | Declared language hint |
| --- | --- | --- |
| `閱讀字體：漢字、邊界與安靜的書頁。` | PingFang UI Display SC | PingFang UI Display TC |
| `読書の時間。かな・カナ・漢字。` | PingFang UI Display SC plus CJK Symbols Fallback SC | Hiragino Mincho ProN (`HiraMinProN-W3`) |
| `読書` | PingFang UI Display SC | Hiragino Mincho ProN (`HiraMinProN-W3`) |
| Korean sentence with Latin punctuation | Apple SD Gothic Neo I plus New York | same observed runs |

`HiraMinProN-W3` was present in the enumerated names and, when requested directly, resolved to the same PostScript name. Core Text reported its resource as `HiraginoMincho.ttc` with a raw file length of 19,357,152 bytes. That is one system resource file observation, not an app-install delta, memory measurement, or reason to sum the same TTC once per face.

The private run aliases `.AppleColorEmojiUI`, `.AppleSDGothicNeoI-Regular`, `.CJKSymbolsFallbackSC-Regular`, `.NewYork-Regular`, and the PingFang UI names constructed a UIFont object when passed to `fontWithName:`, but UIKit resolved those requests to `TimesNewRomanPSMT`. Therefore “UIFont returned non-nil” alone is not evidence that a requested PostScript face loaded; the probe records exact identity separately. This distinction was added after the intermediate run exposed the fallback behavior.

No zero glyph IDs appeared in these particular samples. This is raw shaping evidence only; zero-glyph counts do not certify broad script coverage or visual quality. The Japanese result demonstrates that an explicit language hint changed fallback for these samples. It does not establish that Leafhour currently supplies trustworthy source-language metadata to its reader.

## Reproduction and evidence

The small Objective-C probe and guarded driver are beside this report. Run only when the shared simulator guard is available:

```sh
IOS_XCODE_JOBS=2 dev-ios-session run --profile primary --timeout 5 -- \
  python3 docs/verification/2026-10-29-get-321-native-fonts/run-font-inventory.py
```

The driver compiles one standalone UIKit/Core Text simulator command-line program with warnings as errors, runs it on the existing Primary device, and records a task-owned artifact. It does not build or install Leafhour, register or download a font, change simulator settings, or alter app data. The shared simulator was already booted and remained booted. This is not an airplane-mode test; network settings were not changed.

The final run's sanitized summary is [`inventory-summary.json`](inventory-summary.json). Full run output, source, compile command, receipts, and the first/superseded comparison runs are retained in the control workspace's `native-font-inventory-evidence.tar.gz`; its checksum and exact contents are recorded in the matching preservation manifest. Local simulator paths are intentionally excluded from this public summary.

## Decision and limits

This result changes the next step: before downloading or bundling a CJK candidate, compare a known-language Japanese sample using the actual Hiragino Mincho face against the current generic-serif fallback, while preserving an explicit fallback for unknown language. For Chinese, the tested language hint selected the corresponding PingFang SC/TC forms; a bundled Chinese serif is not justified by this inventory alone. Any future face choice still needs trustworthy book-language provenance, subset/fallback behavior, shared preview/body resolution, reflow/selection/cold-return checks, and measured install/render costs.

The run sampled one simulator OS/device, seven short synthetic strings, and two text sizes. It did not validate actual book rendering, glyph coverage, appearance preference behavior, offline launch, the installed Leafhour app, VoiceOver, iPad, physical devices, TestFlight, bundle-size impact, memory, or scrolling performance. Do not treat these results as an accepted font selector or runtime product change.
