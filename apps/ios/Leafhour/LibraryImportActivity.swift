import SwiftUI
import LeafhourCore

/// Progress has its own observation scope so chapter updates do not rebuild the shelf.
@MainActor @Observable
final class LibraryImportActivity {
    let filename: String
    var title: String
    private(set) var isRunning = true
    private(set) var bookID: String?
    private(set) var status = "正在保留原件…"
    private(set) var fraction: Double?
    private var lastUpdate = Date.distantPast
    private var completed = 0
    private var stage: ImportProgress.Stage = .retaining

    init(filename: String) { self.filename = filename; title = filename }
    func receive(_ update: ImportProgress) {
        guard isRunning else { return }
        guard update.stage.rawValue >= stage.rawValue, update.stage != stage || update.completed >= completed else { return }
        let now = Date()
        guard update.stage != stage || update.completed == update.total || now.timeIntervalSince(lastUpdate) >= 0.2 else { return }
        lastUpdate = now; stage = update.stage; completed = update.completed
        fraction = update.total > 0 ? Double(update.completed) / Double(update.total) : nil
        switch update.stage {
        case .retaining: status = "正在保留原件…"
        case .extracting:
            status = update.total > 0 ? "正在整理正文 · \(update.completed) / \(update.total)" : "正在提取书名与正文…"
        case .verifying: status = "正在校验并保存，马上就好…"
        }
    }
    func showStatus(_ text: String) {
        guard isRunning else { return }
        status = text; fraction = nil
    }
    /// Reading availability is independent of the upload's completion state.
    func allowReading(_ book: LocalBook) { bookID = book.id; title = book.title }
    func finish(book: LocalBook) {
        isRunning = false; bookID = book.id; title = book.title; fraction = nil
        status = "已加入此设备，可以开始阅读"
    }
    func stop(cancelled: Bool, message: String) {
        isRunning = false; fraction = nil
        status = cancelled ? "已取消，可从保留的原件重试" : message
    }
}

struct LibraryImportActivityView: View {
    let activity: LibraryImportActivity
    let canCancel: Bool
    let cancel: () -> Void
    let dismiss: () -> Void
    let open: (String) -> Void

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: activity.isRunning ? "book.closed" : activity.bookID != nil ? "checkmark.circle" : "exclamationmark.circle")
                .foregroundStyle(Color.leafInk).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(activity.title).font(.subheadline).lineLimit(1)
                Text(activity.status).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                if activity.isRunning {
                    if let fraction = activity.fraction { ProgressView(value: fraction).accessibilityLabel("正文整理进度") }
                    else { ProgressView().controlSize(.mini).accessibilityLabel(activity.status) }
                }
            }.frame(maxWidth: .infinity, alignment: .leading)
            if let id = activity.bookID {
                Button("阅读") { open(id) }.font(.footnote).frame(minWidth: 44, minHeight: 44)
                    .accessibilityIdentifier("library-import-open")
            }
            if activity.isRunning && canCancel {
                Button("取消", action: cancel).font(.footnote).frame(minWidth: 44, minHeight: 44)
                    .accessibilityIdentifier("library-import-cancel")
            } else if !activity.isRunning {
                Button(action: dismiss) { Image(systemName: "xmark").frame(width: 44, height: 44) }
                    .accessibilityLabel("收起导入状态")
            }
        }
        .padding(.leading, 20).padding(.trailing, 8).padding(.vertical, 8)
        .background(Color.shelfPaper)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("library-import-activity")
    }
}
