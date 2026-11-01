# GET-352 · iOS reading, listening and sharing

Date: 2026-11-01. Linear: [GET-352](https://linear.app/getyak/issue/GET-352). Base: public `getyak/leafhour` main `85bf3a3`.

## Intent and decisions

The user requested research, design, implementation, refinement and evaluation by separate subagents. Reading should feel like opening a book: a quiet page, horizontal turns, familiar settings in the next book, and a contents list that helps the reader find their place. Listening needs a draggable **0.5×–5×** speed range. Sharing includes book and selected-text cards, usable links, system platform destinations, and an explicit import route into the app.

Routine design and implementation decisions are delegated to the agents under the repository's autonomous delivery authorization. Unspecified platform additions use the native share sheet; no third-party social SDK, new paid service, automatic posting, or automatic public upload is introduced.

## Reading and shared preferences

Default to horizontal paged reading. Preserve explicitly chosen continuous scrolling. Add a public UIKit page-curl presentation while retaining the existing TextKit line-fragment pagination, original source anchors, native selection/copy, links, translation layers and PDFKit. Reduced motion uses immediate or restrained transitions. The page stays selectable after each transition; a decorative screenshot must never replace the real reading surface.

Preferences belong to the current `LibraryScope`, across all of that scope's books. Existing per-book preferences seed a missing shared profile without changing book progress, notes, drafts or source IDs. The latest shared profile is authoritative on subsequent book openings. Device and account profiles remain separate. New defaults are paged; missing legacy navigation mode does not silently become an explicit scroll choice. Values are validated when decoded and saved.

The shared profile includes typography, spacing, paper, navigation, reading layer, `speechSpeed` (default 1, 0.5–5) and `autoPageInterval` (default 30 seconds, 5–120). Playing speech and running automatic turns are transient and never start after launch merely because a preference exists.

Alternatives considered: rebuilding the reader around a permanent page controller would put native selection, source restoration and translations at risk; retaining the existing viewport and adding a bounded native transition keeps those mature behaviors. Merely renaming the existing push animation would not satisfy the request.

## Contents and automatic turns

Use one calm native contents list in the real source order. Emphasize the current chapter, expose a direct action to locate it, and offer local title search. Remove previous/next controls and the chapter slider that navigates on every drag. The current model has no trustworthy EPUB navigation hierarchy; do not invent one from numbering or indentation. A missing search result is a truthful empty state, and clearing search restores the list.

Automatic page turning is an explicit reading tool with a 5–120 second interval (5-second steps, default 30), a reachable pause/resume/end control and an observable status. A page command carries the expected reader navigation identity; stale commands cannot turn a new chapter after a manual jump. Acknowledgement comes from the actual text/PDF viewport. Stop at the end of the book. Suspend or pause on background, selection, touch, open tools, listening and assistive reading; do not count generated turns as a real user interaction. Relaunch starts stopped.

Alternatives considered: continuous scrolling does not meet the requested page-turn experience; a timer calling `nextChapter` skips real pages. Use the existing viewport's measured pages and explicit outcomes instead.

## Listening speed

Show one generous slider with the current multiplier and readable endpoint labels. Apply a drag deliberately, preserving the current listening position; accessibility supports incremental adjustment. Persist speed through the shared preferences without persisting playback.

`AVSpeechUtterance.rate` is a bounded synthesis control, not a linear arbitrary playback multiplier. The previous `defaultRate * speed` clamps at the system maximum. A five-times label must therefore be backed by actual audio-rate processing, with speech markers tied to playback rather than synthesis-ahead callbacks. Use local synthesis and AVFAudio only, preserving pause, interruption, saved position and highlighted sentence behavior. No model or cloud audio calls.

## Sharing and import

Reuse the Web's existing canonical links and permissions. Start from a preview of exactly what will leave the device. Book information and selected text are separate payloads; notes, drafts, reading history and private book contents never join by default. A selected-text card retains the actual text, author, book and truthful original/translation label. A long selection must remain readable and fully available in the exported payload, without a silently cut quotation.

Offer image/card sharing, plain text where useful, and copy-link only where a valid authorized link exists. Use `UIActivityViewController`/native item representations for installed platform destinations, including appropriate iPad popover presentation. The system decides available apps; absent social apps are not a product failure. Do not claim direct posting acceptance from merely showing the share sheet.

App import accepts supported local document URLs and bounded recognized Leafhour share/import links. Parse and validate before fetching, present the book and require the reader's import action, reuse authenticated domain services, deduplicate and preserve existing records. Never fetch arbitrary remote URLs with account credentials. Universal links need an exact associated-domain/AASA/configuration chain; a working custom scheme is reported separately from a signed production universal link.

Alternatives considered: platform-specific SDKs add permission and maintenance costs without improving the first useful share flow. Use a well-composed native preview and the system share sheet, with explicit fallback where the Web link cannot confer access to a private original.

## Validation and delivery

Use synthetic local fixtures and existing isolated test identities. No real password or token enters source, logs or evidence. Keep the shared Primary iPhone and serialize all native build/test operations through `dev-ios-session`. New test/build artifacts live under the task's registered artifact path. Keep default and maximum Dynamic Type, narrow width, reduced motion, selection, links, source/translation layers, book boundaries, backgrounding and relaunch in scope.

Each optimization receives its own commit, with one final PR and one Linear issue. Review the complete integrated diff independently; fix confirmed P0/P1 findings before normal merge. Record Core/application/UI/host tests, CI, merge, Production, TestFlight processing and physical-device acceptance as separate evidence. Simulator and Apple processing do not prove real-device audio quality or installation.

## Primary sources

- [Apple: AVSpeechUtterance.rate](https://developer.apple.com/documentation/avfaudio/avspeechutterance/rate)
- [Apple: synthesis buffers and markers](https://developer.apple.com/documentation/avfaudio/avspeechsynthesizer/write(_:tobuffercallback:tomarkercallback:))
- [Apple: AVAudioUnitTimePitch.rate](https://developer.apple.com/documentation/avfaudio/avaudiounittimepitch/rate)
- Domain-specific subagent reports will add the exact interaction and sharing sources used during implementation.
