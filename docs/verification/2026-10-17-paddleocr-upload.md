# Official PaddleOCR upload acceptance

Date: 2026-10-17. Production: https://leafhour.com. Model: PaddleOCR-VL-1.6, official SDK 0.2.3.

## Acceptance scope

The user supplied a 143,882,741-byte, 779-page scanned PDF. All pages have no usable native text layer. The real source, provider payloads, reference transcriptions and screenshots remain private in the designated account. This report contains aggregate verification metadata only.

The merged public implementation spans PRs #62, #65, #66, #69, #70, #71 and #73. The latest code passed all 942 CI tests, the isolated packaged-runtime check and deployment checks before merge. The production release marker was verified at merge commit `090622645c4ffb65e6d1ec7307144ca3afc67c23`, and the live original-download module contained streamed byte-progress handling. File-download acceptance is recorded separately below. All 779 pages completed and the real browser automatically entered the published private book.

| Measured result | Value |
| --- | ---: |
| Source pages / completed pages | 779 / 779 |
| Persisted provider batches | 26 |
| Reading paragraphs / unique IDs | 1,960 / 1,960 |
| Typed footnote blocks retained | 158 |
| Automatically generated reading groups | 66 |
| Pages with no recognized reading text | 0 |

The browser displayed the first reading group, the page-400 paragraph and the final paragraph on page 779. The latter two were opened through their actual persisted passage IDs, and the sidebar visibly showed their corresponding PDF page numbers. Their screenshots remain private.

## Production findings and corrections

- The original was uploaded through the real authenticated browser in 69 resumable chunks. During implementation, an operator adopted the first upload index into the resume index. Subsequent refresh and resume reused the persisted upload and ingestion job; the first run therefore includes this intervention.
- Direct multipart submission timed out with a real 30-page batch. Official file-URL submission returned a handle in 1.661 seconds. Hosted batches now use private, expiring, real PDF URLs, at most 20 MiB each. Larger batches split without overwriting previously submitted input identities.
- Two initial uncertain submissions required controlled operator reconciliation. Negative official batch-ID lookups preceded recovery; recovery metadata is private. This intervention is part of the acceptance history and is not presented as an unattended successful first run.
- One early batch took 7 minutes 32 seconds while later batches finished in seconds. Persisted fair polling now collects later results while the slow job continues, with complete page coverage still required for publication.
- At 360 collected pages, production transport reads failed while the same saved job and its 30 results were readable through the official SDK locally. Read-only retries now retain handles, stop after a bounded budget and allow explicit resume. Submission ambiguity never triggers a blind resubmission. Private diagnostics retain only operation, typed error and bounded connection code; no request URLs, authorization headers or provider messages.
- The resumed production browser passed the 360-page point and collected the remaining results without replacing submitted handles. Official queue and execution times varied substantially, so this acceptance does not establish a steady-state pages-per-minute figure.
- Large-original downloads now use at most six concurrent requests, preserve source order and check byte count plus whole-file SHA-256. A failure cancels and drains the other workers before retry is enabled. Local static-route, integrity, ordering and cancellation regressions pass; production file retrieval remains a separate acceptance check below.
- A live download remained waiting before showing progress. Preparing its link manifest reread the entire original and signed links serially. The manifest endpoint now checks owner-authorized metadata, binds the stored manifest to the book hash and size, and signs at most six links concurrently. Full verification remains in the downloader. Independent tests reject forged manifests and path traversal before signing. The real library original uses 18 stored parts; its upload used 69 chunks. These are different stages.

- Real storage reads were slow in the acceptance environment. PR #73 reports actual streamed bytes before an entire part finishes and extends owner-scoped original-part links from ten minutes to one hour. Oversized streams and worker failures cancel pending readers; complete byte-count and SHA-256 verification remain required.

## Accuracy method

Eleven source pages span the beginning, middle and end of the book. Fixed excerpts contain 1,556 characters. References were visually transcribed before comparing their corresponding recognition results. Whitespace is ignored; punctuation is retained. Character error rate uses Levenshtein edits against the matched excerpt in each full-page result.

The first six-page experiment contained 907 reference characters. An enlarged source check corrected two transcription mistakes; both reference versions remain private. These excerpts matched after narrow formatting normalization. Additional inspection found a two-character OCR substitution and an embedded margin number outside those excerpts. This is evidence against claiming whole-book perfect recognition.

