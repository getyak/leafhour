# Leafhour artwork

Created for this project on 2026-10-15 with the builtin OpenAI image generation tool, using text-to-image generation. These are original brand illustrations, not product screenshots or evidence of a person's reading.

- `reading-window.webp`: natural morning light on an open book, deep green cloth cover, a stone window ledge and a quiet garden; no readable text, people, UI, or third-party branding. Landscape composition for the homepage.
- `page-detail.webp`: close view of a lifted paper page, a slim bookmark and a green cloth spine, in the same quiet natural-light palette. Portrait composition for the daily reading story.
- The original hand-authored page icon was replaced by the Leafhour identity on 2026-10-16; `page-mark.svg` remains a compatibility URL, documented below.

The descriptions above are summaries of the generation briefs. Original generated PNGs are retained in the local verification archive, excluded from publishing. Delivery WebPs use cwebp quality84 for the hero and quality88 for the detail, method6, without metadata: encoding only, no semantic image editing. Hero163634bytes; detail119462bytes. Public reference sites informed design principles; their images, logos and fonts were not copied.

## Sunlit space, 2026-10-15

The second homepage pass uses two additional original assets generated with the built-in OpenAI image tool. [Exact prompts](../../docs/design/sunlit-artwork-prompts.md) are retained with the source.

- `sunlit-room.webp`: a wide reading-room composition, with a pale wall for copy and the book, garden and translucent leaves to the right. 1774×887px; 176400 bytes, cwebp quality85, method6.
- `foliage-canopy.webp`: a transparent backlit botanical branch for independent foreground depth and soft projected shadow masks. 1536×1024px with alpha; 196518 bytes, cwebp quality86, method6. Transparency is preserved.

These assets contain no people, product interface, logos or readable copy. Compression stripped metadata and changed no semantic image content. Original PNGs remain in the local image-generation archive. The original hero and page-detail assets remain available; the new homepage uses the wider scene and keeps the page detail in the daily-reading section.

Alternative text identifies the illustrations. The hero remains readable with the image unavailable; no essential action depends on a bitmap. No external font requests are required.

## Paper bookshelf, 2026-10-15

`sage-paper.webp` is an original paper material generated with the built-in OpenAI image tool. It is a background texture, not a photograph of a book or evidence of reading. The library uses a translucent sage wash over the texture; cloth covers reuse it with multiply blending. Cover lettering stays real, selectable browser text. No publisher artwork or external fonts are used.

The delivery asset is 768 × 768px, 56194 bytes, encoded with cwebp quality82 from the generated PNG; encoding and resizing only. The original remains in the local image-generation archive. The flat-colour fallback keeps all content usable if the texture does not load.

Exact generation prompt:

> Use case: photorealistic-natural. Asset type: subtle seamless material texture for a Chinese personal reading-room website background, not a mockup. Primary request: a flatbed scan of premium handmade pale sage-green cotton rag paper, fine irregular paper fibres and very fine tactile grain, softly clouded low contrast mottling from natural pulp. Color overall pale muted grey sage #e3e8dd, faint cooler olive/sage tonal variation, extremely quiet diffuse natural light, uniform across entire square. All-over edge-to-edge material, orthographic macro scan, no perspective. It will be used behind dark readable text at low opacity; make the detail delicate and believable. No objects, no book, no drawing, no text, no border, no corners, no stains, no creases, no dark vignette, no bright spots, no watermark. Texture should tile naturally with no visible seams. Output square 1024x1024.

## Gift stationery, 2026-10-16

`envelope-edge.svg` and `letter-edge.svg` are original hand-authored vector alpha masks. The envelope has a subtly uneven cut; the letter combines a rough outline and varied postal perforations. They reuse the existing paper material without copying reference artwork. The stamp and seal reuse the project's own page mark. Chinese personal notes use available system Kaiti fonts, with the existing serif fallback; no font service is contacted.

## Leafhour identity, 2026-10-16

The global brand is **Leafhour**, with the line **Stay with a book.** The current interface remains Chinese. Existing natural-light illustrations and paper textures stay in use; this rename does not change their provenance.

- `leafhour-mark.svg`: original hand-authored, one-colour mark. The silhouette combines a page's square corner with the round growth of a leaf; the two inner strokes suggest clock hands. Its 40-unit canvas supplies at least seven units of clear space around the main silhouette. Use the complete shape without stretching, extra outlines or rotation. The visible mark remains legible at 16px; use at least 24px in interface headers. The favicon adapts its ink to the device colour scheme.
- `page-mark.svg`: identical compatibility alias for existing icon URLs. New surfaces use `leafhour-mark.svg`.
- `leafhour-social.svg`: editable, original 1200×630 vector layout of the wordmark, promise and emblem. It uses paper `#F7F5EF`, ink `#263B32` and forest `#365B45`; it contains no third-party image or logo.
- `leafhour-social.png`: deterministic PNG rendering of that SVG for social previews. It is a brand graphic, not a screenshot or evidence of a product feature.

The Leafhour wordmark uses the available system Iowan Old Style, Baskerville, Palatino, Book Antiqua or Georgia serif. Interface copy keeps the existing system sans and Chinese serif stacks. No remote font is downloaded. Inline marks inherit their surrounding text colour, including reader and dark themes. The shared identity rules are in `app/leafhour-brand.css`; the reading workspace continues to own its colour and layout preferences.

The wordmark and emblem are original and not copied from the AI-company references. Their consistency, clear space and small-scale legibility follow the design principles recorded in the approved launch design. No new animated brand treatment was added; existing reduced-motion and light controls remain effective.
