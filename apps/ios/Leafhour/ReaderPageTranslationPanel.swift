import SwiftUI
import LeafhourCore

struct ReaderPageTranslationPanel: View {
    @Bindable var session: ReaderSession
    @Bindable var reading: ReaderReadingContent
    let cloud: CloudLibraryClient?
    let library: OfflineLibrary?
    let page: ReaderVisiblePage?
    /// The parent should provide its real user-navigation marker, not a reflow ID.
    var userNavigationID: UUID? = nil
    @Environment(\.dismiss) private var dismiss
    @State private var targetValid = false
    private var currentPage: ReaderVisiblePage? { page.flatMap { $0.isCurrent(session) ? $0 : nil } }
    var body: some View {
        Form {
            ReaderBookLanguageChoices(session: session, onValidityChange: { targetValid = $0 })
            TranslationDisplayChoices(session: session)
            Section {
                if let currentPage {
                    Text("当前页 \(currentPage.passageIDs.count) 段，及紧邻的最多两段")
                        .font(.subheadline).accessibilityIdentifier("reader-page-translation-scope")
                } else {
                    Text("当前页尚未取得可翻译的正文。请等页面排版完成；扫描图片页需要先有可核对的文字。")
                        .font(.subheadline).foregroundStyle(.secondary).accessibilityIdentifier("reader-page-translation-unavailable")
                }
                if reading.isFollowing || reading.running {
                    ProgressView(value: Double(reading.completedCount), total: Double(max(1, reading.totalCount))) {
                        Text("当前范围 \(reading.completedCount)/\(reading.totalCount)").monospacedDigit()
                    }
                    Button("停止随读翻译", systemImage: "stop.circle") { reading.stopFollowing() }
                        .frame(minHeight: 44).accessibilityIdentifier("reader-follow-translation-stop")
                    Button("返回阅读", systemImage: "book") { dismiss() }.frame(minHeight: 44)
                } else {
                    Button("开启随读翻译并返回阅读", systemImage: "character.book.closed") {
                        let snapshot = currentPage
                        Task {
                            await reading.startFollowing(session, cloud: cloud, library: library, page: snapshot, userNavigationID: userNavigationID ?? session.navigationID)
                            if reading.isFollowing { dismiss() }
                        }
                    }.frame(minHeight: 44).accessibilityIdentifier("reader-follow-translation-start")
                        .disabled(currentPage == nil || !targetValid || reading.loading || session.state.preferences.viewMode == .source || session.book.cloud == nil || cloud == nil || library == nil)
                }
                if session.state.preferences.viewMode == .source {
                    Text("选择译文或对照后，再开启随读翻译。").font(.footnote).foregroundStyle(.secondary)
                }
                if session.book.cloud == nil {
                    Text("已有译文仍可阅读。将书同步到自己的账号后，可以准备新的 AI 译文。").font(.footnote).foregroundStyle(.secondary)
                }
                if reading.loading { ProgressView("正在核对当前范围").font(.footnote) }
                if let status = reading.status { Text(status).font(.footnote).foregroundStyle(.secondary).accessibilityIdentifier("reader-page-translation-status") }
                if let error = reading.error { Text(error).font(.footnote).foregroundStyle(.secondary).textSelection(.enabled).accessibilityIdentifier("reader-page-translation-error") }
            } header: { Text("随读翻译") } footer: {
                Text("仅在开启后从当前页向下准备，每个窗口最多 12 段。每段最多 1 阅读点，提交前核对实际报价；已有完整双译不重做。窗口完成后等待你继续阅读。叉关闭会停止当前请求和后续任务，停止结果不明时保留原请求供核对。")
            }
        }.navigationTitle("阅读翻译")
            .onAppear { reading.offerFirstPassage = false }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button { reading.stopFollowing(); dismiss() } label: { Image(systemName: "xmark") }
                        .frame(minWidth: 44, minHeight: 44).accessibilityLabel("停止翻译并关闭")
                        .accessibilityIdentifier("reader-follow-translation-close")
                }
            }
    }
}

@MainActor enum ReaderTranslationConfirmation {
    static func text(_ run: ReaderTranslationRun, session: ReaderSession) -> String {
        let scope: String
        if run.recoverPendingOnly == true { scope = "只核对上次未确认的一段，不继续后续段落" }
        else if run.pending != nil { scope = "先核对上次未确认的一段" }
        else if run.plan.scope == .following { scope = "当前页及紧邻的最多两段" }
        else if run.plan.scope == .page { scope = "当前页涉及的完整段落" }
        else if run.plan.scope == .passage { scope = "当前一段" }
        else { scope = "原先明确选择的范围" }
        return "本次范围：\(scope)，剩余 \(run.remainingParagraphCount) 段。每段最多 1 阅读点，提交前核对实际报价。已有双译不重做。进入后台或切回原版会停止。"
    }
}
