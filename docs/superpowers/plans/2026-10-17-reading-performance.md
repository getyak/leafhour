# Large-book reading and original-download acceptance

## Measured problem

A real 779-page private book returned response headers in 833 ms, but its 797,673-byte gzip body took 27,701 ms to finish. An uncached browser navigation reached readable state at 64,228 ms; DOM content loaded at about 36 seconds. The existing page downloads a dependency graph of more than 80 resources before fetching the entire book. The original PDF transfer failed with a browser network error after sustained partial progress. The revised downloader must complete a fresh real transfer without another OCR submission.

## Implementation

- [x] Return an explicit partial reading view for large books: complete chapter/paragraph identity index, only the requested chapter's real text. Keep authoritative book storage, full APIs, exports and source IDs unchanged.
- [x] Load chapters on demand, validate book/version/chapter/paragraph identity, deduplicate requests, retain retry after failure and ignore superseded navigation. Prefetch only the next chapter. Resolve saved positions and cross-chapter note/highlight/chat jumps before rendering.
- [x] Bundle hosted reader scripts and styles to avoid the module dependency waterfall. Keep source modules and local development intact. Compress medium JSON responses.
- [ ] Run focused regressions, full release checks and independent review; merge and verify the exact production release.
- [ ] Measure fresh and repeat real-book opens, remote/local source anchors, navigation, copy, records and anonymous rejection. Finish the existing original download and independently compare its length and SHA-256 with the supplied source.

## Boundaries

All source material and browser/network evidence stay private under the designated account. Public evidence contains only aggregate timings and results. No new OCR submission, paragraph renumbering, private-note generation or provider purchase is needed.

## Download recovery

Hosted download manifests include trusted storage-part sizes. The browser reads 256 KiB ranges with at most twelve concurrent requests, retries each failed range up to five times, renews expired signed links with a bounded cancellable request, and retains successful ranges in the same tab for a manual retry. Each range must match its requested byte count and any exposed Content-Range. The complete file still must match the authoritative byte count and SHA-256 before it is offered as a download. No signed URLs or source bytes are persisted in the public repository.

## Review corrections

Independent review found and corrected unloaded old-draft source access, navigation races in highlights/references/remote-position restoration, and oversized chapters bypassing existing chunk transport. Behavioral regressions cover recovery, failed reads, later navigation winning, chunk snapshot checks, signed-link refresh cancellation, and resuming retained ranges.
