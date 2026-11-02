# Native large text opening after import

## Reproduction and source boundary

The user reported that opening a just-imported TXT still froze the App, and supplied an actual local source for testing. It contains 23,964,345 original bytes and the native decoder/importer produces 230,392 paragraphs in one logical chapter. The prior import-worker fix did not bound reader construction: UITextView still received the whole chapter, followed by forced TextKit layout and chapter pagination on the main actor.

Current hosted authentication was used to verify the requested test identity; its password came from Keychain and neither password nor live session token was written into files or output. Native acceptance uses an isolated local account namespace with that verified identity and an offline transport. It does not read or mutate the live cloud library. The actual source, its runtime packages, screenshots, test result bundles and account-specific metadata stay outside Git. This is not real-cloud upload certification; this source also exceeds the existing 20 MiB explicit-cloud-original upload limit.

## Change

`ReadingTextWindow` projects a disposable source window, normally at most 160 paragraphs and approximately 24,000 UTF-16 units. Canonical chapters, paragraph IDs, original bytes and persisted source offsets remain unchanged. Individual very long paragraphs are sliced at Unicode character boundaries with offsets mapped into the full original. The reader loads adjacent windows while scrolling or paging; backward windows end before the boundary being left. Source jumps and saved positions select the corresponding window. Window-local page totals are not labeled as full chapter totals.

TextKit now constructs and paginates only that source window. Empty translation refreshes no longer allocate a dictionary for every paragraph in the book. Existing imported books use the same storage format and do not require deletion or re-import for this rendering change.

Small Markdown documents retain their full original rendering. Large/incomplete Markdown windows explicitly display literal `Markdown 源文`, preserving fences, stars and reference syntax rather than silently interpreting a fragment with missing block context. Incremental rich Markdown rendering for these large windows is not implemented.

Speech following uses the current word's source position to select a window. Sentence highlighting is clipped to the visible source slice; a sentence longer than one window can still follow its current word. Text selection and speech coordinates remain anchored in the original paragraph.

## Evidence

- The original actual-source import, open, interaction, return and reopening UI path was exercised in the dedicated native simulator App. This uses the supplied bytes, not a substituted small book.
- Native source checks cover first, middle and final windows, original-byte equality, and persisted anchors. The actual first window contains 9,935 UTF-16 units. Initial TextKit construction/layout observed about 0.023–0.121 seconds across two local runs; these exclude import, book verification, disk loading and full App opening, and are not physical-iPhone latency claims.
- Synthetic core cases cover 230,000 paragraphs, oversized Unicode paragraphs, middle/end anchors and backward source adjacency. Native checks cover paging/scrolling boundaries, selected emoji source offsets, long single-sentence speech, Markdown source fidelity, existing typography, selection, PDF and viewport behavior.
- Private-source UI runs include the normal import action, explicitly entering the new book, actual horizontal page gestures, returning and reopening, and restarting the App before opening its retained continuation entry. If startup remains on the shelf, the test opens the real continuation entry; it does not claim automatic startup resume was established by this fixture.

Independent review found and verified fixes for cross-window speech following, long sentences, and Markdown fragments losing fenced-code/reference context. Final review approved after those fixes. Final command outcomes are appended after execution.

## Limits

Acceptance ran on iOS 26.4 Simulator. No physical iPhone was connected, so device memory pressure, touch/haptic feel, physical installation/upgrade and Files-provider download behavior remain unverified. The private-source transport intentionally isolates cloud traffic and does not certify upload/network latency or model generation. Original source text and private screenshots are excluded from the public evidence package.

Final local outcomes: 267 core cases executed (266 passed, one optional source case skipped); native release contracts passed 100/100 and vendor verification passed. The final native layout/pagination/viewport group passed 70/70, including the actual selected source and both scrolling and paged window boundaries. The final private-source UI case passed twice with real horizontal page gestures and cold reopening, approximately 50.5 and 45.6 seconds per complete case. These are whole-case durations, not file-open latency. The saved account-scoped state was separately checked after these runs: actual source movement and reading activity were persisted. This verifies interaction beyond the view merely appearing. The original file was not modified.

Test setup corrections are kept distinct from product failures: the first end-of-book assertion incorrectly required the very last paragraph to occupy the viewport top even when bottom clamping legitimately leaves the prior paragraph visible; it now checks the actual captured anchor and restored window. A rerun needed an explicit initial source anchor because its prior run retained the book-end position. Cold-launch acceptance opens the retained continuation entry when the shelf is shown, and the final UI check uses horizontal gestures for the default paged mode. All final checks above passed after these corrections.
