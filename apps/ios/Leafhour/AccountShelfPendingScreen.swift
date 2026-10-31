import SwiftUI
import LeafhourCore

struct AccountShelfPendingScreen: View {
    @Bindable var model: LibraryModel
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("书架调整先保存在此设备。另一台设备已经调整过书架时，请选择重新应用或放弃这次调整。原件、笔记和草稿始终保留。").font(.footnote).foregroundStyle(.secondary)
                }
                if model.accountActions.isEmpty { Text("没有待同步的书架调整") }
                ForEach(model.accountActions) { pending in
                    Section {
                        Text(bookTitle(pending)).font(.headline)
                        Text(actionTitle(pending.action))
                        Text(pending.conflict ? "书架已在另一处更新" : "待同步").font(.caption).foregroundStyle(.secondary)
                        if let error = pending.error { Text(error).font(.footnote).foregroundStyle(.secondary) }
                        Button(pending.conflict ? "按最新书架重新应用" : "重试同步") { Task { await model.retryAccountShelf(pending) } }.disabled(model.syncing)
                        Button("放弃这次调整", role: .destructive) { Task { await model.discardAccountShelf(pending) } }.disabled(model.syncing)
                    }
                }
            }
            .navigationTitle("待同步调整")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } } }
        }
    }
    private func bookTitle(_ pending: PendingAccountShelfAction) -> String {
        (model.cloudBooks + (model.accountShelf?.archivedBooks ?? [])).first { $0.id == pending.action.bookID }?.title ?? "书架中的书籍"
    }
    private func actionTitle(_ action: AccountShelfAction) -> String {
        switch action { case .pin(_, let pinned): pinned ? "置顶" : "取消置顶"; case .archive: "从书架移除"; case .restore: "恢复到书架"; case .mark(_, _, let finished): finished ? "标为已读完" : "重新阅读" }
    }
}
