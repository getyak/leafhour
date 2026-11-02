# Offline reading fonts

Noto Serif SC Regular and LXGW WenKai Lite Regular are bundled unchanged under OFL-1.1. `sources.json` pins their upstream commits, URLs, byte sizes and SHA-256 digests; the accompanying license files retain copyright and reserved-name terms. No fonts are fetched during native reading.

- [Noto CJK](https://github.com/notofonts/noto-cjk), commit `f8d157532fbfaeda587e826d4cd5b21a49186f7c`, Simplified Chinese subset OTF.
- [LXGW WenKai Lite](https://github.com/lxgw/LxgwWenKai-Lite), commit `3bca1fc0a0e00f6627f4c8bee60ef07778ab1820`, regular TTF.

Together these add 25,575,272 font bytes before app-store compression. Other scripts and missing glyphs use the OS fallback. Latin choices use installed iOS families. Rounded pairs PingFang Chinese with rounded Latin by default. Chinese Markdown emphasis uses synthetic stroke/slant because the bundled faces have regular weight only.
