# GET-281 — Assessment A

Independent design review, completed before reading any detector output. Assessment B remains the parent's separate assessment. Read mode with a secondary conversation task. Questions/interview substituted from the supplied brief because this is a scoped review subagent; the user requested full implementation.

## Design specificity

The direction is specific to Leafhour's purpose. The measured serif book column, restrained paper surface and conversation that yields back to the passage make reading the dominant activity. This is authored restraint rather than a generic chat sidebar. Removing the answer card is the right choice: the panel boundary already identifies the conversation, so an additional container competes with the text.

The two unresolved states undermine that direction: sleeping controls still leak into the page through a late stylesheet, and a short mobile half-sheet can leave no usable answer area.

## Evidence and limits

Inspected PRODUCT.md, DESIGN.md, the GET-281 spec, app/reader-quiet.css, app/reader-chat-workspace.css, relevant shared chat CSS, current screenshot fixtures, and a fresh isolated IAB tab at port 8431. Checked top-edge Tab/Enter, conversation open/close and focus return; inspected narrow geometry at 390×501, 390×568 and 390×844.

For authenticated layout geometry only, temporarily revealed the page's existing composer/status elements and added a clearly labelled layout specimen in this isolated tab. No question was submitted, generated or saved. This is layout evidence, not service/authentication acceptance. The initial fixtures had sans-serif answers; current live source computes the answer body as the book serif at 16px/30.4px, so the stale fixture typography is not a current issue. No detector was run or read. No product code was written.

## Nielsen scores, observed snapshot

| # | Heuristic | Score | Reason |
|---|---|---:|---|
| 1 | Visibility of system status | 3 | Scope and recoverable unavailable status are clear; short sheets can consume the answer region. |
| 2 | Match with the real world | 4 | Book, passage, question and return follow a natural reading sequence; visible copy is plain. |
| 3 | User control and freedom | 3 | Close remains clear, focus returns to the labelled entry, and the book position remains present; short-sheet answer access fails. |
| 4 | Consistency and standards | 3 | Tokens and familiar dialog controls cohere; the late collapsed-tool override contradicts the quiet state. |
| 5 | Error prevention | 3 | Reading scope and separate explicit send are retained; this review did not exercise destructive or live data operations. |
| 6 | Recognition rather than recall | 2 | Keyboard focus labels the hidden edges, but first-time touch users must learn where invisible tools live. |
| 7 | Flexibility and efficiency | 3 | Tab/Enter, Escape/close path and resizable desktop layout support practiced readers without adding visible controls. |
| 8 | Aesthetic and minimalist design | 3 | Strong text hierarchy and no nested answer card; leaked launcher content and short-screen compression remain. |
| 9 | Error recognition and recovery | 3 | The unavailable copy names the condition, invites drafting, and provides reload; actual retry success was not tested. |
| 10 | Help and documentation | 2 | Accessible edge labels and reading hints exist; there is no visible first-use cue for sleeping controls. |
| **Total** | | **29/40** | **Good foundation; fix the two P1 states before release.** |

## Cognitive load and emotional journey

Two checklist failures make the observed edge cases moderate load: visual hierarchy fails when the answer region collapses, and working-memory demands rise when controls are invisible or source context cannot remain readable. Single focus, chunking, grouping, one-decision-at-a-time, minimal semantic choices and progressive disclosure otherwise pass. The awake tools show four primary tiles; secondary listening options, close, conversation and more-tools raise total actionable controls above four, but they are meaningfully grouped rather than one undifferentiated choice set.

The journey starts calm and book-led. Invisible controls introduce a first-use uncertainty valley; keyboard focus provides a good recovery. Conversation feels quieter without a nested card. The short-screen state creates the largest frustration valley. Closing ends well: a labelled conversation control reappears under focus without reopening all tools.

## Two strengths

1. The book remains the visual anchor. Plain surfaces, restrained rules and serif answers give conversation an editorial relationship to reading.
2. Focus is treated as a real state: the top 44px edge shows a visible ring plus its Chinese label on Tab, Enter opens tools, and closing conversation returns focus to a visible labelled entry.

## Priority issues

1. **P1 — Late reading-hub CSS restores sleeping chrome.** Live CSSOM loads reading-hub.css after reader-quiet.css. Its equal-specificity `body.is-focused .reading-session[data-expanded="false"] #reading-tools-trigger` rule resets position to relative, color to ink and pointer-events to auto; its child rule resets opacity to 1, and its focus pseudo-element rule hides the label. The 320px fixture visibly overlays hourglass/location text on book text. Reconcile the existing owners so quiet CSS is authoritative after lazy loading. Verify computed styles and screenshots after the hub has loaded, including keyboard focus.
2. **P1 — The <=500px compact cutoff leaves a nonfunctional short half-sheet.** At 390×501, the dialog is 250.5px tall. Existing header/status/composer measure 65/52/98px; the messages region is 48px, entirely its vertical padding, and the composer extends to y514.5 below the 501px viewport. At 390×568, messages are 68px including 48px padding, so less than one full answer line is readable. Give the sheet a justified minimum usable height or enter compact mode based on available answer space. Check 501/568/620 heights with status, a multiline draft and long answer, then check keyboard viewport transitions.

## Persona red flags and minor observations

- Jordan, first-time reader: the requested invisible touch edges remain a learnability tradeoff. Preserve the quiet direction, but validate discovery with first-use readers before claiming it improves usability.
- Sam, keyboard-dependent reader: top-edge focus and returned chat focus worked. Real screen-reader speech and Safari behavior remain unverified. The late hub focus-label override is covered by P1 above.
- Casey, distracted mobile reader: short-sheet compression hides the answer while leaving input prominent; this makes repeated reading/questioning unnecessarily difficult.

The current answer body is distinct from interface labels, and headings gain weight without oversized display typography. The supplied answer fixture is only a short specimen; final acceptance should include question/answer attribution, headings, quotations, citations and copy actions together. Treat this as a validation boundary, not a new redesign request.

Questions skipped: 2 priority issues; both have concrete fixes within the user's requested full implementation and the approved quiet-reading direction.
