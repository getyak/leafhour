# Reader conversation sidebar

The requested change is a desktop conversation sidebar and a discoverable reading-toolbar entry. Keep the existing paper palette, conversation data, width preference and mobile drawer.

- [x] Reserve sidebar width beside the book at 1100px and wider; preserve the reading anchor through opening, resizing and closing. Restore layout ownership on disposal.
- [x] Keep the conversation entry visible when reading tools collapse, align both controls into one quiet toolbar, and show its open state. Desktop book interaction leaves the sidebar open; Escape and close still dismiss it.
- [x] Verify scrolling and paginated books at desktop, tablet and phone sizes, keyboard resizing, focus return and selection using synthetic local sessions without provider calls.
- [ ] Run the suite and production build, review the diff, submit a PR, merge after CI and verify the matching production release.

Use the existing reader workspace, toolbar and chat modules. Anchor restoration must yield to a new chapter, page, scroll or selection action. Mobile containment releases inert and overflow ownership at the desktop breakpoint. Preserve compatibility storage keys and unrelated working-tree changes.
