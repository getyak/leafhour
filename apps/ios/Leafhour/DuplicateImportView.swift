import SwiftUI
import LeafhourCore

@MainActor
struct DuplicateImportRequest {
    let title: String
    let completion: (DuplicateImportPolicy?) -> Void
}

extension View {
    func duplicateImportPrompt(_ model: LibraryModel) -> some View {
        confirmationDialog("这本书已在书房中", isPresented: Binding(get: { model.duplicateRequest != nil }, set: { if !$0 { model.resolveDuplicate(nil) } }), titleVisibility: .visible) {
            Button("保留原书") { model.resolveDuplicate(.keep) }
            Button("替换书籍") { model.resolveDuplicate(.replace) }
            Button("作为新书添加") { model.resolveDuplicate(.new) }
            Button("取消", role: .cancel) { model.resolveDuplicate(nil) }
        } message: {
            Text("“\(model.duplicateRequest?.title ?? "此书")”的原件相同。替换会保留笔记和阅读位置；新书拥有独立的空白阅读记录。")
        }
    }
}
