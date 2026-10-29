import Foundation
import UIKit
import CoreText
let base = UIFont.systemFont(ofSize: 22)
let serif = UIFont(descriptor: base.fontDescriptor.withDesign(.serif) ?? base.fontDescriptor, size: 22)
let scaled = UIFontMetrics(forTextStyle: .body).scaledFont(for: serif)
let ctFont = scaled as CTFont
print("Base native serif:", scaled.fontName)
for sample in ["Reading", "阅读", "読書", "한글"] {
    let fallback = CTFontCreateForString(ctFont, sample as CFString, CFRange(location: 0, length: sample.utf16.count))
    print(sample, "=>", CTFontCopyPostScriptName(fallback))
}

print("Runtime:", UIDevice.current.systemName, UIDevice.current.systemVersion)
for name in ["SongtiSC-Regular", "SongtiTC-Regular", "HiraginoMinchoProN-W3"] { print("Available local face:", name, UIFont(name: name, size: 22)?.fontName ?? "unavailable") }
