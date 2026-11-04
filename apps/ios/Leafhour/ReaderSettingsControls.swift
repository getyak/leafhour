import SwiftUI
import LeafhourCore

struct ReaderBookLanguageChoices: View {
    @Bindable var session: ReaderSession
    var onValidityChange: (Bool) -> Void = { _ in }
    @State private var intent = ""
    @State private var languageError: String?
    var body: some View {
        Section {
            TextField("翻译成 English", text: $intent)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
                .submitLabel(.done).accessibilityLabel("翻译目标语言")
                .accessibilityIdentifier("reader-target-language-intent")
                .onSubmit { applyIntent() }
            if let languageError {
                Text(languageError).font(.footnote).foregroundStyle(.secondary)
                    .accessibilityIdentifier("reader-target-language-error")
            }
        } header: { Text("翻译成") } footer: {
            Text("直接写目标语言，例如 English 或日语。原文自动识别，选择目标不会开始翻译。")
        }
        .onAppear { intent = session.translationSettings.targetLanguage.title; applyIntent() }
        .onChange(of: intent) { _, _ in applyIntent() }
        .onChange(of: session.translationSettings.targetLanguage) { _, language in
            if (try? ReadingTargetIntent.parse(intent)) != language { intent = language.title }
        }
    }
    private func applyIntent() {
        do {
            let language = try ReadingTargetIntent.parse(intent)
            var settings = session.translationSettings; settings.targetLanguage = language
            session.changeTranslationSettings(settings)
            if !settings.isValid(detected: session.detectedSourceLanguage) {
                languageError = settings.resolvedSource(detected: session.detectedSourceLanguage) == nil
                    ? "暂时无法识别原文语言，尚未提交翻译。"
                    : "原文已是 \(language.title)，请修改目标语言。"
                onValidityChange(false)
            } else { languageError = nil; onValidityChange(true) }
        } catch { languageError = error.localizedDescription; onValidityChange(false) }
    }
}

