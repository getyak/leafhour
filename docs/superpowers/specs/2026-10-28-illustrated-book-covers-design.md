# Illustrated public-library covers

Approved by the user on 2026-10-28 after four local sample covers. Implement for all 64 live public editions, including Japanese users; deliver through the public getyak/leafhour repository and Production.

## Design

Keep the approved original literary printmaking: restrained inks, tactile paper, one content-related silhouette, quiet top 35 percent for native typography. Preserve the approved Walden, Flatland, A Room of One's Own and Meditations artwork. Generate one original, text-free artwork for each remaining book ID, including distinct related compositions for separate volumes and source-language editions. No stock replacement or repeated generic artwork. Titles and authors are rendered as real selectable DOM text, never generated lettering. Keep cover ratio 2:3 and check thumbnails as well as large covers.

## Data and language

Use exactly the 64 edition IDs from catalog/manifest.json; its set must match the captured anonymous Production catalog. Do not read private users' data or alter source passages, versions, translations, anchors or reading records. app/book-cover-artwork.mjs exports bookCoverArtwork, keyed by exact public book ID, with {src,srcSet,ink,paper}; URLs are allowlisted same-origin versioned /book-covers/*.webp. app/book-cover-labels.mjs exports bookCoverLabels, keyed by book ID and en/zh-Hans/zh-Hant/ja, with {title,author,subtitle?}. Native labels localize the cover, not the edition's reading text. Retain volume and attribution qualifications in bounded metadata; no invented translator or author. Unknown/private books retain the existing text binding with their actual metadata.

## Rendering

Preserve the existing synchronous paintBookCover export and all existing callers. Shared covers update on a committed UI-language change without requests, remounts or stale disconnected-node retention. Missing/failed artwork leaves readable native metadata and a usable cover. Image URLs come only from the checked-in map, not untrusted book fields. Do not expose URLs with account identifiers or generate images at runtime. Include shelf, current read, book-detail and gift-cover consumers and their language updates; avoid unrelated page redesign.

## Delivery and verification

Keep optimized responsive WebP assets in app/book-covers, with provenance, prompt set, checksums and a complete 64-book manifest in repository docs/catalog. Verify complete per-ID coverage, four-locale labels and edition distinctions, image dimensions/byte budget, fallback/private/unsafe metadata behavior, locale changes and failed images. Run current CI-required tests and build, review independently, create and attach a PR, wait for passing CI, normal merge and exact-commit Vercel Production verification. No Preview deployments. Capture real browser shelf proof for Japanese and Chinese on desktop and phone, with English and traditional-Chinese checks. Preserve the original dirty checkout.
