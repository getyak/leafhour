# LXGW WenKai Lite

OFL-1.1; copyright and license are retained in OFL.txt. Original source: [LXGW WenKai Lite](https://github.com/lxgw/LxgwWenKai-Lite), commit `3bca1fc0a0e00f6627f4c8bee60ef07778ab1820`. `sources.json` records the original TTF and license provenance.

The web face splits Unicode coverage into seven WOFF2 files using fontTools 4.57.0. Their union retains all 25,694 source codepoints and the original glyph advance/sidebearing metrics; each file stays below the existing 2 MB public-asset limit. The font license expressly permits web-only subsetting without changing the reserved name. `web-font.json` pins each file and Unicode range. The native app bundles the original TTF. This face is not preloaded: the browser requests it when a rendered WenKai sample or text uses it. Initial fallback uses device fonts; normal reader layout observation restores the reading anchor after fonts settle.
