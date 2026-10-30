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
                    Button("停止后续预译", systemImage: "stop.circle") { reading.stop() }.frame(minHeight: 44)
                } else {
                    Button("准备本章与下一章的译文", systemImage: "character.book.closed") {
                        // Dependencies are owned by ReaderScreen, not by this settings view.
                        reading.requestPreparation?()
                    }.frame(minHeight: 44).disabled(reading.loading)
                }
                if reading.loading { ProgressView("正在更新译文").font(.footnote) }
                if let status = reading.status { Text(status).font(.footnote).foregroundStyle(.secondary) }
                if let error = reading.error { Text(error).font(.footnote).foregroundStyle(.secondary).textSelection(.enabled) }
            } else {
                Text("本机原件仍可阅读。将书同步到自己的账号后，可以准备译文。")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
        } header: { Text("AI 译文") } footer: {
            Text("只准备这两章，每次最多 100 段。在前台阅读时逐段更新；停止后，已提交的一段仍可能完成并计点。")
        }
        .alert("准备或恢复译文", isPresented: Binding(get: { reading.proposed != nil }, set: { if !$0 { reading.proposed = nil } }), presenting: reading.proposed) { run in
            Button("开始预译") { reading.confirmPreparation?(run) }
            Button("暂不", role: .cancel) { reading.proposed = nil }
        } message: { run in
            Text("本次范围：\(session.book.chapters.filter { run.plan.chapterIDs.contains($0.id) }.map(\.title).joined(separator: "、"))。还剩 \(max(0, run.plan.passageIDs.count - run.next)) 段。启用阅读点时费用最多 \(run.plan.maximumPoints) 点，每段提交前核对报价。上次未确认的请求会沿用原请求核对；已有双译不会重做。切回原著模式或进入后台后停止后续段落。")
        }
    }
}
