# Vendored swift-cmark

Source: https://github.com/swiftlang/swift-cmark/tree/0.6.0
Tag: `0.6.0`
Tag object SHA: `b022b08312decdc46585e0b3440d97f6f22ef703`

Only `src/` and `extensions/` are included. Source is unmodified; build-only CMake/re2c inputs are omitted because generated C files are provided upstream. `Package.swift` is a local library-only manifest.

`COPYING` preserves the BSD-2-Clause license and MIT notices for the Houdini, buffer/chunk and utf8proc-derived files. No upstream tests/spec or other content is shipped.

The parser is used in-process to construct native attributed text. HTML and JavaScript never execute, and remote image URLs are never fetched.
