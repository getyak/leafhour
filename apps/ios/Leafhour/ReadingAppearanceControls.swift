import SwiftUI
import UIKit
import LeafhourCore

/// Shared by page, snapshots, PDF surround and both settings entry points.
extension ReaderPreferences {
    var paperColor: UIColor {
        switch ReaderPaper(rawValue: theme) ?? .system {
        case .paper: UIColor(red: 0.97, green: 0.96, blue: 0.92, alpha: 1)
        case .white: .white
        case .sage: UIColor(red: 0.90, green: 0.94, blue: 0.89, alpha: 1)
        case .mist: UIColor(red: 0.90, green: 0.94, blue: 0.96, alpha: 1)
        case .sand: UIColor(red: 0.94, green: 0.88, blue: 0.76, alpha: 1)
        case .rose: UIColor(red: 0.98, green: 0.92, blue: 0.88, alpha: 1)
        case .dusk: UIColor(red: 0.17, green: 0.20, blue: 0.24, alpha: 1)
        case .night: UIColor(white: 0.12, alpha: 1)
        case .system: .systemBackground
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
            Section { ReaderPaperChoices(preferences: $preferences).padding(.vertical, 6) }
        }
        if category == .text && allowsTypography {
            Section {
                VStack(spacing: 18) {
                    HStack {
                        Text("字号").font(.subheadline)
                        Text("\(Int(preferences.fontSize))").font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
                        Slider(value: field(\.fontSize), in: 16...36, step: 1) { Text("正文字号") }
                        minimumValueLabel: { Text("A").font(.caption) } maximumValueLabel: { Text("A").font(.title2) }
                            .accessibilityValue("\(Int(preferences.fontSize)) 磅")
                    }
                    HStack {
                        Text("行距").font(.subheadline)
                        Slider(value: field(\.lineSpacing), in: 4...18, step: 1) { Text("正文行间距") }
                        minimumValueLabel: { Image(systemName: "line.3.horizontal.decrease") }
                        maximumValueLabel: { Image(systemName: "line.3.horizontal") }
                            .accessibilityValue("\(Int(preferences.lineSpacing)) 磅")
                    }
                }.padding(.vertical, 6)
            }
            Section {
                VStack(alignment: .leading, spacing: 10) {
                    Text("首行缩进").font(.subheadline).foregroundStyle(.secondary)
                    Picker("首行缩进", selection: field(\.firstLineIndent)) {
                        ForEach(ReaderFirstLineIndent.allCases, id: \.rawValue) { value in Text(value.title).tag(value) }
                    }.pickerStyle(.segmented).accessibilityIdentifier("reader-first-line-indent")
                }.padding(.vertical, 4)
                VStack(alignment: .leading, spacing: 12) {
                    Text("中文").font(.subheadline).foregroundStyle(.secondary)
                    ReaderChineseFontChoices(preferences: $preferences)
                }.padding(.vertical, 4)
                NavigationLink { ReaderLatinFontChoices(preferences: $preferences).modifier(ReaderToolContinuation()) } label: {
                    HStack {
                        Text("西文")
                        Spacer()
                        Text(preferences.latinFont.title).foregroundStyle(.secondary)
                    }.font(.subheadline).frame(minHeight: 44)
                }.accessibilityIdentifier("reader-latin-font-open")
                HStack {
                    Menu {
                        ForEach(ReaderStylePreset.allCases, id: \.rawValue) { preset in
                            Button(preset.title) { preferences = preset.applying(to: preferences) }
                        }
                    } label: {
                        Label("排版 · " + (ReaderStylePreset.matching(preferences)?.title ?? "自定"), systemImage: "text.alignleft")
                    }.accessibilityIdentifier("reader-style-preset")
                    Spacer()
                    Button {
                        var value = ReaderStylePreset.classic.applying(to: preferences); value.latinFont = .automatic; preferences = value
                    } label: {
                        Image(systemName: "arrow.counterclockwise").frame(minWidth: 44, minHeight: 44)
                    }.accessibilityLabel("恢复默认排版")
                }.font(.subheadline)
            }
        }
    }
}

struct ReaderChineseFontChoices: View {
    @Binding var preferences: ReaderPreferences
    @Environment(\.dynamicTypeSize) private var typeSize
    private let choices: [(ReaderFontStyle, String)] = [(.serif, "思源宋"), (.sans, "苹方"), (.kai, "文楷"), (.rounded, "圆润")]
    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: typeSize.isAccessibilitySize ? 2 : 4), spacing: 8) {
            ForEach(choices, id: \.0) { style, title in
                let selected = preferences.fontStyle == style
                Button { preferences.fontStyle = style } label: {
                    VStack(spacing: 6) {
                        Text(style == .rounded ? "Aa" : "永").font(Font(ReaderTypography.font(style: style, size: 28, traits: UITraitCollection(preferredContentSizeCategory: ReaderTypography.category(for: typeSize))) as CTFont))
                        Text(title).font(.caption)
                    }.padding(.vertical, 12).frame(maxWidth: .infinity)
                        .background(Color.primary.opacity(selected ? 0.07 : 0.025), in: RoundedRectangle(cornerRadius: 12))
                        .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(selected ? Color.leafInk : .clear, lineWidth: 1.5) }
                }.buttonStyle(.plain).foregroundStyle(.primary)
                    .accessibilityLabel(style == .rounded ? "圆润，中文黑体与西文圆体搭配" : title)
                    .accessibilityAddTraits(selected ? .isSelected : [])
                    .accessibilityIdentifier("reader-font-" + style.rawValue)
            }
        }.accessibilityIdentifier("reader-font-style")
    }
}

