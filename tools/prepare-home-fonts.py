"""Generate static Newsreader faces for marketing; retain source OFL license.
Requires fontTools with Brotli. Reader variable fonts remain unchanged.
"""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools import subset
root = Path(__file__).resolve().parents[1] / 'app/fonts/newsreader'
for source, target in [('newsreader-var.woff2', 'newsreader-home.woff2'), ('newsreader-italic-var.woff2', 'newsreader-home-italic.woff2')]:
    font = TTFont(root / source)
    axes = {axis.axisTag: (400 if axis.axisTag == 'wght' else 24 if axis.axisTag == 'opsz' else axis.defaultValue) for axis in font['fvar'].axes}
    font = instantiateVariableFont(font, axes, inplace=True)
    options = subset.Options()
    options.flavor = 'woff2'
    worker = subset.Subsetter(options=options)
    worker.populate(unicodes=list(range(0x250)) + list(range(0x2000, 0x2070)))
    worker.subset(font)
    font.flavor = 'woff2'
    font.save(root / target)
