import SwiftUI
import LeafhourCore

struct ReaderBookLanguageChoices: View {
    @Bindable var session: ReaderSession
    private var source: Binding<ReadingLanguage?> {
        Binding(get: { session.translationSettings.sourceLanguage }, set: { value in
            var settings = session.translationSettings; settings.sourceLanguage = value; session.changeTranslationSettings(settings)
        })
    }
    private var target: Binding<ReadingLanguage> {
        Binding(get: { session.translationSettings.targetLanguage }, set: { value in
            var settings = session.translationSettings; settings.targetLanguage = value; session.changeTranslationSettings(settings)
        })
    }
    var body: some View {
        Section {
            Picker("原文语言", selection: source) {
                Text("自动 · " + (session.detectedSourceLanguage?.title ?? "请选择语言")).tag(Optional<ReadingLanguage>.none)
                ForEach(ReadingLanguage.allCases, id: \.rawValue) { Text($0.title).tag(Optional($0)) }
            }.accessibilityIdentifier("reader-source-language")
            Picker("译入语言", selection: target) {
                ForEach(ReadingLanguage.allCases, id: \.rawValue) { Text($0.title).tag($0) }
            }.accessibilityIdentifier("reader-target-language")
            if !session.translationSettings.isValid(detected: session.detectedSourceLanguage) {
                Text(session.translationSettings.resolvedSource(detected: session.detectedSourceLanguage) == nil ? "请选择这本书的原文语言。" : "原文与译入语言相同，请选择另一种译入语言。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        } header: { Text("这本书的翻译") } footer: {
            Text("只用于这本书。已有译文会保留；选择语言不会开始翻译。")
        }
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
            Text((session.translationSettings.resolvedSource(detected: session.detectedSourceLanguage)?.title ?? "待选择") + " → " + session.translationSettings.targetLanguage.title)
                .font(.subheadline).foregroundStyle(.secondary).accessibilityIdentifier("reader-translation-direction")
            if session.book.cloud != nil {
                if reading.running {
                    ProgressView(value: Double(reading.completedCount), total: Double(max(1, reading.totalCount))) {
                        Text("译文 \(reading.completedCount)/\(reading.totalCount)").monospacedDigit()
                    }.accessibilityIdentifier("reader-translation-progress")
                    Button("暂停翻译", systemImage: "pause.circle") { reading.stop() }.frame(minHeight: 44)
                } else {
                    Button("先翻译当前段", systemImage: "character.book.closed") { reading.requestPassagePreparation?() }
                        .frame(minHeight: 44).disabled(reading.loading || !session.translationSettings.isValid(detected: session.detectedSourceLanguage)).accessibilityIdentifier("reader-translate-passage")
                    Button("逐段翻译本章", systemImage: "text.book.closed") { reading.requestPreparation?() }
                        .frame(minHeight: 44).disabled(reading.loading || !session.translationSettings.isValid(detected: session.detectedSourceLanguage)).accessibilityIdentifier("reader-translate-chapter")
                }
                if reading.loading { ProgressView("正在更新译文").font(.footnote) }
                if let status = reading.status { Text(status).font(.footnote).foregroundStyle(.secondary) }
                if let error = reading.error { Text(error).font(.footnote).foregroundStyle(.secondary).textSelection(.enabled) }
            } else {
                Text("本机原件仍可阅读。将书同步到自己的账号后，可以准备译文。")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
        } header: { Text("AI 译文") } footer: {
            Text("从当前位置开始，每段完成即可阅读。只处理选定的一段或本章，每次最多 100 段；暂停后，已提交的一段仍可能完成并计点。")
        }
        .alert("准备或恢复译文", isPresented: Binding(get: { reading.proposed != nil }, set: { if !$0 { reading.proposed = nil } }), presenting: reading.proposed) { run in
            Button("开始翻译") { reading.confirmPreparation?(run) }
            Button("暂不", role: .cancel) { reading.proposed = nil }
        } message: { run in
            Text(confirmation(run))
        }
    }
    private func confirmation(_ run: ReaderTranslationRun) -> String {
        ReaderTranslationConfirmation.text(run, session: session)
    }
}
