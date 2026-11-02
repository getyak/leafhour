import SwiftUI
import UIKit
import LeafhourCore

/// Both the live TextKit reader and SwiftUI preview resolve the same local
/// fonts. Bundled CJK faces cascade before the operating system fallback.
@MainActor enum ReaderTypography {
    static func font(style: ReaderFontStyle, size: Double, traits: UITraitCollection, latin: ReaderLatinFont = .automatic) -> UIFont {
        let family = latin == .automatic ? pairedLatin(style) : latin
        let base: UIFont
        switch family {
        case .georgia: base = UIFont(name: "Georgia", size: size) ?? .systemFont(ofSize: size)
        case .palatino: base = UIFont(name: "Palatino-Roman", size: size) ?? .systemFont(ofSize: size)
        case .baskerville: base = UIFont(name: "Baskerville", size: size) ?? .systemFont(ofSize: size)
        case .charter: base = UIFont(name: "Charter-Roman", size: size) ?? .systemFont(ofSize: size)
        case .rounded:
            let system = UIFont.systemFont(ofSize: size)
            base = UIFont(descriptor: system.fontDescriptor.withDesign(.rounded) ?? system.fontDescriptor, size: size)
        case .automatic, .system: base = .systemFont(ofSize: size)
        }
        let chineseName: String
        switch style {
        case .serif: chineseName = "NotoSerifSC-Regular"
        case .kai: chineseName = "LXGWWenKaiLite-Regular"
        case .sans, .rounded: chineseName = "PingFangSC-Regular"
        }
        // Explicitly cascade Chinese glyphs; a Latin serif design alone does not
        // turn UIKit's default Chinese fallback into Songti. Keep OS fallback for
        // characters/scripts not covered by the selected local face.
        let chinese = UIFont(name: chineseName, size: size) ?? .systemFont(ofSize: size)
        let descriptor = base.fontDescriptor.addingAttributes([.cascadeList: [chinese.fontDescriptor]])
        return UIFontMetrics(forTextStyle: .body).scaledFont(for: UIFont(descriptor: descriptor, size: size), compatibleWith: traits)
    }

    static func pairedLatin(_ style: ReaderFontStyle) -> ReaderLatinFont {
        switch style { case .serif: .georgia; case .kai: .palatino; case .sans: .system; case .rounded: .rounded }
    }

    static func category(for value: DynamicTypeSize) -> UIContentSizeCategory {
        switch value {
        case .xSmall: .extraSmall
        case .small: .small
        case .medium: .medium
        case .large: .large
        case .xLarge: .extraLarge
        case .xxLarge: .extraExtraLarge
        case .xxxLarge: .extraExtraExtraLarge
        case .accessibility1: .accessibilityMedium
        case .accessibility2: .accessibilityLarge
        case .accessibility3: .accessibilityExtraLarge
        case .accessibility4: .accessibilityExtraExtraLarge
        case .accessibility5: .accessibilityExtraExtraExtraLarge
        @unknown default: .large
        }
    }
}
