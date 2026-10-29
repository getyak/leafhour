import SwiftUI
import LeafhourCore

/// Reads saved notebook results only. Opening this page never runs a model.
struct SavedReadingSummariesScreen: View {
    @Bindable var model: LibraryModel
    @State private var workspace: CloudJSON = .null
    @State private var loading = false
    @State private var message: String?
    var body: some View {
        List {
            if loading { ProgressView("正在读取已保存的摘要…") }
            let adopted = workspace["relations"].array
            let candidates = workspace["candidates"].array.filter { $0["status"].string == "candidate" }
            if !loading && adopted.isEmpty && candidates.isEmpty {
                ContentUnavailableView("还没有保存的阅读摘要", systemImage: "text.book.closed", description: Text("网页书房里已保存的整理结果会显示在这里。打开此页不会自动生成。"))
            }
            if !adopted.isEmpty {
                Section("已采纳的整理 · AI 辅助") {
                    ForEach(Array(adopted.enumerated()), id: \.offset) { _, item in summary(item) }
                }
            }
            ForEach(Array(candidates.enumerated()), id: \.offset) { _, candidate in
                Section("待核对的整理 · AI 草稿") {
                    ForEach(Array(candidate["items"].array.enumerated()), id: \.offset) { _, item in summary(item) }
                }
            }
            if let message { Text(message).font(.footnote).foregroundStyle(.secondary) }
        }
        .navigationTitle("我的阅读摘要").navigationBarTitleDisplayMode(.inline)
        .task(id: model.account?.id) { await load() }
        .refreshable { await load() }
    }
    private func summary(_ value: CloudJSON) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(value["text"].string ?? "").textSelection(.enabled)
            Text("基于 \(value["noteKeys"].array.count) 条笔记的历史整理，请对照原笔记核对。")
                .font(.caption).foregroundStyle(.secondary)
        }.padding(.vertical, 6)
    }
    private func load() async {
        workspace = .null; message = nil
        guard let account = model.account, let library = model.library else { return }
        loading = true
        defer { if model.account?.id == account.id { loading = false } }
        do {
            let data = try await model.cloud.data(path: "/api/library/notebook-workspace", ownerID: account.id)
            try Task.checkCancellation()
            guard model.account?.id == account.id else { return }
            workspace = try CloudJSON.decode(data)
            try await library.cacheCloudView("workspace", data: data)
        } catch {
            guard model.account?.id == account.id else { return }
            workspace = (try? await library.cloudView("workspace")).flatMap { try? CloudJSON.decode($0) } ?? .null
            message = "暂时无法更新，已保留此账号上次保存的摘要。"
        }
    }
}
