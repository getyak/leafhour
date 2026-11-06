# Persistent Web reader controls

> Execute inline against the current public checkout. Use the existing source reader, conversation, settings, and device-local placement. This is the user's requested local source implementation and local review stage.

**Goal:** Keep a draggable AI character and a direct reading-settings entry visible during ordinary Web reading, outside the text and listening player.

**Scope:** Add a persistent dock, move the existing injected conversation entry into it, and open the existing settings dialog. Keep current reader tools, identity checks, conversation context, reading anchors, audio ownership and generation permissions. Do not port the standalone mockup or introduce another conversation/settings implementation. Leave deployment for the subsequent delivery stage after this local review.

**Files:** `app/reader-dock.mjs` owns dock mounting, safe geometry and disposal; `app/squirrel-position.mjs` remains the reusable pointer/keyboard placement helper; `app/reader.js` wires existing settings and chat; `app/reader-tools.mjs` returns chat focus to its visible entry. `app/index.html`, `app/reader-dock.css`, four UI catalogues, a decorative companion SVG and `release-files.json` supply the actual reader surface and build backing.

**Review focus:** Text selection and page turning must not consume dock gestures; dragging must not open chat; audio appearance and viewport changes must recheck placement; closing settings/chat must return to a visible control; disposed controllers must remove observers/listeners and restore moved DOM.

- [x] Write failing behavioral checks for obstacle placement, separate drag handles and dock DOM/wiring.
- [x] Extend existing placement with an optional handle, storage key and obstacle resolver. Preserve default library-launcher behavior.
- [x] Mount the persistent dock around the current chat entry and open the same settings dialog. Reserve a narrow side gutter only where needed, without changing the scroll owner.
- [x] Run affected reader, placement, conversation, settings and release/build checks; fix regressions.
- [x] Start the real application from current source with isolated local verification data and no model providers. Check the real reader, dragging, settings, audio-layout avoidance, return focus and a narrow viewport.
- [x] Obtain a fresh code review; record actual verification and leave the real source application running for the user.

Verification: `docs/verification/2026-11-05-web-reader-controls/README.md`. Dock styles load with the enhancement so existing startup budgets remain fixed. The local static route serves both the dock and the existing chat upload dependency.

## Follow-up: direct conversation/login popup

The user requested that clicking the AI character directly open the conversation as a popup and, for a guest, show login immediately. Reuse the existing shared home login form and auth controller, keep the book mounted under the modal, and reload through a validated current-book/paragraph `action=chat` return after authentication so account ownership is recaptured. Desktop conversation uses a nonmodal popup; narrow windows retain the contained full-screen interaction. No sign-in, password change, model request or remote publication is performed by this implementation task. Verify guest bypass, popup identity/focus/scroll behavior, safe auth return, loader disposal and actual local login presentation.
