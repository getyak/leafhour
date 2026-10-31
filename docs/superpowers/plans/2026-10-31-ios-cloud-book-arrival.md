# iOS cloud book arrival and large reading-copy plan

> Execute with focused parallel agents after this protocol is frozen; integrate and verify before one push. User authorized investigation and resolution of the book missing on iOS.

**Observed:** The actual default account's cloud shelf contains the supplied EPUB at position 104/104, with valid native metadata, 2,119 chapters and 230,426 passages. Current iOS preserves old service order for undownloaded books; it also limits complete normalized copies to 32 MiB/100,000 passages. The real phone is not connected, so its installed build, account and active filter are not established. Do not attribute its exact screen to one cause without that check.

## Frozen transport contract

Add account-bound GET routes under `/api/library/books/{bookID}`:

- `native-copy`: prepare a private immutable gzip copy of the normal full book model (source, real saved translations and editorial data; no personal records/grants). Return `{kind:"leafhour-native-copy-v1",bookId,contentVersion,snapshotId,sha256,compressedBytes,uncompressedBytes,partBytes:1048576,encoding:"gzip"}`. SHA256 identifies both the archive parameter and its compressed bytes. Uncompressed model is bounded to 96 MiB, compressed bytes to 32 MiB. Bind the archive to its actual owner and book. Capture and recheck the chapter snapshot around creation. Reuse an identical snapshot; no paid calls.
- `native-copy/part?archive={sha256}&offset={integer}`: private binary 1 MiB aligned ranges, with strict length/expiry/owner checks. Stored archive parts must be read without reconstructing the complete book or fat manifest on every range. No client-supplied paths or signed URLs.
- `native-copy/verify?archive={sha256}`: verify the original snapshot is still current; return `{valid:true,bookId,contentVersion,snapshotId,sha256}` or 409. Ownership is always checked. Archive TTL is 24 hours; no source deletion.

Native client tries this protocol first and falls back to existing chapter download only on unsupported endpoint 404/405. It checks plan bounds, each expected part length, compressed SHA, bounded gzip output and full book/chapter/passage identity, plus the final server snapshot before returning a copy. A successful normalized copy supports up to 300,000 stable passages/5,000 chapters. Keep legacy endpoint fallback bounded as before. Never mark a partial copy downloaded. Preserve cancellation/account-generation fences and existing atomic package publication. System zlib/SDK only, no new dependency or source IDs.

`CloudShelfBook` adds optional `addedAt: Date?`; JSON reads explicit addedAt or private-book createdAt, ignoring public catalog build timestamps. Cached shelf rows retain addedAt. Presentation's added order compares a cloud addition date when known, otherwise local importedAt; unknown cloud dates preserve service order. Pins, downloaded-only filter, search and old cache decoding stay intact.

## Work and ownership

- [x] Server agent: private archive/range/verify service, domain integration, HTTP routes and synthetic Node tests. Own server files and new server tests only.
- [x] Core agent: transport, bounded gzip decode, complete-copy validation and source-date metadata in LeafhourCore; own Core Swift files/tests only.
- [x] Shelf agent: date-aware presentation and shelf-cache serialization in app model; own app Swift files/application tests only. Core agent supplies addedAt property.
- [x] Root: inspect actual cloud list safely, phone account/filter when connected, integrated Core/app checks, synthetic end-to-end transfer, independent review, copy inventory and release checks.
- [ ] Submit one reviewed PR, exact-head CI, normal merge; follow already authorized native auto-release. Distinguish Apple VALID, tester availability, installed binary and physical-device acceptance. Never erase/reinstall the user's app or change account ownership to hide the symptom.

Build helpers described by old local docs are absent in this session. Use isolated task outputs, at most two build jobs, and verify free space/process availability before standard SDK builds; do not mutate another task's outputs.

Integrated results are recorded in [verification](../../verification/2026-10-31-ios-cloud-book-arrival.md). The physical-phone check was replaced by the user with simulator verification; UI inspection awaits Mac unlock.
