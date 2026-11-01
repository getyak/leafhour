import SwiftUI
import UIKit
import LeafhourCore

/// A single paper palette for the page, snapshots, PDF surround and settings preview.
extension ReaderPreferences {
    var paperColor: UIColor {
        switch theme {
        case "paper": UIColor(red: 0.97, green: 0.96, blue: 0.92, alpha: 1)
        case "white": .white
        case "sage": UIColor(red: 0.90, green: 0.94, blue: 0.89, alpha: 1)
        case "night": UIColor(white: 0.12, alpha: 1)
        default: .systemBackground
        }
    }
}

struct ReadingAppearanceControls: View {
    @Binding var preferences: ReaderPreferences
    var allowsTypography = true
    private func field<T>(_ path: WritableKeyPath<ReaderPreferences, T>) -> Binding<T> {
        Binding(get: { preferences[keyPath: path] }, set: { preferences[keyPath: path] = $0 })
    }
    var body: some View {
        Section("纸面主题") {
            ReaderPaperChoices(preferences: $preferences)
                .padding(.vertical, 6)
        }
        if allowsTypography {
            Section {
                Picker("阅读风格", selection: Binding(get: { ReaderStylePreset.matching(preferences)?.rawValue ?? "custom" }, set: { value in
                    if let style = ReaderStylePreset(rawValue: value) { preferences = style.applying(to: preferences) }
                })) {
                    if ReaderStylePreset.matching(preferences) == nil { Text("自定义").tag("custom") }
                    ForEach(ReaderStylePreset.allCases, id: \.rawValue) { Text($0.title).tag($0.rawValue) }
                }.accessibilityIdentifier("reader-style-preset")
                Picker("字体", selection: field(\.fontStyle)) {
                    Text("衬线").tag(ReaderFontStyle.serif)
                    Text("无衬线").tag(ReaderFontStyle.sans)
                    Text("圆体").tag(ReaderFontStyle.rounded)
                }.accessibilityIdentifier("reader-font-style")
                VStack(alignment: .leading, spacing: 8) {
                    HStack { Text("字号"); Spacer(); Text("\(Int(preferences.fontSize))").monospacedDigit().foregroundStyle(.secondary) }
                    Slider(value: field(\.fontSize), in: 16...36, step: 1) { Text("正文字号") }
                    minimumValueLabel: { Text("A").font(.caption) } maximumValueLabel: { Text("A").font(.title3) }
                        .accessibilityValue("\(Int(preferences.fontSize)) 磅")
                }.padding(.vertical, 5)
                DisclosureGroup("排版细节") {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack { Text("行间距"); Spacer(); Text("\(Int(preferences.lineSpacing))").monospacedDigit().foregroundStyle(.secondary) }
                        Slider(value: field(\.lineSpacing), in: 4...18, step: 1).accessibilityLabel("正文行间距")
                    }.padding(.vertical, 8)
                    Button("恢复默认排版") { preferences = ReaderStylePreset.classic.applying(to: preferences) }.frame(minHeight: 44)
                }
            } header: { Text("文字") } footer: { Text("风格同时调整字体、字号和间距，也可单独修改。随系统文字大小缩放。") }
        }
    }
}

struct ReaderPaperChoices: View {
    @Binding var preferences: ReaderPreferences
    @Environment(\.dynamicTypeSize) private var typeSize
    private let themes = [("paper", "暖纸"), ("white", "纯白"), ("sage", "青苔"), ("night", "夜读"), ("system", "系统")]
    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: typeSize.isAccessibilitySize ? 2 : 3), spacing: 10) {
            ForEach(themes, id: \.0) { theme in
                let selected = preferences.theme == theme.0
                Button {
                    preferences.theme = theme.0
                } label: {
                    VStack(spacing: 8) {
                        Text("Aa").font(.system(.title2, design: .serif))
                        HStack(spacing: 4) {
                            Text(theme.1).font(.subheadline)
                            if selected { Image(systemName: "checkmark.circle.fill").font(.caption) }
                        }
                    }
                    .foregroundStyle(theme.0 == "night" ? Color(white: 0.92) : theme.0 == "system" ? Color.primary : Color(white: 0.16))
                    .frame(maxWidth: .infinity, minHeight: 88).padding(.horizontal, 4).padding(.vertical, 6)
                    .background(paper(theme.0), in: RoundedRectangle(cornerRadius: 16))
                    .overlay { RoundedRectangle(cornerRadius: 16).strokeBorder(selected ? Color.leafInk : Color.primary.opacity(0.12), lineWidth: selected ? 2 : 1) }
                    .contentShape(RoundedRectangle(cornerRadius: 16))
                }.buttonStyle(.plain)
                    .accessibilityLabel(theme.0 == "system" ? "跟随系统" : theme.1)
                    .accessibilityIdentifier("reader-theme-" + theme.0)
                    .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
    }
    private func paper(_ theme: String) -> Color {
        var value = preferences; value.theme = theme
        return Color(uiColor: value.paperColor)
    }
}

struct ReaderNavigationSettings: View {
    @Binding var preferences: ReaderPreferences
    var body: some View {
        Form {
            Section {
                Picker("翻页方式", selection: $preferences.navigationMode) {
                    Text("上下滚动").tag(ReaderNavigationMode.scroll)
                    Text("左右翻页").tag(ReaderNavigationMode.paged)
                }.pickerStyle(.segmented).accessibilityIdentifier("reader-navigation-mode")
                if preferences.navigationMode == .paged {
                    Picker("翻页动画", selection: $preferences.pageAnimation) {
                        Text("平移").tag(ReaderPageAnimation.slide); Text("仿真卷页").tag(ReaderPageAnimation.curl); Text("无动画").tag(ReaderPageAnimation.none)
                    }.accessibilityIdentifier("reader-page-animation")
                    Picker("翻页手势", selection: $preferences.pageInput) {
                        Text("轻点与滑动").tag(ReaderPageInput.tapAndSwipe); Text("仅滑动").tag(ReaderPageInput.swipeOnly); Text("仅轻点").tag(ReaderPageInput.tapOnly)
                    }.accessibilityIdentifier("reader-page-input")
                }
            } footer: { Text("轻点书页中间唤回工具，长按可选字。开启系统“减弱动态效果”时直接切页。") }
        }.navigationTitle("翻页方式")
            .modifier(ReaderToolContinuation())
    }
}
