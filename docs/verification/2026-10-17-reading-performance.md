# Large-book reading and original-download verification

Date: 2026-10-17. Production: https://leafhour.com.

## Release and changes

PRs [#78](https://github.com/getyak/leafhour/pull/78), [#81](https://github.com/getyak/leafhour/pull/81) and [#82](https://github.com/getyak/leafhour/pull/82) are merged. Production `/release.json` matched `f67382d27f46249022791d249c87b158dacc152b` before the final real-book checks. Main-branch CI and packaged-runtime checks passed for that commit. Local release verification completed with 1,015 passing tests, one skip and zero failures.

Large books return the full paragraph/chapter identity index with real text for the requested chapter. Other chapters load on demand; responses must match the book version and ordered paragraph identities before adoption. Full-book APIs and explicit exports remain complete. Hosted scripts and styles are bundled; medium JSON responses are compressed.

Original downloads use owner-authenticated same-origin ranges of at most 1 MiB. The server reads the relevant private storage parts and validates upstream range coordinates and byte counts. The browser retains completed ranges for an in-tab retry and verifies the final byte count and whole-file SHA-256 before triggering a browser download. Anonymous range requests returned 401; anonymous private-book and reading-view requests returned 404 with error-only bodies.

## Real original download

The actual source-download button in the authenticated production reader completed in Chrome. The saved download was independently opened from disk, streamed through SHA-256, and compared with the user-supplied source. Both files contained 143,882,741 bytes and their hashes matched exactly. PDF inspection confirmed 779 pages, with no encryption. About 54 seconds elapsed between the real button click and the saved file modification time, including preparation and browser integrity verification. This is one observed transfer, not a throughput guarantee.

Earlier direct-storage browser attempts stalled or failed after partial progress. Small command-line storage reads succeeded, so these did not prove missing source data. The final same-origin browser transfer succeeded. Browser-debugging connection timeouts also occurred in the in-app browser; the completed file acceptance is specifically the real Chrome run. Source bytes, filenames, hashes, screenshots, private identifiers and network evidence remain outside the public repository.

## Observed opening times

Times end at the reader's readable marker, after chapter render, font readiness and anchor restoration. Actual styled content and source anchors were also checked; the marker alone is insufficient.

| Observation | Browser and conditions | Readable time |
| --- | --- | ---: |
| Original reported slow refresh | In-app browser, previous upload acceptance | 39.270 s |
| Diagnostic baseline | In-app browser, cache disabled, direct original transfer active | 64.228 s |
| Corrected bundled reader | In-app browser, cache disabled, full CSS verified, no active transfer | 9.861 s |
| Final release cold refresh | Chrome, cache disabled, first reading group, no active transfer | 4.996 s |
| Final release repeat refresh | Same Chrome tab, cache restored, same reading group | 3.574 s |

The browser/environment and transfer conditions differ across rows. These are individual observed runs, not a controlled benchmark, percentile or SLA. Intermediate measurements from the first bundle had missing styles and are excluded from acceptance. PR #81 fixed CSS import bundling and added a regression check; the final hashed stylesheet returned 200 and contained the complete rules.

The final uncached Chrome reading-view response transferred 61,149 bytes, compared with the baseline full-book response's 797,673 bytes (both network-encoded sizes). Final hosted startup used one reader JavaScript bundle (102,028 network bytes) and one reader stylesheet (31,509 network bytes). The canonical full-book JSON and all 1,960 paragraph identities remain unchanged by these reader changes.

## Actual reading checks

- Page-400 and page-779 persisted passage links opened real text in reading groups 34 and 66. Opening the paragraph panel visibly showed the matching PDF page number in both cases.
- A real double-click selected a source word; a real keyboard-copy action put exactly that word into the Chrome clipboard. No note/highlight was submitted.
- Actual table-of-contents navigation from group 1 to an unloaded group 34 fetched and displayed its real text. After its position save, a fresh browser reload restored group 34.
- Opening a passage reference alone did not replace the previously saved remote reading position on refresh. Directory navigation followed by saving did; this report does not describe reference opening as a persisted reading-progress action.
- The complete source was downloaded without another OCR submission or translation. This work does not upgrade the existing `extracted_unreviewed` status or claim perfect recognition. Accuracy sampling and known defects remain in the [OCR acceptance report](2026-10-17-paddleocr-upload.md).

Private evidence includes before/after timings, sanitized network paths, actual browser screenshots and the independently verified downloaded-file receipt under the designated account's local acceptance directory.
