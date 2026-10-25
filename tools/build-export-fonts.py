"""Build static, renamed OFL export fonts from the checked-in WOFF2 sources.

Maintainer-only tool: fonttools==4.67.0 and brotli==1.2.1. No runtime Python,
network fetch, book text or model access. Generated fonts are release assets.
"""
import hashlib
import json
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

root = Path(__file__).resolve().parent.parent
out = root / "app/fonts/document-export"
out.mkdir(parents=True, exist_ok=True)
sources = [root / "app/fonts/newsreader/newsreader-var.woff2"] + sorted((root / "app/fonts/noto-serif-sc").glob("*.woff2"))
entries = []
for index, source in enumerate(sources):
    font = TTFont(source, recalcTimestamp=False)
    axes = {a.axisTag: (400 if a.axisTag == "wght" else 16 if a.axisTag == "opsz" else a.defaultValue) for a in font["fvar"].axes}
    font = instantiateVariableFont(font, axes, inplace=True)
    family = "Leafhour Export Latin" if index == 0 else "Leafhour Export CJK"
    for record in font["name"].names:
        if record.nameID in (1, 4, 6, 16):
            value = family.replace(" ", "") + str(index) if record.nameID == 6 else family
            record.string = value.encode(record.getEncoding())
    points = sorted(c for c, glyph in font.getBestCmap().items() if glyph != ".notdef")
    ranges = []
    for point in points:
        if ranges and point == ranges[-1][1] + 1:
            ranges[-1][1] = point
        else:
            ranges.append([point, point])
    file = f"export-{index:03}.ttf"
    font.flavor = None
    font.save(out / file)
    entries.append({"file": file, "ranges": ranges, "source": str(source.relative_to(root)), "sha256": hashlib.sha256((out / file).read_bytes()).hexdigest()})
(out / "manifest.json").write_text(json.dumps({"license": "OFL-1.1", "fonts": entries}, separators=(",", ":")) + "\n")
print(f"Built {len(entries)} static font subsets; {sum(p.stat().st_size for p in out.glob('*.ttf'))} bytes")
