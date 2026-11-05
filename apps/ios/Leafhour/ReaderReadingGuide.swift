import SwiftUI
import Observation
import LeafhourCore

@MainActor @Observable
final class ReadingGuideController {
    private(set) var guide: ReadingGuide?
    private(set) var loading = false
    private(set) var message: String?
    private(set) var state = "missing"
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var ownerID: String?
    @ObservationIgnored private var book: LocalBook?
    @ObservationIgnored private var library: OfflineLibrary?
    @ObservationIgnored private var cloud: CloudLibraryClient?
    private let locale = "zh-Hans"

    func prepare(session: ReaderSession, library: OfflineLibrary?, cloud: CloudLibraryClient?) async {
        await prepare(book: session.book, library: library, cloud: cloud, action: "ensure")
    }
    func retry() async {
        guard let book else { return }
        await prepare(book: book, library: library, cloud: cloud, action: state == "failed" || state == "missing" ? "retry" : "view")
    }
    func cancel() { generation = UUID(); task?.cancel(); task = nil; loading = false }
    private func prepare(book: LocalBook, library: OfflineLibrary?, cloud: CloudLibraryClient?, action: String) async {
        if self.book?.id == book.id, self.book?.sourceVersion == book.sourceVersion, self.book?.cloud?.contentVersion == book.cloud?.contentVersion, loading, await cloud?.activeAccount()?.id == ownerID { await task?.value; return }
        cancel(); self.book = book; self.library = library; self.cloud = cloud
        guide = nil; message = nil; state = "missing"
        let marker = generation
        guard let cloud, let owner = await cloud.activeAccount()?.id else {
            message = "登录后会为这本书准备阅读前导，原书仍可继续阅读。"; return
        }
        guard marker == generation, book.cloud == nil || book.cloud?.ownerID == owner else { return }
        ownerID = owner
        let version = book.cloud?.contentVersion ?? book.sourceVersion, bookID = book.cloud?.bookID ?? book.id
        loading = true
        let job = Task { @MainActor [weak self] in
            guard let self else { return }
            defer { if generation == marker { loading = false; task = nil } }
            do {
                let cached = try await library?.readingGuideRecord(bookID: book.id, ownerID: owner, contentVersion: version, locale: locale)
                try Task.checkCancellation(); guard generation == marker, await cloud.activeAccount()?.id == owner else { return }
                if let saved = cached?.guide, saved.bookId == bookID, saved.sourceKind == (book.cloud == nil ? "local-device" : "cloud") { guide = saved; state = "ready"; return }
                var body: [String: CloudJSON] = ["bookId": .string(bookID), "contentVersion": .string(version), "locale": .string(locale), "sourceKind": .string(book.cloud == nil ? "local-device" : "cloud")]
                if book.cloud == nil {
                    let context = try await Task.detached(priority: .utility) { try ReadingGuideContext.make(book: book) }.value
                    body["context"] = try CloudJSON.decode(JSONEncoder().encode(context))
                }
                @MainActor func request(_ action: String) async throws -> CloudJSON {
                    try Task.checkCancellation()
                    guard self.generation == marker, await cloud.activeAccount()?.id == owner else { throw CancellationError() }
                    var payload = body; payload["action"] = .string(action)
                    return try CloudJSON.decode(await cloud.data(path: "/api/library/reading-guide", method: "POST", body: CloudJSON.encode(payload), ownerID: owner))
                }
                var response = try await request("view")
                let remoteState = response["state"].string ?? (response["guide"] == .null ? "unknown" : "ready")
                if (remoteState == "missing" && action != "view" && (cached?.attempted != true || action == "retry")) || (remoteState == "failed" && action == "retry") {
                    // Record intent before the network request. A cold reopen reads
                    // server state instead of replaying an uncertain submission.
                    try await library?.saveReadingGuideRecord(ReadingGuideRecord(ownerID: owner, contentVersion: version, locale: locale, attempted: true), bookID: book.id)
                    response = try await request(action)
                }
                for _ in 0..<35 {
                    try Task.checkCancellation(); guard generation == marker, await cloud.activeAccount()?.id == owner else { return }
                    state = response["state"].string ?? (response["guide"] == .null ? "unknown" : "ready")
                    if response["guide"] != .null {
                        let generated = try JSONDecoder().decode(ReadingGuide.self, from: JSONEncoder().encode(response["guide"]))
                        guard generated.isValid, generated.bookId == bookID, generated.contentVersion == version, generated.locale == locale,
                              generated.sourceKind == (book.cloud == nil ? "local-device" : "cloud") else { throw LibraryError.invalid("阅读前导的来源或版本无法核对。") }
                        try await library?.saveReadingGuideRecord(ReadingGuideRecord(ownerID: owner, contentVersion: version, locale: locale, guide: generated, attempted: true), bookID: book.id)
                        try Task.checkCancellation(); guard generation == marker, await cloud.activeAccount()?.id == owner else { return }
                        guide = generated; state = "ready"; return
                    }
                    guard state == "preparing" else { break }
                    try await Task.sleep(for: .seconds(2)); response = try await request("view")
                }
                message = state == "unknown" ? "前导结果待确认，没有重新生成。可以稍后查看，原书仍可继续阅读。" : state == "failed" ? "前导暂未准备好，可以重试；原书仍可继续阅读。" : "前导尚未准备好，可以稍后查看。"
            } catch is CancellationError { }
            catch {
                guard generation == marker, await cloud.activeAccount()?.id == owner else { return }
                state = "unknown"; message = "暂时无法读取前导。连接恢复后可以查看已有结果，没有重新生成。"
            }
        }
        task = job
        await withTaskCancellationHandler { await job.value } onCancel: { job.cancel() }
    }
}

