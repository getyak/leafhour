# Reading controls and a companion you can talk to

User feedback following GET-357. Scope: Web and native iPhone/iPad reading, shared account conversation service. The user explicitly confirmed both clients during investigation. Linear connector discovery succeeds but calls return `not available to the model`; keep this limitation separate from GitHub delivery.

## Experience

- Reading style has three short categories: text, paper, reading. Text uses a live excerpt, typeface samples, a size slider and spacing slider. Paper is a row of color swatches with accessible names and a selection mark. Reading groups source/translation and navigation. Secondary explanations appear only where a decision requires them. Required translation scope, cost and missing-content facts stay visible at the relevant action.
- Contents becomes a compact modal panel over the page (native side panel; Web compact dialog). Tapping the dimmed area closes it without turning a page. A close button, native left-swipe dismissal, search and current-location action remain available. Body typography is smaller than reading text and still scales for accessibility.
- Global Chat opens directly to a companion identity, greeting and composer. No book is required, including in an empty library. A book button can explicitly switch to an existing book conversation; returning to the companion restores the account conversation. The server exposes account chat independently of book resources and grants the existing read-only library/network tools. No invented book, automatic download, note access or progress write is introduced.
- Reader conversation and selection explanations use one full-height destination instead of the reading tools sheet (native navigation; Web same-document full viewport and browser Back). The book/session stays mounted. A visible back action and native swipe return to the same source position; drafts and unresolved request IDs survive leaving and relaunching.

## Design choices

Reuse native segmented categories, sliders, SF Symbols and the existing leaf identity. Keep the existing ink/paper palette: leaf #365C47, paper #F7F5EB, white #FFFFFF, ink #292D29, secondary #666D65, night #1F1F1F. Interface uses system sans; reading preview follows the actual chosen reader font. Align controls and chat to a single leading edge. Avoid repeating instructional paragraphs or rendering all themes as large cards.

Compared approaches: (1) flatten every preference into one long form, which preserves the scanning problem; (2) add deeper settings pages, which hides routine actions; (3) three small categories with live, direct controls, selected here as the implementation decision under the user's autonomous-work instruction. For chat, an arbitrary default book would hide the gate but retain a false context; use an actual account-level conversation.

## Contracts and limits

- Reuse the official DSH generator, shared concurrency/hourly limits, six-turn history budget, cancellation and duplicate request receipts. Account chat has an internal namespace, never a shelf book. Quote billing through the existing conversation action and validate the same owner/request/scope identity.
- Book conversation, source quotes and translation validation remain unchanged. Account chat has no implicit source passage; tools acquire and verify sources as needed. Settings never initiate generation.
- Account chat history and drafts are owner scoped; include an explicit export endpoint without subscription. Do not migrate historical book conversations into account chat.
- Native UI minimum remains iOS 17. No new dependencies. Dynamic Type, 44pt actions, keyboard, reduced motion, empty/error/pending/retry states are required.

## Validation

Use isolated fixtures and existing Primary iPhone through dev-ios-session; Compact iPhone/iPad only when needed and with the required reason. Verify direct chat with zero books, explicit optional book selection, durable question/retry identity, source context attribution, reader return anchor, outside-tap contents dismissal without page turn, typography persistence, PDF fallback, large accessibility text and narrow bounds. Distinguish local tests, CI, merged source, web Production, Apple processing and actual device/provider acceptance.

## Implementation updates

The two clients were confirmed by the user after initial investigation. Web interface, shared backend and native interface now have separate file ownership under the dispatching-parallel-agents skill, with one independent reviewer. Heavy builds/tests remain sequential. The implementation decision is to use the native existing panel state as the navigation owner: it pauses reading time/auto paging while Chat is visible, and keeps the parent reader lifecycle mounted.