/// Uses cached real text; changing these templates never prepares model work.
struct TranslationDisplayChoices: View {
    @Bindable var session: ReaderSession
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    private var preferences: Binding<ReaderPreferences> { Binding(get: { session.state.preferences }, set: { session.changePreferences($0) }) }
    private var passage: Passage? {
        session.chapter.passages.first { $0.id == session.currentAnchor?.passageID && !$0.heading && $0.resourcePath == nil }
            ?? session.chapter.passages.first { !$0.heading && $0.resourcePath == nil }
    }
    var body: some View {
        Section("显示方式") {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(spacing: 10) { templates }
            } else { HStack(alignment: .top, spacing: 8) { templates } }
            if session.state.preferences.viewMode != .source {
                Picker("译文版本", selection: preferences.translationVariant) {
                    Text("直译").tag(ReaderTranslationVariant.literal)
                    Text("意译").tag(ReaderTranslationVariant.interpretive)
                }.pickerStyle(.segmented).accessibilityIdentifier("reader-page-translation-variant")
            }
        }
        if session.state.preferences.viewMode == .parallel {
            Section("对照排版") {
                HStack(spacing: 10) {
                    orderChoice(.sourceFirst, title: "原文在前")
                    orderChoice(.translationFirst, title: "译文在前")
                }
                VStack(alignment: .leading) {
                    Text("原文字号 \(Int(session.state.preferences.parallelSourceScale * 100))%")
                    Slider(value: preferences.parallelSourceScale, in: 0.8...1.2, step: 0.05)
                        .accessibilityLabel("对照原文字号").accessibilityIdentifier("reader-parallel-source-scale")
                }
                VStack(alignment: .leading) {
                    Text("原文深浅 \(Int(session.state.preferences.parallelSourceOpacity * 100))%")
                    Slider(value: preferences.parallelSourceOpacity, in: 0.7...1, step: 0.05)
                        .accessibilityLabel("对照原文深浅").accessibilityIdentifier("reader-parallel-source-opacity")
                }
                VStack(alignment: .leading) {
                    Text("段间距 \(Int(session.state.preferences.parallelSpacing))")
                    Slider(value: preferences.parallelSpacing, in: 8...40, step: 2)
                        .accessibilityLabel("对照段间距").accessibilityIdentifier("reader-parallel-spacing")
                }
                Text("立即应用于小样和正文，阅读位置会保留。").font(.footnote).foregroundStyle(.secondary)
            }
        }
    }
    @ViewBuilder private var templates: some View {
        ForEach(ReaderViewMode.allCases, id: \.rawValue) { mode in
            let title = mode == .source ? "原版" : mode == .translation ? "译文" : "对照"
            Button {
                var value = session.state.preferences; value.viewMode = mode; session.changePreferences(value)
            } label: {
                VStack(alignment: .leading, spacing: 8) {
                    thumbnail(mode: mode, order: session.state.preferences.parallelOrder)
                        .frame(maxWidth: .infinity, minHeight: 82, maxHeight: 110, alignment: .topLeading)
                    HStack(spacing: 3) {
                        Text(title).font(.subheadline)
                        if session.state.preferences.viewMode == mode { Image(systemName: "checkmark.circle.fill").font(.caption) }
                    }
                }.padding(10).frame(maxWidth: .infinity, alignment: .leading)
                    .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(session.state.preferences.viewMode == mode ? Color.accentColor : Color.secondary.opacity(0.25), lineWidth: session.state.preferences.viewMode == mode ? 2 : 1))
            }.buttonStyle(.plain).frame(minHeight: 44)
                .accessibilityLabel(title)
                .accessibilityValue(session.state.preferences.viewMode == mode ? "已选择" : "未选择")
                .accessibilityIdentifier("reader-translation-template-" + mode.rawValue)
        }
    }
    private func orderChoice(_ order: ReaderParallelOrder, title: String) -> some View {
        Button {
            var value = session.state.preferences; value.parallelOrder = order; session.changePreferences(value)
        } label: {
            VStack(alignment: .leading, spacing: 8) {
                thumbnail(mode: .parallel, order: order).frame(maxHeight: 110)
                Label(title, systemImage: session.state.preferences.parallelOrder == order ? "checkmark.circle.fill" : "circle")
                    .font(.subheadline)
            }.padding(10).frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(session.state.preferences.parallelOrder == order ? Color.accentColor : Color.secondary.opacity(0.25)))
        }.buttonStyle(.plain).accessibilityLabel(title)
            .accessibilityValue(session.state.preferences.parallelOrder == order ? "已选择" : "未选择")
            .accessibilityIdentifier("reader-parallel-order-" + order.rawValue)
    }
    @ViewBuilder private func thumbnail(mode: ReaderViewMode, order: ReaderParallelOrder) -> some View {
        let source = passage?.text ?? "暂无可预览正文"
        let translation = passage.flatMap { session.translations[$0.id] }.flatMap { value in value.original == passage?.text ? value.text(session.state.preferences.translationVariant) : nil }
        let translated = translation ?? source
        VStack(alignment: .leading, spacing: mode == .parallel ? session.state.preferences.parallelSpacing / 3 : 4) {
            if mode == .source { sample(source, translated: false, parallel: false) }
            else if mode == .translation {
                if translation == nil { Text("译文尚未准备 · 原文").font(.caption2).foregroundStyle(.secondary) }
                sample(translated, translated: translation != nil, parallel: false)
            } else if order == .sourceFirst {
                sample(source, translated: false)
                if translation == nil { Text("译文尚未准备").font(.caption2).foregroundStyle(.secondary) }
                else { sample(translated, translated: true) }
            } else {
                if translation == nil { Text("译文尚未准备").font(.caption2).foregroundStyle(.secondary) }
                else { sample(translated, translated: true) }
                sample(source, translated: false)
            }
        }.frame(maxWidth: .infinity, alignment: .leading).clipped().accessibilityHidden(true)
    }
    private func sample(_ text: String, translated: Bool, parallel: Bool = true) -> some View {
        Text(String(text.prefix(100))).font(.system(size: translated || !parallel ? 12 : 12 * session.state.preferences.parallelSourceScale))
            .foregroundStyle(Color.primary.opacity(translated || !parallel ? 1 : session.state.preferences.parallelSourceOpacity))
            .lineLimit(3).multilineTextAlignment(.leading)
    }
}

struct ReaderThemeChoices: View {
    @Bindable var session: ReaderSession
    var body: some View {
        ReaderPaperChoices(preferences: Binding(get: { session.state.preferences }, set: { session.changePreferences($0) }))
    }
}

struct ReaderTranslationPreparation: View {
    @Bindable var session: ReaderSession
    @Bindable var reading: ReaderReadingContent
    var body: some View {
        Section {
            if reading.isFollowing || reading.running {
                Text(reading.status ?? "正在准备当前范围的译文").font(.subheadline)
                Button("停止随读翻译", systemImage: "stop.circle") { reading.stopFollowing() }.frame(minHeight: 44)
            } else {
                Button("设置随读翻译", systemImage: "character.book.closed") { reading.requestFollowingPreparation?() }
                    .frame(minHeight: 44).disabled(reading.requestFollowingPreparation == nil)
                    .accessibilityIdentifier("reader-follow-translation-settings")
            }
            if let error = reading.error { Text(error).font(.footnote).foregroundStyle(.secondary).textSelection(.enabled) }
        } header: { Text("AI 译文") } footer: {
            Text("显式开启后，只准备当前页及紧邻的最多两段。关闭、跳章或进入后台会停止，不遍历整本书。")
        }
    }
}
