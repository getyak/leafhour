# GET-195 annotation portability checkpoint

The ZIP coordinator and legacy JSON export/import/validate routes now share enriched entries, projected preflight and applied-target rechecks. Both book-part exports include pure `readerAnnotations`, independently of editorial `book.annotations`. Missing annotation keys preserve existing data. Malformed final entries and known merge conflicts fail before any book or record writes. Domain CAS merges preserve concurrent words and tombstones; imports never restore runtime jobs or call a model.

Selected exports list AI annotations and user follow-ups separately. Selecting an AI message does not include its thread's private user words. JSON/Markdown retain the selected source layer, offsets, thread identity and site/external provenance. Disabling quotes removes both typed selected-text bodies and citation excerpts. These selected exports are content projections, not full restorable archives. Gifts retain their existing narrow construction and exclude private annotations/chat.

Parent verification:50/50 new and existing portability/export/HTTP cases passed, including hash-consistent malformed ZIP rejection, old backups, both legacy paths and historical translation references. Independent review passed8/8 real-service/HostedStore synthetic cases, including applied-target conflict, same-ID and unrelated-thread CAS interleavings and actual gift download isolation. Its exact assertions were promoted into a repository test with only import paths changed; the parent reran that test with the50-case suite:58/58 passed,0 failed/cancelled/skipped. No real accounts, private reading data, credentials, provider calls or remote service traffic were used.

A light reader compile after the strict validator addition measured327265 bytes of initial JavaScript and178678 bytes CSS, within the existing320KiB/200KiB caps. An input appearing in the metafile is not claimed as an output-byte contribution. This stage required no new deferred backup edge or cap increase.

Restore is not a global transaction across books/records. If the target changes after preflight, earlier books or records may already have been restored; the operation returns failure and can be retried. It does not claim a rollback or completed whole-library restore.

Independent report SHA256: `d2a9c57b003e5183c0749508d598c631c1117fc89030ad8bf1b3b9011f5657e7`.

This scoped checkpoint does not establish external Agent tools, reader UI, full-feature CI, merge or Production acceptance. GET-195 remains in progress.
