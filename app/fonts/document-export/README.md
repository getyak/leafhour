# Static fonts for local PDF export

These renamed static TTF derivatives come exclusively from the already committed
Newsreader and Noto Serif SC WOFF2 sources. Both use OFL-1.1; original copyright
and licence texts remain at `../newsreader/OFL.txt` and `../noto-serif-sc/OFL.txt`.
Derivative family names are Leafhour Export Latin and Leafhour Export CJK.

`manifest.json` records each source, the exact derivative SHA-256 and its actual
cmap ranges. The browser fetches only subsets needed by the selected document.
Unsupported glyphs stop PDF generation with an explicit Markdown alternative.
The font set covers the tested Latin, simplified/traditional Chinese and
Japanese text; it is not a claim to cover every Unicode character or emoji.

To rebuild, use Python with fonttools==4.67.0 and brotli==1.2.1, then run
`python3 tools/build-export-fonts.py` from the repository root. This is a
maintainer operation; production needs no Python, font download or conversion.
WOFF2 parsing alone worked in the PDF font engine, but subsetting its outlines
failed. The static TTFs passed PDF.js text extraction and Poppler rendering.
