# iOS import responsiveness and quiet lifecycle

The user requested responsive phone uploads, a visible but quiet lifecycle on the home shelf, repeated iOS acceptance, and a useful book title extracted from early pages when the supplied name is unsuitable.

Keep the existing local import and explicit cloud-upload ownership boundaries. Import must not open the new book automatically or block opening an existing book. Put the active filename, honest phase/chapter progress, cancellation, and a completed/open action in one compact shelf status row. Retain failed/interrupted originals and the existing retry route. Dismissing the shared-file panel must not cancel the import.

Protect upload migration and concurrent cloud pulls with snapshot comparison; defer migration when the destination is already being read. Account-context changes clear operation state and prior filenames.

Move parsing and integrity work into a cancellable utility worker while the profile actor retains publication ownership. Protect against duplicate imports/retries and preserve IDs, original bytes and personal records. UI updates are bounded rather than per paragraph. Upload source reading also leaves the main actor.

Prefer valid EPUB/PDF metadata, retain meaningful supplied names, and extract a conservative title from at most five early chapters/pages when the name is empty, generic or opaque. Never invent a title from body prose. This first implementation can recover explicit titles locally without sending the book to a model. Unknown titles keep the source filename.

Alternatives considered: a modal progress screen would keep the user waiting; putting only network requests in a Task leaves parsing/data queue contention unresolved. The chosen implementation keeps the shelf usable and separates processing from publication. Background suspension is not promised as an indefinitely running iOS transfer; persisted jobs remain recoverable after interruption.

Acceptance: stalled parsing must still permit shelf/state reads and opening an existing book; cancellation cannot publish a partial package; duplicate races cannot overwrite notes; source title fallback preserves all passages. Native system-picker acceptance must return to the shelf and explicitly open the completed book.
