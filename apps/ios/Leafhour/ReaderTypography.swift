import SwiftUI
import UIKit
import LeafhourCore

/// Both the live TextKit reader and SwiftUI preview resolve the same local
/// system font style. Language-specific fallback remains UIKit/Core Text's job.
@MainActor enum ReaderTypography {
    static func font(style: ReaderFontStyle, size: Double, traits: UITraitCollection) -> UIFont {
        let design: UIFontDescriptor.SystemDesign
        switch style {
        case .serif: design = .serif
        case .sans: design = .default
        case .rounded: design = .rounded
        }
        let base = UIFont.systemFont(ofSize: size)
        let descriptor = base.fontDescriptor.withDesign(design) ?? base.fontDescriptor
        return UIFontMetrics(forTextStyle: .body).scaledFont(for: UIFont(descriptor: descriptor, size: size), compatibleWith: traits)
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
