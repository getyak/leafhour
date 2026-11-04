import SwiftUI
import Observation
import LeafhourCore

@MainActor @Observable
final class ReadingGuideController {
    private(set) var guide: ReadingGuide?
    private(set) var loading = false
    private(set) var message: String?
    private(set) var dismissed = false
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var book: LocalBook?
    @ObservationIgnored private var library: OfflineLibrary?
    @ObservationIgnored private var cloud: CloudLibraryClient?
    @ObservationIgnored private var record: ReadingGuideRecord?
    private let locale = "zh-Hans"

    func prepare(session: ReaderSession, library: OfflineLibrary?, cloud: CloudLibraryClient?) async {
        await prepare(book: session.book, library: library, cloud: cloud, force: false)
    }
    func retry() async {
        guard let book else { return }
        await prepare(book: book, library: library, cloud: cloud, force: true)
    }
    func cancel() { generation = UUID(); task?.cancel(); task = nil; loading = false }
    func dismiss() {
        dismissed = true
        if var record, let book, let library {
            record.dismissed = true; self.record = record
            Task { try? await library.saveReadingGuideRecord(record, bookID: book.id) }
        }
    }
    private func prepare(book: LocalBook, library: OfflineLibrary?, cloud: CloudLibraryClient?, force: Bool) async {
        if !force, self.book?.id == book.id, self.book?.sourceVersion == book.sourceVersion, loading { await task?.value; return }
        let retainedDismissal = self.book?.id == book.id && self.book?.sourceVersion == book.sourceVersion && dismissed
        cancel(); self.book = book; self.library = library; self.cloud = cloud
        guide = nil; message = nil; dismissed = retainedDismissal; record = nil
        let marker = generation
        guard let cloud, let owner = await cloud.activeAccount()?.id else {
            message = "可以先读开头，留意作者反复使用的词。登录后会为这本书准备 AI 阅读前导。"; return
        }
        guard marker == generation, book.cloud == nil || book.cloud?.ownerID == owner else { return }
        let version = book.cloud?.contentVersion ?? book.sourceVersion, bookID = book.cloud?.bookID ?? book.id
        loading = true
        let job = Task { @MainActor [weak self] in
            guard let self else { return }
            defer { if generation == marker { loading = false; task = nil } }
            do {
                let cached = try await library?.readingGuideRecord(bookID: book.id, ownerID: owner, contentVersion: version, locale: locale)
                try Task.checkCancellation(); guard generation == marker, await cloud.activeAccount()?.id == owner else { return }
                dismissed = dismissed || (cached?.dismissed ?? false)
                record = cached ?? ReadingGuideRecord(ownerID: owner, contentVersion: version, locale: locale, dismissed: dismissed)
                record?.dismissed = dismissed
                if let record, cached != nil, cached?.dismissed != dismissed { try await library?.saveReadingGuideRecord(record, bookID: book.id) }
                if let saved = cached?.guide, saved.bookId == bookID { guide = saved; return }
                if cached?.attempted == true && !force { message = "前导尚未准备好，可以重试；原书仍可继续阅读。"; return }
                var body: [String: CloudJSON] = ["bookId": .string(bookID), "contentVersion": .string(version), "locale": .string(locale), "sourceKind": .string(book.cloud == nil ? "local-device" : "cloud")]
                if book.cloud == nil {
                    let context = try await Task.detached(priority: .utility) { try ReadingGuideContext.make(book: book) }.value
                    body["context"] = try CloudJSON.decode(JSONEncoder().encode(context))
                }
                try Task.checkCancellation(); guard generation == marker else { return }
                let response = try CloudJSON.decode(await cloud.data(path: "/api/library/reading-guide", method: "POST", body: CloudJSON.encode(body), ownerID: owner))
                let generated = try JSONDecoder().decode(ReadingGuide.self, from: JSONEncoder().encode(response["guide"]))
                try Task.checkCancellation(); guard generation == marker, await cloud.activeAccount()?.id == owner else { return }
                guard generated.isValid, generated.bookId == bookID, generated.contentVersion == version,
                      generated.locale == locale, generated.sourceKind == (book.cloud == nil ? "local-device" : "cloud") else { throw LibraryError.invalid("阅读前导的来源或版本无法核对。") }
                var saved = record ?? ReadingGuideRecord(ownerID: owner, contentVersion: version, locale: locale)
                saved.guide = generated; saved.attempted = true
                try await library?.saveReadingGuideRecord(saved, bookID: book.id)
                try Task.checkCancellation(); guard generation == marker else { return }
                record = saved; guide = generated
            } catch is CancellationError { }
            catch {
                guard generation == marker, await cloud.activeAccount()?.id == owner else { return }
                message = error.localizedDescription
                if var saved = record { saved.attempted = true; record = saved; try? await library?.saveReadingGuideRecord(saved, bookID: book.id) }
            }
        }
        task = job
        await withTaskCancellationHandler { await job.value } onCancel: { job.cancel() }
    }
}

