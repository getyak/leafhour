import SwiftUI
import UIKit

struct ChatShareMessage: Identifiable, Equatable {
    let turnID: String
    let role: String
    let text: String
    var id: String { turnID + ":" + role }
    var author: String { role == "user" ? "我" : "松鼠 · AI" }
    var attributedText: String { author + "\n" + text }
    func contextExcerpt(fromEnd: Bool) -> String {
        let clipped = text.count > 180
        let excerpt = fromEnd ? String(text.suffix(180)) : String(text.prefix(180))
        return author + "\n" + (clipped && fromEnd ? "…" : "") + excerpt + (clipped && !fromEnd ? "…" : "")
    }
    static func ordered(_ turns: [ReaderConversationTurn]) -> [ChatShareMessage] {
        turns.flatMap { turn in
            var rows: [ChatShareMessage] = turn.question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? [] : [ChatShareMessage(turnID: turn.id, role: "user", text: turn.question)]
            if turn.status == "completed", let answer = turn.answer, !answer.isEmpty { rows.append(ChatShareMessage(turnID: turn.id, role: "assistant", text: answer)) }
            return rows
        }
    }
}
struct ChatShareSelection: Identifiable {
    let id = UUID()
    let title: String
    let messages: [ChatShareMessage]
    var before: String?
    var after: String?
    var text: String { messages.map(\.attributedText).joined(separator: "\n\n") }
}

/// The preview owns the exact selected content. Adjacent private messages are
/// included only after the reader explicitly enables them in this sheet.
struct ChatSharePanel: View {
    let selection: ChatShareSelection
    @Environment(\.dismiss) private var dismiss
    @State private var style: NativeShareCardStyle = .paper
    @State private var includeContext = false
    @State private var page: NativeShareCardPage?
    @State private var error: String?
    @State private var activity: NativeActivityItems?
    private var hasContext: Bool { selection.before != nil || selection.after != nil }
    private var content: NativeShareContent {
        var value = NativeShareContent(title: selection.title, author: "", text: selection.text, attribution: "阅读对话 · 由用户选取", location: "", url: URL(string: "https://leafhour.com"))
        if includeContext { value.contextBefore = selection.before; value.contextAfter = selection.after }
        return value
    }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if let error { Text(error).font(.footnote).foregroundStyle(.secondary) }
                    Picker("卡片风格", selection: $style) { ForEach(NativeShareCardStyle.allCases) { Text($0.title).tag($0) } }.pickerStyle(.segmented).accessibilityIdentifier("chat-share-style")
                    if hasContext {
                        Toggle("加入相邻消息片段", isOn: $includeContext).accessibilityIdentifier("chat-share-context")
                        Text("相邻内容会出现在分享图中，以柔焦背景突出所选消息。关闭后只分享选中的内容。").font(.footnote).foregroundStyle(.secondary)
                        if includeContext {
                            if let before = selection.before { contextPreview("前一条", before) }
                            if let after = selection.after { contextPreview("后一条", after) }
                        }
                    }
                    if let page { Image(uiImage: page.image).resizable().scaledToFit().clipShape(RoundedRectangle(cornerRadius: 18)).accessibilityLabel("所选对话分享长图预览").accessibilityIdentifier("chat-share-preview") }
                    DisclosureGroup("查看完整文字与归属") {
                        Text(content.plainText).font(.subheadline).textSelection(.enabled).padding(.top, 8)
                    }
                    Text("只包含预览中的内容。分享不会公开整段对话。AI 内容保留独立归属。").font(.footnote).foregroundStyle(.secondary)
                    Button { activity = NativeActivityItems(values: [content.plainText]) } label: { Label("分享完整文字", systemImage: "text.alignleft").frame(minHeight: 44) }
                }.padding(24)
            }.background(Color.shelfPaper)
                .safeAreaInset(edge: .bottom) {
                    Button { if let page { activity = NativeActivityItems(values: [page.image]) } } label: {
                        Label("分享长图", systemImage: "square.and.arrow.up").frame(maxWidth: .infinity).frame(minHeight: 48)
                    }.buttonStyle(.borderedProminent).tint(.leafInk).disabled(page == nil).accessibilityIdentifier("chat-share-long-image").padding(.horizontal, 24).padding(.vertical, 12).background(.bar)
                }
                .navigationTitle("分享对话").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("完成") { dismiss() } } }
                .task(id: style.rawValue + String(includeContext)) { render() }
                .sheet(item: $activity) { value in NativeActivitySheet(selection: value) { _, failure in if failure != nil { error = "分享暂未完成，内容仍保留，可以重试。" } } }
        }
    }
    private func contextPreview(_ title: String, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 6) { Text(title).font(.caption); Text(text).font(.subheadline).textSelection(.enabled) }.foregroundStyle(.secondary)
    }
    private func render() {
        do { page = try NativeShareCardRenderer.pages(content, format: .portrait, style: style).first; error = nil }
        catch { page = nil; self.error = error.localizedDescription }
    }
}