struct ReaderLatinFontChoices: View {
    @Binding var preferences: ReaderPreferences
    @Environment(\.dynamicTypeSize) private var typeSize
    var body: some View {
        List {
            Section {
                ForEach(ReaderLatinFont.allCases, id: \.rawValue) { family in
                    Button { preferences.latinFont = family } label: {
                        HStack(spacing: 14) {
                            VStack(alignment: .leading, spacing: 7) {
                                Text(family.title).font(.caption).foregroundStyle(.secondary)
                                Text("Stay with a book.")
                                    .font(Font(ReaderTypography.font(style: preferences.fontStyle, size: 22, traits: UITraitCollection(preferredContentSizeCategory: ReaderTypography.category(for: typeSize)), latin: family) as CTFont))
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            Spacer(minLength: 0)
                            if preferences.latinFont == family { Image(systemName: "checkmark").foregroundStyle(Color.leafInk) }
                        }.padding(.vertical, 9).frame(minHeight: 44).contentShape(Rectangle())
                    }.buttonStyle(.plain).foregroundStyle(.primary)
                        .accessibilityAddTraits(preferences.latinFont == family ? .isSelected : [])
                        .accessibilityIdentifier("reader-latin-" + family.rawValue)
                }
            } footer: { Text("仅调整西文字形，中文保留所选字体。圆润采用黑体中文与圆体西文；所有字体均在本机使用。") }
        }.navigationTitle("西文字体").navigationBarTitleDisplayMode(.inline)
    }
}

struct ReaderPaperChoices: View {
    @Binding var preferences: ReaderPreferences
    @Environment(\.dynamicTypeSize) private var typeSize
    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: typeSize.isAccessibilitySize ? 2 : 3), spacing: 12) {
            ForEach(ReaderPaper.allCases, id: \.rawValue) { paper in
                let selected = preferences.theme == paper.rawValue
                Button { preferences.theme = paper.rawValue } label: {
                    VStack(spacing: 8) {
                        HStack {
                            if paper == .system { Image(systemName: "circle.lefthalf.filled") }
                            else { Text("Aa").font(.system(.title3, design: .serif)) }
                            Spacer(minLength: 0)
                            if selected { Image(systemName: "checkmark").font(.caption.weight(.semibold)) }
                        }
                        Text(paper.title).font(.caption).frame(maxWidth: .infinity, alignment: .leading)
                    }.padding(12).frame(maxWidth: .infinity, minHeight: 76)
                        .foregroundStyle(paper == .system ? Color.primary : paper.isDark ? Color(white: 0.94) : Color(white: 0.16))
                        .background(color(paper), in: RoundedRectangle(cornerRadius: 14))
                        .overlay { RoundedRectangle(cornerRadius: 14).strokeBorder(selected ? Color.leafInk : Color.primary.opacity(0.12), lineWidth: selected ? 2 : 0.5) }
                        .contentShape(Rectangle())
                }.buttonStyle(.plain)
                    .accessibilityLabel(paper == .system ? "跟随系统" : paper.title)
                    .accessibilityIdentifier("reader-theme-" + paper.rawValue)
                    .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
    }
    private func color(_ paper: ReaderPaper) -> Color {
        var value = preferences; value.theme = paper.rawValue
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
                    Text("滚动").accessibilityLabel("上下滚动").tag(ReaderNavigationMode.scroll)
                    Text("翻页").accessibilityLabel("左右翻页").tag(ReaderNavigationMode.paged)
                }.pickerStyle(.segmented).accessibilityIdentifier("reader-navigation-mode")
                if preferences.navigationMode == .paged {
                    Picker("动画", selection: $preferences.pageAnimation) {
                        Text("平移").tag(ReaderPageAnimation.slide); Text("仿真卷页").tag(ReaderPageAnimation.curl); Text("无动画").tag(ReaderPageAnimation.none)
                    }.accessibilityIdentifier("reader-page-animation")
                    Picker("手势", selection: $preferences.pageInput) {
                        Text("轻点与滑动").tag(ReaderPageInput.tapAndSwipe); Text("仅滑动").tag(ReaderPageInput.swipeOnly); Text("仅轻点").tag(ReaderPageInput.tapOnly)
                    }.accessibilityIdentifier("reader-page-input")
                }
            } footer: { Text("轻点中间唤回工具，长按选字。减弱动态效果开启时直接切页。") }
            Section {
                NavigationLink("更多交互设置") {
                    Form {
                        Section {
                            Toggle("始终显示阅读进度", isOn: $preferences.alwaysShowReadingProgress)
                                .accessibilityIdentifier("reader-always-show-progress")
                        } footer: { Text("默认只显示正文。轻点书页中间可打开工具和进度。") }
                        if preferences.navigationMode == .paged {
                            Section {
                                LabeledContent("翻页响应", value: preferences.pageTapDelay == 0 ? "立即" : "\(Int((preferences.pageTapDelay * 1000).rounded())) 毫秒")
                                Slider(value: $preferences.pageTapDelay, in: 0...0.5, step: 0.05)
                                    .accessibilityLabel("翻页响应延迟").accessibilityIdentifier("reader-page-tap-delay")
                            } footer: { Text("每次轻点单独翻页。增加等待时间不改变翻页动画；长按仍可选择文字。") }
                        }
                    }.navigationTitle("更多交互").modifier(ReaderToolContinuation())
                }.accessibilityIdentifier("reader-interaction-settings")
            }
        }
    }
}
