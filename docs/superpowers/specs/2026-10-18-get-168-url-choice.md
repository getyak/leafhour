# GET-176/177/179/187 filter, URL state and shared choice batch — spec record

Date: 2026-10-18. Source of truth for interfaces is the parent architecture note
`get168-url-choice-design.md` (read-only, parent-prepared) plus its independent
design-review additions. This file records what the implementation settled so
later rounds and fresh-main integration can diff it. No rendered or native
acceptance is claimed here; native Chrome QA is parent-owned.

## Shared choice primitive (`app/choice-control.mjs` + `app/choice-control.css`)

`mountChoiceControl({document,select,label?,onChange?})` enhances an existing
native `<select>`; the select keeps owning options/value/disabled state and stays
the progressive fallback (visible) whenever the mount fails, in which case any
partial enhancement chrome is removed and the markup label stays associated.

- ≤6 options: immediate segmented chips (no Done step). >6 options: one editable
  APG combobox input controlling one sibling listbox with search.
- A confirmed changed value sets `select.value` and dispatches exactly one normal
  bubbling `change` event; the same value fires nothing. Programmatic
  options/value writes are mirrored only through the explicit `sync()` call —
  no setter monkey patches, no MutationObserver blanket hooks.
- Keyboard: Arrow/Home/End move across enabled options when open (skipping
  disabled), Enter commits, Escape reverts the display to the committed label,
  Tab is never trapped; closed Home/End keep native text-edit behavior.
- IME: composition suspends filtering/commit; only the final composed text may
  become a search, and a cancelled composition that leaves the committed display
  label untouched never becomes one. Enter during composition never commits.
- The closed popup is hidden from layout and the accessibility tree at first
  mount and after Escape, blur and commit. Active-descendant IDs are unique and
  stable per option value; sync reconciles a stale active value and resets stale
  `aria-activedescendant` when no visible enabled option remains.
- Chip/option nodes are keyed by value: sync never detaches a focused control;
  a real remount restores focus to the same visible value (input when the mode
  switched). Pointer press (`mousedown`) keeps focus so a blur cannot reset the
  searched rows before the click lands on the row under the pointer.

Reader use (GET-187): all nine Aa-drawer selects
(reading-purpose, preferred-language, view-mode, page-layout, translation-variant,
parallelLayout, parallelStyle, parallelColor, parallelBackground) upgrade in
place; `reading-time-source` stays native outside the drawer. Labels come from
the existing linked markup labels (no new dictionary). `reader.js` calls
`settingsUI.sync()` after every programmatic write (applyAppearance,
applyParallelAppearance, boot's view-mode relabeling). Saved appearance, book
position, paragraph toolbar and existing font/paper choices are untouched.

Library use (GET-177): the three filter dropdowns (topic/source/language) use the
same primitive. Topic choices are exactly all/philosophy/science/literature/
history/fiction (six chips). Language keeps 中文/英文 shortcuts always
selectable plus every remaining loaded source language (searchable once the
group grows past chips). Open filter → 小说与故事 → 中文 is three clicks with no
Done step; with the shipped catalog that result is honestly empty.

## Library URL state (`app/library-view-state.mjs`)

One pure codec/reducer plus one explicit lifecycle adapter.

- Owned keys: `q/scope/status/topic/language` plus exactly one overlay among
  `filter/calendar/settings/upload/trash` (settings carries a validated tab).
  Conflicting overlay keys normalize in the fixed precedence
  settings > calendar > upload > trash > filter. Unknown parameters stay in the
  URL untouched and are never approved for auth returns. Form contents and owner
  IDs are never serialized.
- `normalizeLibraryQuery` is the single bounded query rule (trim, reject blanks/
  control characters/malformed Unicode, cap 120) shared by live state, URL
  parsing, serialization and the UI summary; `#book-search` carries
  `maxlength="120"`.
- History lifecycle: debounced search replaces; discrete filters/status flush the
  pending query into the current entry and then push; stale timers are cancelled
  on popstate/hydrate/reset/owner switch (generation-tagged) and unfinished IME
  text never commits. Popstate restoration never pushes recursively.
- Overlay ownership: only a modal overlay owns exactly one app-created entry;
  ownership survives tab changes and overlay replacement (the same entry keeps
  `consumable:true`); a discrete view change while that entry is current extends
  the same entry instead of orphaning ownership. An explicit close consumes
  exactly that entry via `history.back()`; a non-owned (direct-URL) close only
  replaces/removes its own keys and marker and never leaves the site. The
  non-modal filter chooser owns no entry at all. Unrelated history.state fields
  survive every write.
- Owner generations: app-written entries carry a bounded `libraryState:{epoch}`
  tag (never an owner ID in the URL). `adoptOwner()` bumps the epoch and clears
  the current entry in place; a pop into an older epoch clears its stale owned
  state in place (no push, no back). Untagged foreign entries are never touched.
  Initial session bootstrap keeps the parsed URL (`preserveView` on the first
  `clearPrivateUI`).
- Session-ready handoff: `takeSessionOverlay()` reflects the CURRENT snapshot
  once, so a stale hydrate descriptor can never resurrect an overlay the user
  already replaced.
- Auth return: `safeLibraryReturn` (bounded `/library` codec) + `authReturnTarget`
  precedence (upload retry → reader/gift whitelist → parsed safe library return →
  live view). `adoptReturn` adopts a validated return by replace-only and hands
  back the overlay to open; identity settles first (refresh), then the return is
  adopted, so the owner change a login triggers can never erase it. Server-side
  `safeAuthReturn` keeps the reader/gift whitelists and routes library targets
  through the same codec; OAuth success/cancel/expiry returns keep validated
  `q/topic/overlay` keys and drop unknown ones.

Controller hooks (explicit entry/close/tab integration, no global dialog
watching): `mountShelfFilters({onOpenChange})`, `mountLibraryShell`
(`onSettingsOpen/onSettingsClose/onSettingsTab`, opener captured only on first
open and returned only to a connected, visible, non-inert control outside the
dialog with the sidebar entry as fallback), `mountReadingDashboard`
(`onOverlay/onClose`), `mountLibraryBookActions` (business descriptor
`{kind: trash|info|schedule|gift}` + close reason; only `trash` routes to the
URL and the reused dialog never implies trash for other business).

## GET-177 catalog curation

`catalog/manifest.json` gains `fiction` for exactly 17 unambiguous novels/stories
(alice, flatland, frankenstein, erewhon, time-machine, ivan-ilych, awakening,
home-and-world, brazilian-tales, notes-underground, young-werther,
pride-prejudice, don-quixote, candide, arabian-nights, underdogs, african-farm).
Poems, essays, scriptures and memoirs keep out. All 30 `sourceLanguage` values
stay `en`; source bytes/hashes, contentVersions and paragraph IDs are unchanged
(frozen regression in `tests/catalog-topics.test.mjs`). Unknown/private books
match only their explicitly stored topics; nothing is inferred or classified and
no translated content or records are invented.

## GET-187 settings text and controls

Settings explanation/secondary text is ≥13px (including the Aa dialog heading
paragraph). Range and switch inputs keep native semantics with authored
track/thumb visuals and ≥44px non-overlapping targets.

## Locale ownership

The only new strings are the filter summary/topic labels already owned in
`app/library-filter-controls.mjs` (`小说与故事`, `搜索：…`); reader choice labels
come from existing markup labels. No global runtime text translator is added.
