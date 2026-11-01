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

enum ReadingStyleCategory: String, CaseIterable, Identifiable {
    case text = "文字", paper = "纸面", reading = "阅读"
    var id: Self { self }
    var symbol: String {
        switch self { case .text: "textformat.size"; case .paper: "circle.lefthalf.filled"; case .reading: "book.pages" }
    }
}

struct ReadingStyleTabs: View {
    @Binding var selection: ReadingStyleCategory
    var body: some View {
        Picker("阅读设置分类", selection: $selection) {
            ForEach(ReadingStyleCategory.allCases) { category in
                Label(category.rawValue, systemImage: category.symbol).tag(category)
            }
        }.pickerStyle(.segmented).accessibilityIdentifier("reading-style-categories")
    }
}

struct ReadingAppearanceControls: View {
    @Binding var preferences: ReaderPreferences
    var allowsTypography = true
    var category: ReadingStyleCategory = .text
    private func field<T>(_ path: WritableKeyPath<ReaderPreferences, T>) -> Binding<T> {
        Binding(get: { preferences[keyPath: path] }, set: { preferences[keyPath: path] = $0 })
    }
    var body: some View {
        if category == .paper {
            Section {
                ReaderPaperChoices(preferences: $preferences).padding(.vertical, 8)
            } header: { Text("纸面") }
        }
        if category == .text && allowsTypography {
            Section {
                Picker("阅读风格", selection: Binding(get: { ReaderStylePreset.matching(preferences)?.rawValue ?? "custom" }, set: { value in
                    if let style = ReaderStylePreset(rawValue: value) { preferences = style.applying(to: preferences) }
                })) {
                    if ReaderStylePreset.matching(preferences) == nil { Text("自定义").tag("custom") }
                    ForEach(ReaderStylePreset.allCases, id: \.rawValue) { Text($0.title).tag($0.rawValue) }
                }.pickerStyle(.segmented).accessibilityIdentifier("reader-style-preset")
                Picker("字体", selection: field(\.fontStyle)) {
                    Text("宋体").font(.system(.body, design: .serif)).tag(ReaderFontStyle.serif)
                    Text("黑体").font(.system(.body, design: .default)).tag(ReaderFontStyle.sans)
                    Text("圆体").font(.system(.body, design: .rounded)).tag(ReaderFontStyle.rounded)
                }.pickerStyle(.segmented).accessibilityIdentifier("reader-font-style")
                VStack(alignment: .leading, spacing: 8) {
                    HStack { Text("字号"); Spacer(); Text("\(Int(preferences.fontSize))").monospacedDigit().foregroundStyle(.secondary) }
                    Slider(value: field(\.fontSize), in: 16...36, step: 1) { Text("正文字号") }
                    minimumValueLabel: { Text("A").font(.caption) } maximumValueLabel: { Text("A").font(.title3) }
                        .accessibilityValue("\(Int(preferences.fontSize)) 磅")
                }.padding(.vertical, 5)
                VStack(alignment: .leading, spacing: 8) {
                    HStack { Label("行距", systemImage: "line.3.horizontal"); Spacer(); Text("\(Int(preferences.lineSpacing))").monospacedDigit().foregroundStyle(.secondary) }
                    Slider(value: field(\.lineSpacing), in: 4...18, step: 1).accessibilityLabel("正文行间距")
                        .accessibilityValue("\(Int(preferences.lineSpacing)) 磅")
                }.padding(.vertical, 5)
                HStack {
                    Spacer()
                    Button("恢复默认排版", systemImage: "arrow.counterclockwise") { preferences = ReaderStylePreset.classic.applying(to: preferences) }
                        .font(.footnote).frame(minHeight: 44)
                }
            }
        }
    }
}

struct ReaderPaperChoices: View {
    @Binding var preferences: ReaderPreferences
    @Environment(\.dynamicTypeSize) private var typeSize
    private let themes = [("paper", "暖纸"), ("white", "纯白"), ("sage", "青苔"), ("night", "夜读"), ("system", "系统")]
    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: typeSize.isAccessibilitySize ? 3 : 5), spacing: 10) {
            ForEach(themes, id: \.0) { theme in
                let selected = preferences.theme == theme.0
                Button {
                    preferences.theme = theme.0
                } label: {
                    ZStack {
                        Circle().fill(paper(theme.0)).frame(width: 36, height: 36)
                        if theme.0 == "system" { Image(systemName: "circle.lefthalf.filled").font(.system(size: 28, weight: .ultraLight)) }
                        if selected { Image(systemName: "checkmark").font(.system(size: 14, weight: .semibold)).padding(4).background(paper(theme.0), in: Circle()) }
                    }.frame(maxWidth: .infinity, minHeight: 52)
                    .foregroundStyle(theme.0 == "night" ? Color(white: 0.92) : theme.0 == "system" ? Color.primary : Color(white: 0.16))
                    .overlay { Circle().strokeBorder(selected ? Color.leafInk : Color.primary.opacity(0.2), lineWidth: selected ? 2 : 1).frame(width: selected ? 46 : 36, height: selected ? 46 : 36) }
                    .contentShape(Rectangle())
                }.buttonStyle(.plain)
                    .accessibilityLabel(theme.0 == "system" ? "跟随系统" : theme.1)
                    .accessibilityIdentifier("reader-theme-" + theme.0)
                    .accessibilityAddTraits(selected ? .isSelected : [])
                    .help(theme.1)
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
        Form { ReaderNavigationControls(preferences: $preferences) }
            .navigationTitle("翻页方式").modifier(ReaderToolContinuation())
    }
}

struct ReaderNavigationControls: View {
    @Binding var preferences: ReaderPreferences
    var body: some View {
        Group {
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
        }
    }
}
