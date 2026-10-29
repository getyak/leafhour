# Restore the reading bookmark and original book covers

The room must expose the latest unfinished book with a valid saved passage above the shelf. Use a compact horizontal bookmark with the original cover, title, saved chapter and one continue link; on phones, keep the cover beside the text and the action below it. Keep the complete ordered shelf and filters. Do not invent reading history or show another account's previous book while identity is loading.

The previous large dashboard competes with the shelf; replacing the shelf's first book would disrupt ordering. A separate compact bookmark restores the entry while leaving the shelf predictable. This is an implementation choice within the requested restoration.

For private PDF/EPUB books, derive an authenticated cover URL from the book identity and source hash. Extract the EPUB 3 cover-image or EPUB 2 cover metadata, or render the first PDF page using the existing PDF renderer. Normalize only embedded raster images into bounded WebP; do not load remote resources or execute source markup. Cache derived images in the owning account's private data directory. Existing originals work without reimport or modifying passages/records. Missing, damaged or unsupported covers fall back to the existing typography. Public catalog covers remain as supplied.

Verify saved-position navigation, account clearing, filters, four interface languages, desktop/mobile layout, real PDF and EPUB extraction, source-byte preservation and unauthorized cover access. No generation, paid services or source-book publication.
