# Quiet iOS reader interactions

The user approved the November 3 discussion and asked to proceed. This supersedes the November 2 design's persistent quiet-footer timer and AI button.

## Behavior

Normal reading starts with only the book. Hide the navigation, progress, timer, AI and listening transport until the reader taps the center. Turning pages dismisses controls. Long press retains native selection, handles, Copy and attributed actions. Selection reveals the existing compact excerpt/actions; tapping AI and dropping the excerpt open the same Chat. VoiceOver activation gestures, links, PDF pinch zoom and selection handles remain available.

Continuous short taps turn pages individually without waiting for double-tap selection. Hold selects; rapid taps cannot become a selection. Keep a profile-scoped page-tap delay setting (0–0.5 seconds, 0 default) inside the secondary navigation settings. Delay each eligible turn independently and cancel pending turns when the view, external navigation, preferences, selection or foreground changes. Page animation is independent of this response setting. Do not alter the system's accessibility double tap.

Quiet text uses a stable viewport with 4-point top and 8-point bottom internal margins, inside system safe areas. Waking tools overlays it without repagination. Scrolling uses the same small end margins. Explicitly enabling automatic page turning may show its existing countdown/pause control; ordinary automatic foreground time recording does not show anything. Optional always-visible progress defaults off and lives in secondary reading interaction settings. Opting in reserves its scaled one-line height so it cannot cover the final source line.

Automatic foreground time recording, explicit pauses and background suspension retain their current accounting rules. No idle, active, paused or finished timer capsule appears over the quiet book or while listening. Reading statistics and manual time controls remain in the existing reading-tools destination. Listening transport appears on waking controls or opening listening, and is hidden with tools during quiet reading.

## Chat quotes

A newly selected/dropped excerpt explicitly replaces the draft quote while preserving the question. Ordinary refresh does not replace an existing draft's context. An uncertain in-flight request retains its immutable request and quote; a new selection remains pending until that request is resolved. Never attach arbitrary dropped text to a book.

Put the pending quote directly above the composer, outside the scrollable history. Show its exact selected text, book/chapter and original/translation attribution, with expand and remove actions. Removing the excerpt leaves the captured paragraph visibly labeled as current paragraph, without an attached excerpt. Removing an explicit excerpt changes the pending context back to the captured paragraph; it must not silently reattach on refresh. Local-only books show the same quote UI without generating requests. Send uses precisely the displayed context. Saved messages display their own saved quote, rather than relying on a mutable conversation header.

## Approaches

1. Keep a faint persistent footer: convenient controls, but continues occupying attention and text space.
2. Hide controls by default and reveal on center tap/selection (approved direction): an extra tap for controls, more uninterrupted text. Use existing reader, clock and conversation services.
3. Rebuild reader/chat: unnecessary migration and additional account/quote risks.

## Verification boundaries

Synthetic local books and isolated URLProtocol responses only. Verify native gesture, layout, Unicode quote, recovery and request semantics; Core persistence; simulator interaction/screenshots. Review and delivery are separate from TestFlight processing/distribution and physical-device acceptance. No live user records or paid-model calls are needed.
