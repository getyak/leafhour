import SwiftUI
import LeafhourCore

struct ReaderThemeChoices: View {
    @Bindable var session: ReaderSession
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    private let choices = [("paper", "清纸"), ("night", "夜读"), ("system", "系统")]
    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) { ForEach(choices, id: \.0) { choice in tile(choice.0, title: choice.1) } }
            VStack(spacing: 12) { ForEach(choices, id: \.0) { choice in tile(choice.0, title: choice.1) } }
        }
    }
    private func tile(_ value: String, title: String) -> some View {
        let selected = session.state.preferences.theme == value
        let paper: Color = value == "paper" ? .readingPaper : value == "night" ? Color(white: 0.12) : Color(uiColor: .systemBackground)
        let ink: Color = value == "night" ? Color(white: 0.92) : value == "paper" ? Color(white: 0.2) : .primary
        return Button {
            var preferences = session.state.preferences; preferences.theme = value; session.changePreferences(preferences)
        } label: {
            VStack(spacing: 10) {
                Text("Aa").font(.system(.title2, design: .serif)).foregroundStyle(ink).padding(.top, 4)
                HStack(spacing: 5) {
                    Text(title).font(.subheadline).foregroundStyle(ink)
                    if selected { Image(systemName: "checkmark").font(.caption.weight(.semibold)).foregroundStyle(ink) }
                }
            }
            .frame(maxWidth: .infinity, minHeight: 86).padding(.horizontal, 8).padding(.vertical, 8)
            .background(paper, in: RoundedRectangle(cornerRadius: 14))
            .overlay { RoundedRectangle(cornerRadius: 14).strokeBorder(selected ? Color.leafInk : Color.primary.opacity(0.1), lineWidth: selected ? 2 : 1) }
            .contentShape(RoundedRectangle(cornerRadius: 14))
        }
        .buttonStyle(.plain).accessibilityLabel(title == "系统" ? "跟随系统" : title)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

struct ReaderTranslationPreparation: View {
    @Bindable var session: ReaderSession
    @Bindable var reading: ReaderReadingContent
    var body: some View {
        Section {
            if session.book.cloud != nil {
                if reading.running {
                    ProgressView(value: Double(reading.completedCount), total: Double(max(1, reading.totalCount))) {
                        Text("译文 \(reading.completedCount)/\(reading.totalCount)").monospacedDigit()
                    }.accessibilityIdentifier("reader-translation-progress")
                    Button("暂停翻译", systemImage: "pause.circle") { reading.stop() }.frame(minHeight: 44)
                } else {
                    Button("先翻译当前段", systemImage: "character.book.closed") { reading.requestPassagePreparation?() }
                        .frame(minHeight: 44).disabled(reading.loading).accessibilityIdentifier("reader-translate-passage")
                    Button("逐段翻译本章", systemImage: "text.book.closed") { reading.requestPreparation?() }
                        .frame(minHeight: 44).disabled(reading.loading).accessibilityIdentifier("reader-translate-chapter")
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
            Text("本次范围：\(session.book.chapters.filter { run.plan.chapterIDs.contains($0.id) }.map(\.title).joined(separator: "、"))，\(run.plan.scope == .passage ? "当前一段" : "逐段处理")。还剩 \(max(0, run.plan.passageIDs.count - run.next)) 段，启用阅读点时最多 \(max(0, run.plan.passageIDs.count - run.next)) 点。每段提交前核对报价；未确认的请求沿用原请求恢复，已有双译不会重做。进入后台或切回原著会暂停。")
        }
    }
}
