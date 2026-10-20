# Upload and chapter reading verification

Date: 2026-10-20. Base source: `1d9e416`. The user authorized implementation, same-book comparison, PR and merge. The later scope correction removes scan counts/quota presentation and prioritizes chapter reads, efficient original transfer and quiet chat uploads.

## Controlled same-book comparison

The source was the same existing private 779-page PDF (143,882,741 bytes), using the designated account's current authenticated identity. Existing extraction contains 66 reading groups and 1,960 stable paragraphs. Private source bytes, hashes, IDs, raw book content, screenshots and detailed observations remain under that account's local acceptance directory.

Both controlled runs use the real application through Chrome, identical loopback counted storage and the same original. Baseline source was archived before product edits. No OCR or language provider was called. Publication replay uses that book's existing extraction, rather than charging for another recognition run.

| Observation | Before | After |
| --- | ---: | ---: |
| Source upload application JSON body bytes | 191,845,554 | 12,284 |
| Binary source bytes sent directly to private storage | 0 | 143,882,741 |
| File selection to verified original receipt, one observed run | 5,269 ms | 4,150 ms |
| Original source bytes reread at publication | 143,882,741 | 0 |
| Original bytes rewritten at publication | 143,882,741 | 0 |
| Store bytes read for group 1 | 2,432,443 | 288,439 |
| Store bytes read for group 34 | 2,432,443 | 317,603 |
| Store bytes read for group 66 | 2,432,443 | 281,198 |
| Canonical full-book reads per chapter request | 1 | 0 |

Chapter measurements use three actual HTTP requests at each selected group; byte counts were identical across those samples. Publication readback verified the original length and SHA-256 on both sides. The 12 KB figure is application metadata, not the entire file transfer: the original still travels to storage. Local timings are individual observations, not a production percentile or speed guarantee. An earlier upload observation during the full parallel test suite was excluded from the controlled timing comparison; the resource-timing buffer was increased before the final direct-upload observation.

## Browser behavior

Actual library chat uploaded the full original in 69 binary parts and displayed a stable completion card. Its two actions select reading or the conversation book, without navigating automatically. A typed draft remained unchanged during upload. The 390px mobile chat had no horizontal overflow. Actual reader chat also uploaded a local text attachment while preserving the current book, chapter, passage and typed draft. Selecting its completed book remains an explicit action.

New controller/DOM tests separately cover no-book state, incomplete/corrupt receipts, owner switch, cancellation/late completion, retry, refresh, locale changes, focus/IME preservation and deferred-module disposal. The upload and Markdown rendering implementation load on demand; the fixed 320 KiB reader script budget remains enforced.

The measured reader script decreased from 327,669 to 326,437 bytes; the stylesheet changed from 183,494 to 185,080 bytes. Both remain inside the existing fixed budgets. Upload support did not add an eager startup module request.

## Review and release gates

Independent core review found one P2: small books with many chapters had serial reconstruction. This was fixed with a content-addressed complete-document snapshot. The actual 81-chapter public edition regression reads one aggregate and no chapter documents for its opening, while its chapter API stays independent. A scoped independent re-review passed five focused regressions, with no new confirmed issue. Cold chapter publication is limited to six concurrent writes and cannot publish after a failed batch.

Independent whole-branch review found a second P2: a progress read begun during an action could later overwrite its acknowledgement. Reads captured while a task is busy are now ineligible, and ready/cancelled task states cannot regress. Independent scoped re-review reproduced cancellation remaining cancelled and passed six focused action/poll regressions with no new confirmed defect.

The associated PR records final current-head release verification, GitHub CI, normal merge, matching Production and the live same-book comparison. This document records the pre-merge measurements; unit/component evidence remains distinct from production acceptance.
