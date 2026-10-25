# Quiet paper reading and chapter openings

The user approved the conversation's quiet typesetting plus chapter-opening direction on 2026-10-25, then explicitly scoped this release to paper layout and page-turn feel. Reader-requested image generation is a later release. This records that approved direction; it does not authorize image requests or new billing work.

## Intent and approaches

Use stable typesetting for ordinary reading, a typographic chapter-opening leaf, and a directly manipulated soft page turn. The explored alternatives were ordinary typesetting, illustrated chapter openings, and personal reading interleaves. The selected approach combines ordinary typesetting with chapter openings. This release uses typography and the existing chapter metadata, with no invented illustration or decorative placeholder.

## Reading behavior

- Keep the existing scroll/spread choice, saved layout, account preferences, paragraph IDs, original text and separate translation variants. Do not silently migrate existing readers to a new layout.
- In page mode, sufficiently wide windows show two facing pages; narrow windows show one. Give the paper generous margins, a restrained gutter, light edge depth, and a quiet page footer. Preserve every existing paper/night palette and user font size.
- A wide chapter opening devotes the first leaf to its existing number/title and places the body on the facing leaf. A narrow opening shares its first page with the beginning of the text. Never add a blank final spread or lose the first paragraph.
- The text remains the live, selectable HTML source. Any temporary animation copy is inert, hidden from accessibility, without duplicate IDs, bounded in size, and removed after completion or cancellation.
- Drag only a page-edge handle; the text itself remains available for selection and links. A grabbed leaf follows the pointer immediately; release distance and velocity decide completion or return. Bending and shadows follow progress, rather than rotating the whole book as a rigid panel.
- Buttons and unmodified left/right keys retain their existing meanings. New input can interrupt or reverse a turn. Only a completed turn commits its page and reading position, exactly once.
- Selection, editing, dialogs and other blocking surfaces prevent a new turn. Resize, navigation, appearance changes, session changes, hidden documents and disposal invalidate an unfinished turn. A stale callback must never restore an old book or page.
- Respect reduced motion with immediate paging and no snapshot/animation work. A large chapter may use a simpler transition when a bounded visual snapshot would be exceeded; reading and navigation still work.
- Settings and tools remain temporary overlays. Opening them must not change page width, reserve a new reading column, shift the text, or reset the anchor. Existing translation task and failure feedback remains actionable.

## Implementation boundaries

Extend the existing pagination owner rather than introducing a second reader. Use native browser rendering, Pointer Events and requestAnimationFrame; add no runtime dependency. Separate the motion state from DOM snapshots so release, interruption and invalidation are testable without a browser. Reuse existing localized previous/next labels. No automatic illustration generation, placeholder generation button, model request, private-note access, source rewrite, or changed data ownership.

## Acceptance

Prove commit/cancel/interruption and stale-callback behavior with behavioral tests. Verify actual book text, text selection, chapter navigation, font changes, night mode, settings/tools, reduced motion and narrow/wide layouts in a browser. Run the full repository suite, copy export/lint, hosted build and release checks. Review the complete branch, create a PR, wait for CI, merge normally, then distinguish Production deployment and same-commit online verification from the merge.
