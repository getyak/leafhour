# iOS cloud book arrival, 2026-10-31

## Diagnosis

A fresh authenticated read of the default test account confirmed that the supplied private EPUB is present in its cloud library. Its metadata is accepted by the native client. The service returned it at position 104 of 104 books. The native added-date order previously appended undownloaded cloud books in service order instead of using their actual addition dates.

The supplied book has 2,119 chapters and 230,426 passages. Its normalized full model is 95,400,131 bytes. The legacy native download's 32 MiB/100,000-passage limits prevented a complete copy. Raising those limits alone would leave more than two thousand sequential chapter requests.

## Implemented behavior

Actual cloud addition dates now determine the added-date order, with existing pin, search and filter behavior retained. Missing historical dates remain unknown and retain stable service order. Cached dates stay scoped to the signed-in account.

The native client uses a private, owner-bound immutable gzip archive with bounded binary parts. It validates lengths, compressed SHA, gzip integrity, decoded size, chapter/passage IDs and final source snapshot. Source and saved translation/editorial bytes remain separate from personal records. Cancellation and account changes cannot publish a partial copy. The original upload is retained.

## Local evidence

- Core: 178 tests passed, 0 failures.
- Simulator application unit tests: 158 executed, 1 skipped, 0 failures, Xcode 26.4 / iOS 26.4, task-owned iPhone 17 Pro simulator.
- Host service suite: 4,446 executed, 4,445 passed, 1 skipped, 0 failures. Runtime/build, public-content exclusion and release checks passed.
- Copy export/lint passed; documented existing copy debt remains visible.
- Independent review found no P1/P2 issue; its independent native archive run passed all 12 tests.
- Actual supplied book, local domain service to the production Swift client: all 2,119 chapters and 230,426 passages downloaded, saved and reopened with the same cloud identity and final passage ID. The complete JSON was 95,400,131 bytes. A warm archive run completed in 2.55 seconds on localhost; this is not a production-network or phone timing claim. The source has no reading-start hint, and the copy correctly retained that absence.

Book bytes, private account identifiers, credentials and raw test logs stay outside the public repository. No paid model request was made.

## Remaining release and device evidence

At this commit, production deployment and the authorized automatic TestFlight release have not yet completed. Simulator UI inspection is temporarily unavailable while the Mac is locked. The user confirmed the same default account and the All filter, and requested simulator verification because a physical iPhone is unavailable. Apple processing, tester availability, installed phone version and physical-device behavior must be reported separately from local tests.
