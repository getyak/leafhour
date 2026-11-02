# iOS reading, selection and listening

User request: make every reading theme match its controls, expose more vertical text, integrate selection with AI, make reading time visible and attributable, and provide an immersive listening destination in both orientations. User selected iOS first. Existing account, source/layer and generation permissions continue to apply.

## Direction

Use the existing native reader and conversation, with a shared paper-tinted glass control material. iOS 26 uses native Liquid Glass; iOS 17–18 use material, and Reduce Transparency uses an opaque matching surface. Controls derive their appearance from the selected paper, including system, white and both dark papers. Glass stays on controls rather than body text.

Keep the existing stable paged viewport but reduce its ordinary top/bottom margins from 16/44 to 4/48 points (net eight more points for text). Scrolling reserves smaller top/bottom end insets; waking tools does not repaginate. Keep 44-point actions, Dynamic Type wrapping and native text selection.

Selection reveals a compact quote/action dock with copy, note and a connected AI circle. Both tapping AI and dropping the selected quote open the existing full-height Chat with its stable paragraph, layer and translation attribution. A draggable excerpt supplies an accessible alternative to dragging selection handles. Validate drops against the current quote; arbitrary external text cannot impersonate book content. No request is generated merely by selecting, dragging or opening Chat.

A small glass time capsule remains in the quiet footer. Foreground estimate starts on entering the reader by default, can be disabled in profile-scoped reading preferences, pauses outside the reading surface and respects explicit pause. Focus sessions still start explicitly. A book-time destination flushes the existing ledger before reading it, shows local totals by date, and loads authenticated cloud month totals for account books. Local and cloud observations remain labeled independently rather than added together. Failed or absent data never appears as a measured zero. Historic unrecorded time is not inferred.

Listening is a full-screen navigation destination instead of a half sheet. Portrait stacks book identity, a scrolling sentence stage and transport; landscape puts identity/transport beside the sentence stage. Sentences come from actual selected-layer speech text and follow actual playback callbacks, with current-word emphasis. Opening, speed changes and navigation do not autoplay. Existing offline system speech, resume position, background pause and 0.5–5× speed remain. Reduced Motion disables following animations.

## Approaches considered

1. Restyle the existing sheets only: smaller scope but leaves listening cramped and the AI entry hidden.
2. Reuse domain services and replace presentation/entry points (chosen by the implementer): retains data semantics while addressing the complete interaction.
3. Build separate AI, timer and audio subsystems: duplicates mature account and speech behavior and introduces unnecessary migration.

## Verification

Use real native layout and interaction tests, every paper in light/dark systems, narrow and accessibility layouts, actual selection-to-Chat and drag, portrait/landscape listening, pause/no-autoplay and recording lifecycle tests. Review simulator screenshots. CI, merge, TestFlight processing and physical device acceptance are separate facts. Do not upload user books or invent listening durations.
