# Reading and listening as two views of one book

The user requested implementation of a quiet composer, contextual citations, document-like assistant answers, reliable single/rapid page taps, and immersive selectable bilingual listening. Continue the current iOS-first work; preserve web and account contracts. Existing authorization permits implementation and normal reviewed PR/merge without another design approval.

## Design

Use the existing SwiftUI reader, profile preferences and local speech engine. A 16-point, lightly outlined composer holds the growing draft and small microphone/send actions. Its pending context is a compact expandable line above the input, with source attribution and removal. Saved citations use a thin leading rule. Assistant output stays selectable Markdown without a bubble. Tool/source details remain secondary disclosures.

Listening fills the reader destination with a continuous lazy chapter transcript. Paragraphs retain stable chapter/passage/layer identities; native text selection and Copy remain available. A short tap seeks to the actual sentence; a hold selects. Translation is paired by paragraph, never invented sentence alignment, and missing/stale translations are labeled. Existing literal/interpretive variants stay separate. Listening uses the same paper, font, size and spacing as reading. A profile-scoped comparison switch controls visible translation without changing the spoken language.

Controls overlay the transcript, appear on entry/pause or explicit reveal, and hide after inactivity while playing. Selection, scrolling, accessibility focus and settings prevent unwanted hiding/following. Navigation, previous/next chapter, speed and shared appearance are reachable from the bottom. Hold the speed control to accelerate temporarily within 0.5–5×, restoring the chosen rate on release/cancellation/background/disappearance. Rate changes do not generate speech or persist a temporary boost. Reading gets explicit previous/next chapter actions in its awake navigation.

Preserve center tap for reading tools and side taps along the full height for pages. Audit native recognizers and page animation queues, with real rapid-tap UI tests; long press, links, selection handles, VoiceOver and PDF zoom retain their behavior. Do not attribute an older installed build's symptom to current source without reproduction.

## Approach and limits

Extend presentation and the existing speech cursor rather than build another player or storage system. Native paragraph text views provide deterministic selection/tap arbitration and retain Unicode/Markdown offset mapping. Lazy paragraph layout avoids whole-book layout. Only explicit playback/seek starts audio. Opening, comparison, appearance and speed changes never start playback or call a paid model.

Verification uses isolated synthetic books, speech probes and the dedicated Leafhour simulator. CI, merge, production publishing, TestFlight processing/distribution and physical-device acceptance are separate facts.