/// Lives inside the existing marginal-note scroll view; never presents Chat.
struct ReaderReadingGuideContent: View {
    @Bindable var controller: ReadingGuideController
    var canSend = true
    var onFollowUp: ((ChatFollowUp) async -> Void)? = nil
    @State private var sending = false
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("阅读前导").font(.headline)
            if let guide = controller.guide {
                Text("AI · 开篇取样草稿").font(.caption).foregroundStyle(.secondary)
                Text(guide.opening).textSelection(.enabled)
                Text(guide.method).textSelection(.enabled)
                Text(guide.readingQuestion).textSelection(.enabled)
                Text("依据书目信息与开篇取样；背景不足处保留未知。\(guide.sourceKind == "local-device" ? "原件保留本机，取样由网络模型处理。" : "")")
                    .font(.caption).foregroundStyle(.secondary)
                ChatFollowUpButtons(items: guide.followUps, enabled: canSend && !sending && onFollowUp != nil) { item in
                    guard !sending else { return }; sending = true
                    Task { await onFollowUp?(item); sending = false }
                }
            } else if controller.loading { ProgressView("前导正在准备，你可以继续阅读…") }
            else {
                Text(controller.message ?? "前导尚未准备好，原书仍可继续阅读。").font(.subheadline).foregroundStyle(.secondary)
                Button(controller.state == "failed" || controller.state == "missing" ? "重试准备前导" : "查看已有结果") { Task { await controller.retry() } }.frame(minHeight: 44)
                    .accessibilityIdentifier("reader-reading-guide-retry")
            }
        }.frame(maxWidth: .infinity, alignment: .leading).accessibilityElement(children: .contain)
            .accessibilityIdentifier("reader-reading-guide-content")
    }
}

struct ChatFollowUpButtons: View {
    let items: [ChatFollowUp]
    let enabled: Bool
    let onSend: (ChatFollowUp) -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(items) { item in
                Button { onSend(item) } label: {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(item.text).font(.subheadline).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 4)
                        Image(systemName: "arrow.up.right").font(.caption)
                    }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading).contentShape(Rectangle())
                }.buttonStyle(.plain).foregroundStyle(Color.leafInk).disabled(!enabled)
                    .accessibilityHint("点按直接发送这个问题").accessibilityIdentifier("chat-follow-up-" + item.id)
            }
        }.accessibilityElement(children: .contain)
    }
}