struct ReaderReadingGuideCompact: View {
    @Bindable var controller: ReadingGuideController
    let onOpen: () -> Void
    var body: some View {
        if !controller.dismissed {
            HStack(spacing: 8) {
                Button(action: onOpen) {
                    HStack(spacing: 8) {
                        Image(systemName: "leaf")
                        VStack(alignment: .leading, spacing: 3) {
                            Text("阅读前导").font(.subheadline)
                            Text(controller.guide?.opening ?? (controller.loading ? "先开始读，前导正在准备" : "阅读方法与开篇问题"))
                                .font(.caption).foregroundStyle(.secondary).lineLimit(2)
                        }
                        Spacer(minLength: 0)
                        if controller.loading { ProgressView().controlSize(.mini) }
                        else { Image(systemName: "chevron.right").font(.caption) }
                    }.frame(minHeight: 44).contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityIdentifier("reader-reading-guide-open")
                Button { controller.dismiss() } label: { Image(systemName: "xmark").font(.caption).frame(width: 44, height: 44).contentShape(Rectangle()) }
                    .buttonStyle(.plain).accessibilityLabel("收起阅读前导").accessibilityIdentifier("reader-reading-guide-dismiss")
            }.padding(.horizontal, 12).padding(.vertical, 6).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
                .accessibilityElement(children: .contain)
        }
    }
}

struct ReaderReadingGuidePanel: View {
    @Bindable var controller: ReadingGuideController
    var canSend = true
    var onFollowUp: ((ChatFollowUp) async -> Void)? = nil
    @State private var sending = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let guide = controller.guide {
                    Text("AI 阅读前导 · 开篇取样草稿").font(.caption).foregroundStyle(.secondary)
                    Text(guide.opening).textSelection(.enabled)
                    VStack(alignment: .leading, spacing: 8) { Text("怎么读").font(.headline); Text(guide.method).textSelection(.enabled) }
                    VStack(alignment: .leading, spacing: 8) { Text("带着一个问题").font(.headline); Text(guide.readingQuestion).textSelection(.enabled) }
                    Text("依据书目、目录与开篇 \(guide.sampleRanges.count) 段取样；后文尚未核对。\(guide.sourceKind == "local-device" ? "原件保留本机，取样由网络模型处理。" : "")")
                        .font(.caption).foregroundStyle(.secondary)
                    DisclosureGroup("查看取样与版本") {
                        Text(guide.contentVersion).font(.caption2).textSelection(.enabled)
                        ForEach(Array(guide.sampleRanges.enumerated()), id: \.offset) { _, range in
                            Text("\(range.chapterId) · \(range.passageId) · \(range.charOffset)–\(range.charEnd)").font(.caption2).textSelection(.enabled)
                        }
                    }.font(.caption)
                    ChatFollowUpButtons(items: guide.followUps, enabled: canSend && !sending && onFollowUp != nil) { item in
                        guard !sending else { return }; sending = true
                        Task { await onFollowUp?(item); sending = false }
                    }
                } else if controller.loading { ProgressView("前导正在准备，你可以继续阅读…") }
                else {
                    Text(controller.message ?? "先读开篇，留意作者反复使用的词。AI 前导暂未准备好。").foregroundStyle(.secondary)
                    Button("重试准备阅读前导") { Task { await controller.retry() } }.frame(minHeight: 44)
                }
            }.padding(20).frame(maxWidth: 680, alignment: .leading).frame(maxWidth: .infinity)
        }.navigationTitle("阅读前导").navigationBarTitleDisplayMode(.inline).accessibilityIdentifier("reader-reading-guide-panel")
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