The other five pages, 649 characters, were fixed as blind references before whole-book recognition. Final measurement used all eleven normalized pages from the actual upload pipeline, replacing experimental outputs. The initial full-pipeline comparison had three edits in 1,556 characters (CER 0.1928%). An enlarged check of source page 720 showed that all three were reference-transcription errors: one punctuation mark and two characters. The original blind reference and original measured report remain unchanged in separate private files; an adjudicated reference and report are additional artifacts. After the agent adjudicated the references against the source image and applied the narrow output-format normalization below, the fixed-excerpt result is 0 edits in 1,556 characters. This corrected result is not described as a blind-test score.

Output normalization unwraps only observed Chinese dot-emphasis wrappers and circled footnote markers, joins Chinese line breaks, and retains actual formula syntax. The reading-text adapter excludes provider-labeled page furniture and isolated edge-number blocks while retaining raw evidence. The CER comparison additionally ignores whitespace; punctuation remains significant. No semantic correction is applied.

These are regular-body-text excerpts transcribed and checked by the agent, not a human-adjudicated gold corpus. Zero errors in these short excerpts is not a whole-book accuracy claim. Inspection outside the excerpts confirmed a two-character body substitution, an embedded margin number and garbled decorative cover text. No semantic rewriting was used to hide these defects. Sampling does not establish a universal comparison with MinerU or accuracy on tables, vertical text or other books.

## Delivery boundaries

New OCR books retain stable paragraph IDs, source PDF page and bounding-box evidence. They remain `extracted_unreviewed`. Original provider data is retained privately. Reading groups are generated from paragraph counts; original table-of-contents recovery, semantic correction and inline footnote reconstruction are not claimed.

Closing the page pauses future advances. Already submitted remote recognition can continue; reopening the upload dialog resumes saved progress. There is no unattended scheduler in this slice.

## Final acceptance

Passed: all-page publication, fixed-sample measurement, first/middle/last-page reading. Anonymous requests to the actual private book and records returned 404, and original/info, original/parts and original returned 401; bodies contained only an error, with no redirect to private storage.

The real browser selected and submitted the same original a second time. It returned directly to the same book and the prior reading group. Before/after database metadata retained book row version 1, the identical content version and source hash, one shelf copy, and the same fingerprint of all 26 provider handles. Together with the unchanged stored book row, this preserves all 1,960 paragraph IDs and no new provider jobs were observed for the duplicate. Refresh restored the reading group in the same browser; cross-device position recovery was not assessed. The agent did not start a reading-time session or create a personal note/highlight.

Directory navigation into group 34 completed locally. Real pointer dragging selected body text and exposed the highlight/share-excerpt controls; the private screenshot records the selection. A separate double-click word selection and actual keyboard-copy action placed exactly that source word in the browser clipboard. One refreshed book open measured 39.27 seconds to the page's readable marker in this test environment. Large-book opening remains slow; this report makes no latency-SLO claim.

The complete original-file download is **not accepted yet**. The final production browser attempt visibly advanced from 1% to 5%, but the 137 MiB source was still transferring after several minutes. Browser-control timeouts also occurred during this attempt; reconnecting recovered the same active transfer. The real 18-part manifest and first/last object lengths were verified, and a ranged read returned the PDF signature, but these do not establish complete-file retrieval. No completed browser download or independently hashed downloaded file was available at this checkpoint. The ongoing transfer is separate from the successfully completed upload, OCR publication and reading flow.

The reading and OCR acceptance is therefore complete within the tested scope; full original-file download remains an explicit outstanding gate. The current environment also has slow large-book opening. Neither result is represented as a passed latency or download acceptance.

## Follow-up: original download and opening performance

The outstanding gates above were subsequently tested on production release `f67382d27f46249022791d249c87b158dacc152b`, after PRs #78, #81 and #82. A real authenticated Chrome click downloaded the complete original in about 54 seconds. The browser-saved file independently matched the supplied source in byte length and whole-file SHA-256; PDF inspection confirmed 779 pages. The source is still private.

The large-book reader now requests a small reading view and loads other chapters on demand. With complete production styling verified, an uncached Chrome open measured 4,996 ms and the following cached refresh 3,574 ms. A separate uncached in-app-browser measurement after the stylesheet correction measured 9,861 ms. These are observed runs with different browser/transfer conditions, not an established latency percentile or SLA. Actual directory navigation, refresh restoration, page-400/page-779 source anchors and keyboard copy passed. [The follow-up report](2026-10-17-reading-performance.md) records conditions and limitations. The earlier failed-download and slow-opening checkpoint remains above as historical evidence.
