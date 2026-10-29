import SwiftUI
import Observation
import LeafhourCore

@MainActor @Observable
final class SavedReadingSummariesModel {
    private(set) var workspace: CloudJSON = .null
    private(set) var state: AccountRecordsState = .idle
    private var ownerID: String?
    private var requestID = UUID()

    func load(_ model: LibraryModel) async {
        let request = UUID(); requestID = request
        guard let account = model.account, let library = model.library else {
            ownerID = nil; workspace = .null; state = .idle; return
        }
        if ownerID != account.id { ownerID = account.id; workspace = .null; state = .idle }
        let previous = state, hadSnapshot = workspace != .null
        state = .loading
        do {
            let data = try await model.cloud.data(path: "/api/library/notebook-workspace", ownerID: account.id)
            try Task.checkCancellation()
            let value = try CloudJSON.decode(data)
            guard case .array = value["relations"], case .array = value["candidates"] else { throw LibraryError.invalid("返回的阅读摘要暂时无法读取。") }
            guard requestID == request, model.account?.id == account.id else { return }
            workspace = value; state = .ready
            do { try await library.cacheCloudView("workspace", data: data) }
            catch {
                if requestID == request && model.account?.id == account.id { state = .partial("最新摘要已读取，但此设备暂未保存离线副本。请联网时重试。") }
            }
        } catch {
            guard requestID == request, model.account?.id == account.id else { return }
            if Task.isCancelled || error is CancellationError { state = previous; return }
            if hadSnapshot { state = .cached("暂时无法更新，当前保留此前载入的摘要。\n" + error.localizedDescription) }
            else if let data = try? await library.cloudView("workspace"), let cached = try? CloudJSON.decode(data), case .array = cached["relations"], case .array = cached["candidates"] {
                guard requestID == request, model.account?.id == account.id else { return }
                workspace = cached; state = .cached("暂时无法更新，当前显示此账号此前保存的摘要。\n" + error.localizedDescription)
            } else {
                guard requestID == request, model.account?.id == account.id else { return }
                state = .failed("此设备没有可显示的离线摘要。读取失败不代表书房里没有保存的摘要。\n" + error.localizedDescription)
            }
        }
    }
}

/// Reads saved notebook results only. Opening this page never runs a model.
struct SavedReadingSummariesScreen: View {
    @Bindable var model: LibraryModel
    @State private var summaries = SavedReadingSummariesModel()
    var body: some View {
        List {
            AccountRecordsStatus(state: summaries.state, title: "阅读摘要") { Task { await summaries.load(model) } }
            let adopted = summaries.workspace["relations"].array
            let candidates = summaries.workspace["candidates"].array.filter { $0["status"].string == "candidate" }
            if adopted.isEmpty && candidates.isEmpty {
                if summaries.state == .ready {
                    ContentUnavailableView("还没有保存的阅读摘要", systemImage: "text.book.closed", description: Text("网页书房里已保存的整理结果会显示在这里。打开此页不会自动生成。"))
                } else if case .cached = summaries.state {
                    Text("这份已保存的离线副本中暂无摘要。联网后可重新核对。").font(.subheadline).foregroundStyle(.secondary)
                }
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
        }
        .navigationTitle("我的阅读摘要").navigationBarTitleDisplayMode(.inline)
        .task(id: model.account?.id) { await summaries.load(model) }
        .refreshable { await summaries.load(model) }
    }
    private func summary(_ value: CloudJSON) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(value["text"].string ?? "").textSelection(.enabled)
            Text("基于 \(value["noteKeys"].array.count) 条笔记的历史整理，请对照原笔记核对。")
                .font(.caption).foregroundStyle(.secondary)
        }.padding(.vertical, 6)
    }
}
