# GET-357 · iOS reading style and Chat design

User intent: quiet, personal reading; friendly, concise settings; crafted excerpt sharing; native global Chat. Implementation and normal delivery are authorized by the current request and AGENTS.md. No additional design approval gate.

## Approach
Keep SwiftUI, UIKit text/PDF and the existing authenticated conversation service. A root tab bar makes Library, Chat and Settings predictable destinations. Reader tools retain a direct return to the exact page. Compared with only polishing existing sheets, this gives Chat a durable global home; compared with a new general assistant backend, it preserves current authorization, billing and bounded context.

## Reading and settings
Offer typography presets (classic, spacious, compact) without changing language, translations, navigation or listening preferences. Five paper choices: warm paper, white, sage, night and system. Use one palette in text, page snapshots, PDF backgrounds and previews. Preserve old stored string values. PDF original pages retain their printed colors and typography.

Common appearance controls and actual text preview come first. Reading content/translation and navigation details live one level deeper. Global Settings links to the same profile-scoped appearance controls, account, records and data information. Do not manufacture provider toggles or move generation actions into appearance controls. All screens support dark appearance, Dynamic Type, accessible names, at least 44pt targets, and reduced motion.

## Chat
Global Chat chooses any book from the authenticated shelf, including books not downloaded. GET chat supplies the actual context and full book conversation; no synthetic book and no change to reading position. Selected text opens the same native conversation design from the reader in a full-height sheet. Show the book and expandable excerpt, distinguish user and AI messages, keep the composer anchored above the keyboard, preserve drafts and uncertain request identity per owner/book, and retain explicit generation/price confirmation. Loading, real empty history, unavailable service, failures and result retry remain distinct. Never access private notes. Re-entering a tab does not generate or duplicate a request.

## Sharing
Retain measured UIKit pagination, complete text, attribution, QR/link authorization and the system share sheet. Add paper/ink/night card palettes, visual style choices, a framed editorial preview and a stable image-share action. Long text still paginates at readable size; no truncation or hidden private content. Theme choices affect only exported images.

## Verification
Core persistence tests for all themes and non-destructive presets; app tests for palette contrast, complete multi-page cards, global Chat context/ownership/loading/draft/retry behavior; native UI walkthroughs for settings, themes, Chat keyboard/return and sharing, with screenshots. Check compact width and accessibility text. Independent agent review before delivery. Source/CI, TestFlight processing, physical-device and real-model acceptance remain separate evidence.
