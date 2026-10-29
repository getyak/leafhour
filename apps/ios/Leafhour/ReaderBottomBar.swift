import SwiftUI
import UIKit

/// Reading controls only. The reader owns navigation, speech and its idle clock.
struct ReaderBottomBar: View {
    enum Mode { case reading, listening }

    let mode: Mode
    let chapterAccessibilityValue: String
    var listeningAccessibilityHint = "打开听书控制，点击播放后才开始。"
    let onContents: () -> Void
    let onRead: () -> Void
    let onListen: () -> Void
    let onAppearance: () -> Void
    let onTypography: () -> Void
    var onInteraction: () -> Void = {}
    var onFocusChange: (Bool) -> Void = { _ in }

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.colorScheme) private var colorScheme
    @ScaledMetric(relativeTo: .body) private var iconSize = 20.0
    private enum Control: Hashable {
        case contents, read, listen, appearance, typography
        var identifier: String {
            switch self {
            case .contents: "reader-contents"
            case .read: "reader-read"
            case .listen: "reader-listen"
            case .appearance: "reader-appearance"
            case .typography: "reader-typography"
            }
        }
    }
    @FocusState private var focusedControl: Control?

    private var surface: Color {
        colorScheme == .dark ? Color(uiColor: .secondarySystemBackground) : .readingPaper
    }

    var body: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(spacing: 10) {
                    readingModes(expanded: true)
                    HStack(spacing: 8) {
                        contentsButton(expanded: false, fillsWidth: true)
                        appearanceButton(expanded: false, fillsWidth: true)
                        typographyButton(expanded: false, fillsWidth: true)
                    }
                }
            } else {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 8) {
                        contentsButton(expanded: false)
                        readingModes(expanded: false)
                        appearanceButton(expanded: false)
                        typographyButton(expanded: false)
                    }.fixedSize(horizontal: true, vertical: false)
                    VStack(spacing: 10) {
                        readingModes(expanded: true)
                        HStack(spacing: 8) {
                            contentsButton(expanded: false, fillsWidth: true)
                            appearanceButton(expanded: false, fillsWidth: true)
                            typographyButton(expanded: false, fillsWidth: true)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity)
        .onChange(of: focusedControl) { _, control in onFocusChange(control != nil) }
        .onDisappear { onFocusChange(false) }
    }

    private func contentsButton(expanded: Bool, fillsWidth: Bool = false) -> some View {
        iconButton("目录", symbol: "list.bullet", control: .contents, expanded: expanded, fillsWidth: fillsWidth, action: onContents)
            .accessibilityValue(chapterAccessibilityValue)
            .accessibilityHint("打开目录与阅读进度")
    }

    private func appearanceButton(expanded: Bool, fillsWidth: Bool = false) -> some View {
        iconButton("外观", symbol: "circle.lefthalf.filled", control: .appearance, expanded: expanded, fillsWidth: fillsWidth, action: onAppearance)
            .accessibilityHint("选择阅读纸面与夜读外观")
    }

    private func iconButton(_ title: String, symbol: String, control: Control, expanded: Bool, fillsWidth: Bool = false, action: @escaping () -> Void) -> some View {
        Button { perform(action) } label: {
            HStack(spacing: 12) {
                Image(systemName: symbol).font(.system(size: iconSize, weight: .regular))
                if expanded {
                    Text(title).font(.body.weight(.medium)).fixedSize(horizontal: false, vertical: true)
                }
            }
            .foregroundStyle(Color.primary)
            .padding(.horizontal, expanded ? 14 : 4).padding(.vertical, 4)
            .frame(minWidth: 44, maxWidth: expanded || fillsWidth ? .infinity : nil, minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background { pillSurface }
        .focused($focusedControl, equals: control)
        .accessibilityLabel(title)
        .accessibilityIdentifier(control.identifier)
    }

    private func typographyButton(expanded: Bool, fillsWidth: Bool = false) -> some View {
        Button { perform(onTypography) } label: {
            HStack(spacing: 12) {
                Text("Aa").font(.system(.body, design: .serif).weight(.semibold))
                if expanded {
                    Text("排版").font(.body.weight(.medium)).fixedSize(horizontal: false, vertical: true)
                }
            }
            .foregroundStyle(Color.primary)
            .padding(.horizontal, expanded ? 14 : 4).padding(.vertical, 4)
            .frame(minWidth: 44, maxWidth: expanded || fillsWidth ? .infinity : nil, minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background { pillSurface }
        .focused($focusedControl, equals: .typography)
        .accessibilityLabel("阅读设置")
        .accessibilityHint("调整字号与行间距")
        .accessibilityIdentifier(Control.typography.identifier)
    }

    private func readingModes(expanded: Bool) -> some View {
        HStack(spacing: 2) {
            modeButton("阅读", control: .read, selected: mode == .reading, expanded: expanded, action: onRead)
                .accessibilityHint("继续看书，暂停当前朗读并保留听书位置")
            modeButton("听书", control: .listen, selected: mode == .listening, expanded: expanded, action: onListen)
                .accessibilityHint(listeningAccessibilityHint)
        }
        .padding(3)
        .background { pillSurface }
    }

    private func modeButton(_ title: String, control: Control, selected: Bool, expanded: Bool, action: @escaping () -> Void) -> some View {
        Button { perform(action) } label: {
            Text(title).font(.subheadline.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 8)
                .frame(minWidth: 50, maxWidth: expanded ? .infinity : nil, minHeight: 44)
                .background(selected ? Color.primary.opacity(colorScheme == .dark ? 0.16 : 0.08) : .clear, in: Capsule())
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain).foregroundStyle(Color.primary)
        .focused($focusedControl, equals: control)
        .accessibilityLabel(title)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier(control.identifier)
    }

    private var pillSurface: some View {
        Capsule().fill(surface)
            .overlay { Capsule().strokeBorder(Color.primary.opacity(colorScheme == .dark ? 0.16 : 0.08), lineWidth: 0.5) }
            .shadow(color: .black.opacity(colorScheme == .dark ? 0 : 0.05), radius: 8, y: 2)
    }

    private func perform(_ action: () -> Void) {
        onInteraction()
        action()
    }
}
