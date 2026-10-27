# GET-276 Native source delivery

The user explicitly resumed this canonical session to complete source work independently of Apple access. Native implementation is performed directly here; no new Apple application is registered. TestFlight, physical-device acceptance, cloud account/synchronization and confirmed invitations remain separate, truthful acceptance states.

## Architecture and interfaces

- `apps/ios/LeafhourCore`: Swift package for content-addressed EPUB/PDF import, bounded archive parsing, stable chapter/passage identifiers, complete offline manifests, device/account-scoped atomic storage, reading positions and private notes/drafts. ZIPFoundation 0.9.20 is vendored with upstream commit/blob verification; PDFKit retains complete original PDF pages including scanned pages. Local workspaces are explicitly device-local and are never presented as authenticated cloud users.
- `apps/ios/Leafhour`: SwiftUI navigation and state, system file importer, native selectable text reader for complete EPUB spines, PDFKit viewer, independent top/progress overlays, contents/search, preferences, citations, notes/drafts and exports. No remote content scripts, model calls or automatic cloud upload.
- Xcode project generated from checked-in `project.yml`. Debug uses an unsigned local-only bundle identifier. Release signing must explicitly supply the verified existing Apple application identity; no team/application is guessed or registered.

## Execution

1. Write failing native-core tests for all chapters/pages, duplicate import, stable anchors, complete integrity checks, cancellation/retry, malformed/traversing archives, profile isolation and durable positions/drafts. Implement and run the tests with serialized builds in the registered artifact path.
2. Build native screens and connect actual import/storage. EPUB renders every spine chapter and supported image assets; PDF retains every original page. Persist selection, paragraph/page location, preferences and notes atomically; surface unsupported/encrypted/scanned states accurately. No fixture books are preloaded into the product.
3. Generate the project, build without Apple signing and verify on the allowlisted Primary iPhone only if the shared iOS guard is available. Record simulator, unit and physical/TestFlight evidence separately. Add deterministic macOS CI for core and unsigned iOS build without preview deployment.
4. Obtain independent sub-agent review of the whole change, fix confirmed P0/P1 and reverify. Query and reuse the canonical GET-276 PR; associate it with Linear and read back. Deliver with current-head applicable CI, normal merge and source/production verification. Keep Linear In Progress while required physical/TestFlight acceptance is open.

## Review focus

Archive traversal/symlink/duplicate/expansion limits; no partial book marked offline; original survives parsing/cancellation; duplicate import never replaces personal state; stable anchors survive reflow/relaunch; local/device scopes do not claim cloud identity; selected text/citations and drafts stay bound to the original passage; scanned PDF remains readable without fabricated extracted text; unsigned build is never described as distribution acceptance.

## Validation scope

Generated EPUB/PDF fixtures are disposable test inputs, not proof of real-device compatibility. Full book-spine/page counts and final chapter/page assertions validate complete processing. PDFKit and UIKit real rendering builds remain required. TestFlight upload, processing, distribution, invitation acceptance, physical installation/update and data retention are explicitly pending external acceptance.
