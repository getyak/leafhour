# GET-346: reading space, translation, and shelf actions

The user's five requests apply to the native iOS reader and library. Interpret 制定 as 置顶. Build on `27fe290`, preserve account ownership, existing offline copies, source anchors, independent literal/interpretive translations, native selection and recovery envelopes.

## Direction

Use compact, stable page margins in horizontal reading; transient tools overlay the page as in a conventional book reader. Tool visibility must never change pagination. Continuous reading keeps its measured controls budget. Ordinary text size shows exactly three cover columns, with 13-point scalable titles; accessibility sizes use full-width rows. The downloaded symbol precedes the title and differs from the selection circle on the cover.

Selecting translation or parallel reading exposes a first-passage offer alongside the content picker. A second action prepares only the current chapter, current passage first, at most 100 missing paragraphs. Each paragraph appears as soon as it is durably saved. Scope, maximum points, pause and uncertain recovery stay explicit. Never start a model from navigation or resume, expand scope to another chapter, or replace a partial/reviewed translation. Existing two-chapter envelopes remain recoverable.

Long press offers select multiple, pin/unpin, share and details. Selection works in both shelf layouts, has explicit Done/select all actions, and resets across account changes. Pins persist per account/device and preserve the chosen sort within each group. Share previews carry book title/author only; private content, notes, history, credentials and non-public URLs do not enter a share.

Alternatives considered: keep the permanent tool margins (does not solve the feedback); reflow every time tools appear (changes page boundaries); compact stable pages with temporary overlays (chosen by agent). Keep original files and personal-record export in book details.

## Verification

Exercise page navigation/anchors, Unicode/selection, three-column geometry at 320/390/430 points, Dynamic Type fallback, scoped pins and selection, single/chapter generation, current-first ordering, partial translations, pause and same-key recovery. Record native execution separately from source and CI. The current host has `.agent-pause`; no new local native builds while it remains active. Remote required CI is a separate gate, not native UI acceptance.
