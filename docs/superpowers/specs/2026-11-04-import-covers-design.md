# Imported book covers

The user requests source-aware covers, using 剑来.txt for acceptance. Reuse an EPUB's embedded cover or PDF's first page without redesigning it. For TXT, Markdown, or an EPUB without usable artwork, generate one original cover with the existing quiet literary printmaking character. Preserve public catalog artwork.

Use Ark Seedream 5.0 Pro (`doubao-seedream-5-0-pro-260628`) for quality, configurable by environment. The account's model-list endpoint confirms availability; a real generation remains required. Official API: https://docs.volcengine.com/docs/ark/image-generation-api?lang=zh . Prompts guide atmosphere, paper, inks, and content-specific imagery without prescribing objects, exact positions, or palettes. Generate artwork without lettering and typeset the actual title and supplied author using existing bundled font subsets. This avoids invented slogans; a soft paper wash gives text contrast without a hard panel. Only title/author metadata is sent; book text and personal records are excluded.

Generation occurs on the authenticated private cover request, with persistent cache, a cross-instance lease and failure cooldown. An original always wins. Missing configuration or generation errors preserve the readable text binding and never interrupt importing or reading. Cached artwork remains account-owned runtime data, outside Git. Web and iOS cloud shelves share the existing same-origin cover endpoint; local-only iOS imports are outside this server change.

Considered: replacing every cover would discard source identity; static templates leave TXT rigid. Source-first generation fills the actual gap. No unrelated credentials are configured. No new iOS binary is implied.
