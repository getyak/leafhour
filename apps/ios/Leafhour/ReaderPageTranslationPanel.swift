import SwiftUI
import LeafhourCore

/// Presentation is configured before capturing/confirming this page's scope.
/// Changing a picker never submits model work.
struct ReaderPageTranslationPanel: View {
    @Bindable var session: ReaderSession
    @Bindable var reading: ReaderReadingContent
    let cloud: CloudLibraryClient?
    let library: OfflineLibrary?
    let page: ReaderVisiblePage?
    private var currentPage: ReaderVisiblePage? { page.flatMap { $0.isCurrent(session) ? $0 : nil } }
    private var preferences: Binding<ReaderPreferences> { Binding(get: { session.state.preferences }, set: { session.changePreferences($0) }) }
    var body: some View {
        Form {
            ReaderBookLanguageChoices(session: session).disabled(reading.running)
            Section("显示方式") {
                Picker("阅读内容", selection: preferences.viewMode) {
                    Text("原著").tag(ReaderViewMode.source)
                    Text("译文").tag(ReaderViewMode.translation)
                    Text("对照").tag(ReaderViewMode.parallel)
                }.pickerStyle(.segmented).accessibilityIdentifier("reader-page-translation-mode").disabled(reading.running)
                Picker("译文版本", selection: preferences.translationVariant) {
                    Text("直译").tag(ReaderTranslationVariant.literal); Text("意译").tag(ReaderTranslationVariant.interpretive)
                }.pickerStyle(.segmented).accessibilityIdentifier("reader-page-translation-variant").disabled(reading.running)
            }
            Section {
                if let currentPage {
                    Text("本页涉及 \(currentPage.passageIDs.count) 个原文段落").font(.subheadline)
                        .accessibilityIdentifier("reader-page-translation-scope")
                } else {
                    Text("当前页尚未取得可翻译的正文。页面仍在排版时，请稍等；扫描图片页需要先有可核对文字。")
                        .font(.subheadline).foregroundStyle(.secondary).accessibilityIdentifier("reader-page-translation-unavailable")
                }
                if reading.running {
                    ProgressView(value: Double(reading.completedCount), total: Double(max(1, reading.totalCount))) {
                        Text("译文 \(reading.completedCount)/\(reading.totalCount)").monospacedDigit()
                    }
                    Button("暂停本次翻译", systemImage: "pause.circle") { reading.stop() }.frame(minHeight: 44)
                } else {
                    Button("准备本页译文", systemImage: "character.book.closed") {
                        let snapshot = currentPage
                        Task { await reading.prepare(session, cloud: cloud, library: library, scope: .page, page: snapshot) }
                    }.frame(minHeight: 44).accessibilityIdentifier("reader-page-translation-prepare")
                        .disabled(currentPage == nil || reading.loading || session.state.preferences.viewMode == .source || session.book.cloud == nil || cloud == nil || library == nil)
                }
                if session.state.preferences.viewMode == .source {
                    Text("选择“译文”或“对照”后，可准备本页译文。").font(.footnote).foregroundStyle(.secondary)
                }
                if session.book.cloud == nil {
                    Text("已有译文仍可阅读。将这本书同步到自己的账号后，可以准备新的 AI 译文。").font(.footnote).foregroundStyle(.secondary)
                }
                if reading.loading { ProgressView("正在核对本页范围").font(.footnote) }
                if let status = reading.status { Text(status).font(.footnote).foregroundStyle(.secondary).accessibilityIdentifier("reader-page-translation-status") }
                if let error = reading.error { Text(error).font(.footnote).foregroundStyle(.secondary).textSelection(.enabled).accessibilityIdentifier("reader-page-translation-error") }
            } header: { Text("当前页") } footer: {
                Text(session.book.kind == .pdf
                    ? "范围只取当前 PDF 原页的可见正文，相邻原页另行处理。页边露出半段时，补齐完整段落；已有双译不重做。"
                    : "范围按当前排版的一页计算。页边露出半段时，补齐该段的完整双译；已有双译不重做。字号、语言或显示方式改变后，会重新核对本页范围，不提前翻译整章。")
            }
        }.navigationTitle("当前页翻译")
            .onAppear { reading.offerFirstPassage = false }
            .alert("翻译本页", isPresented: Binding(get: { reading.proposed != nil }, set: { if !$0 { reading.proposed = nil } }), presenting: reading.proposed) { run in
                Button(run.recoverPendingOnly == true ? "核对上次请求" : "开始翻译") { reading.confirm(run, session: session, cloud: cloud, library: library) }
                Button("暂不", role: .cancel) { reading.proposed = nil }
            } message: { run in Text(ReaderTranslationConfirmation.text(run, session: session)) }
    }
}

@MainActor enum ReaderTranslationConfirmation {
    static func text(_ run: ReaderTranslationRun, session: ReaderSession) -> String {
        let scope: String
        if run.recoverPendingOnly == true { scope = "只核对上次未确认的一段，不继续上次范围中的后续段落" }
        else if run.pending != nil { scope = "先核对上次未确认的一段，再按原先确认范围继续" }
        else if run.plan.scope == .page { scope = "只准备当前页涉及的完整段落" }
        else if run.plan.scope == .passage { scope = "当前一段" }
        else { scope = "逐段处理已选范围" }
        let count = run.remainingParagraphCount
        let chapter = session.book.chapters.filter { run.plan.chapterIDs.contains($0.id) }.map(\.title).joined(separator: "、")
        return "本次范围：\(chapter)，\(scope)。剩余 \(count) 段；启用阅读点时最多 \(count) 点，每段提交前仍核对实际报价。页边的半段按完整段落保存，已有双译不重做。未确认的请求沿用原请求恢复；进入后台或切回原著会暂停后续翻译。"
    }
}
