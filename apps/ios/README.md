# Leafhour native iOS

This is the native, device-local reading implementation for GET-276. It runs without Apple account login, remote services, model calls or a subscription. It does not register an Apple application. The checked-in debug identifier is for unsigned local development only; distribution must reuse the separately verified existing Leafhour App Store Connect app.

## Build and test

Requires Xcode 16+ (iOS 17 minimum), Swift 5.9+, and the existing shared iOS guard on this Mac. ZIPFoundation is pinned to 0.9.20 and vendored with upstream blob checksums. No sample books or personal data ship in the app.

```sh
# Use an output path issued by dev-storage-guard new-artifact GET-276-native.
dev-storage-guard audit
dev-storage-guard resources
dev-ios-session run -- swift test --package-path apps/ios/LeafhourCore --scratch-path "$LEAFHOUR_IOS_ARTIFACT/swift-build" --jobs 2
dev-ios-session run -- xcodebuild -project apps/ios/Leafhour.xcodeproj -scheme Leafhour -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath "$LEAFHOUR_IOS_ARTIFACT/DerivedData" CODE_SIGNING_ALLOWED=NO build
```

The Xcode project is generated from `project.yml` with XcodeGen and committed for build reproducibility. `Config/Signing.local.xcconfig` is ignored. Only after the existing Apple app and permissions are verified, set its `LEAFHOUR_BUNDLE_ID` and `DEVELOPMENT_TEAM` there. Release configuration intentionally has no default registered application identifier.

The optional `LeafhourUITests` scheme tests system selection, EPUB chapter XII/cold resume, note drafts after relaunch, and a 73-page PDF. Seed `Alice-complete.epub` (12 complete public-domain narrative chapters) and `Alice-complete.pdf` (73-page complete local catalog-text derivative) in the task-owned test app’s Documents using the system picker/guarded setup. Do not erase or reinstall a user’s app for these tests. Retain the `.xcresult` through source delivery. Actual run scope and evidence are in [GET-276 verification](../../docs/verification/2026-10-27-get-276-native/README.md). No signing configuration is evidence of App Store Connect access, distribution or acceptance.

## Local data and import contract

Files selected through the system picker are copied under a device-local Application Support library before parsing. Original bytes identify duplicates and content versions. Complete EPUB spines and their local assets are parsed in order; every PDF page remains available in the original PDF, including pages with no extractable text. TXT/Markdown are plain-text imports. Parsing never invents text, translations or OCR results. Source files never enter this Git repository.

Archive entries are bounded by count, per-entry size and total expanded size. Absolute paths, parent traversal, symbolic links, duplicate archive names, unsupported encryption and missing spine content are rejected. CRC and offline file hashes are checked. A staged import becomes a book only after the complete original, content index and resources have been written and verified. Failed/interrupted jobs retain their copied original and offer an explicit retry; reconnecting never starts a paid task.

Imported books are already on this device. “Available offline” means the complete local manifest has passed verification; it never means a network request merely started. A failed integrity check offers repair from the retained original. No cloud upload/download status is displayed as complete. Device-local identity is distinct from future authenticated account UUID scopes; account tests must not be read as acceptance of a cloud login or sync service.

Stable chapter/passage identifiers and source versions bind reading position, notes and drafts. State writes are atomic and serialized. Duplicate imports leave existing personal state intact. Native text selection keeps copy available; author text, a selected quote and personal notes are labeled independently. No literal/interpretive translation is fabricated when none was imported.

## Native flows and states

```mermaid
flowchart LR
  Welcome[Start on this device] --> Library[Library]
  Library --> Picker[System file picker]
  Picker --> Copy[Retain original]
  Copy --> Parse[Parse complete EPUB / PDF]
  Parse --> Check[Verify whole offline manifest]
  Check --> Reader[Continue from stable position]
  Parse --> Failed[Retained source / explicit retry]
  Check --> Failed
  Reader --> Contents[Contents / search]
  Contents --> Reader
  Reader --> Selection[System text selection]
  Selection --> Draft[Anchored note draft]
  Draft --> Notes[Saved personal notes]
  Notes --> Reader
  Reader --> Preferences[Type / spacing / theme]
  Preferences --> Reader
  Library --> Detail[Original / offline integrity / export]
```

The reader starts with its chrome asleep. Top and progress controls wake independently from explicit edge buttons and have accessibility labels. Ordinary text taps do not summon an AI interface. Tools overlay the page; notes use the native half sheet and preserve their original quote. No unconnected cloud companion is presented as a working model service.

## Separate pending acceptance

TestFlight archive/upload, Apple processing, distribution, authorized tester invitation/acceptance, physical installation, an actual TestFlight update with retained data, full VoiceOver and real-device timing remain separate pending acceptance. Apple browser/authentication and physical-device availability must not block source work. Cloud authentication, upload/sync, conflict handling and translation/companion service integration need their own actual integration evidence. Keep GET-276 In Progress until its complete issue acceptance is satisfied.

Reference APIs: [Apple fileImporter and security-scoped access](https://developer.apple.com/documentation/swiftui/view/fileimporter(ispresented:allowedcontenttypes:oncompletion:)), [Apple PDFKit](https://developer.apple.com/documentation/pdfkit), [ZIPFoundation 0.9.20](https://github.com/weichsel/ZIPFoundation/releases/tag/0.9.20).

## TestFlight release automation (disabled)

The reviewable archive/upload/Apple-confirmation chain, signing audit and maintenance workflow are documented in [native TestFlight operations](../../docs/ios-testflight-release.md). `release.json` owns the native marketing version. This source does not configure credentials or a registered application, authorize the first upload, or enable automatic updates. Keep those decisions and real-device acceptance separate from simulator CI.

