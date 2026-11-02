import SwiftUI

/// Paper owns the tint; the system owns refraction and accessibility material.
struct ReaderGlassSurface: ViewModifier {
    var paper: Color
    var cornerRadius: CGFloat = 100
    var interactive = true
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.colorScheme) private var scheme

    @ViewBuilder func body(content: Content) -> some View {
        if reduceTransparency || contrast == .increased {
            content.background(paper, in: RoundedRectangle(cornerRadius: cornerRadius))
                .overlay { RoundedRectangle(cornerRadius: cornerRadius).strokeBorder(.primary.opacity(0.3), lineWidth: 1) }
        } else if #available(iOS 26, *) {
            content.glassEffect(.regular.tint(paper.opacity(scheme == .dark ? 0.55 : 0.35)).interactive(interactive), in: .rect(cornerRadius: cornerRadius))
        } else {
            content.background(.regularMaterial, in: RoundedRectangle(cornerRadius: cornerRadius))
                .background(paper.opacity(0.65), in: RoundedRectangle(cornerRadius: cornerRadius))
                .overlay { RoundedRectangle(cornerRadius: cornerRadius).strokeBorder(.primary.opacity(0.12), lineWidth: 0.5) }
        }
    }
}

struct ReaderGlassGroup<Content: View>: View {
    @ViewBuilder var content: () -> Content
    @ViewBuilder var body: some View {
        if #available(iOS 26, *) { GlassEffectContainer(spacing: 14, content: content) }
        else { content() }
    }
}
