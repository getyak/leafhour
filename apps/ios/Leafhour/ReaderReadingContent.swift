import Foundation
import Observation
import LeafhourCore

struct ReaderTranslationRun: Codable {
    var plan: ReadingTranslationPlan
    var next = 0
    var pending: ReaderGenerationConsent?
    var completed: [CloudJSON] = []
}

/// One foreground, explicitly confirmed budget. Navigation never expands it.
@MainActor @Observable
final class ReaderReadingContent {
    var loading = false
    var running = false
    var status: String?
    var error: String?
    var proposed: ReaderTranslationRun?
    @ObservationIgnored var requestPreparation: (() -> Void)?
    @ObservationIgnored var confirmPreparation: ((ReaderTranslationRun) -> Void)?
    private var task: Task<Void, Never>?
    private var refreshID = UUID()
    private var activeChapterIDs: [String] = []
    private var foreground = true

    func refresh(_ session: ReaderSession, cloud: CloudLibraryClient?, library: OfflineLibrary?) async {
        let marker = UUID(); refreshID = marker
        if let library, let cached = try? await library.readingTranslations(bookID: session.book.id) {
            guard !Task.isCancelled, marker == refreshID else { return }
            session.updateTranslations(cached)
            if let data = try? await library.pendingReadingTranslation(bookID: session.book.id),
               let saved = try? JSONDecoder().decode(ReaderTranslationRun.self, from: data),
               (try? Self.validate(saved, session: session)) != nil {
                session.updateTranslations(Self.translations(saved.completed))
            }
        }
        guard session.state.preferences.viewMode != .source, let identity = session.book.cloud, let cloud else { return }
        loading = true; error = nil
        defer { if refreshID == marker { loading = false } }
        do {
            for chapter in session.book.chapters.dropFirst(session.chapterIndex).prefix(2) {
                let value = try await cloud.readingChapter(bookID: identity.bookID, chapterID: chapter.id, contentVersion: identity.contentVersion, ownerID: identity.ownerID)
                try Task.checkCancellation()
                guard marker == refreshID else { return }
                let rows = try Self.validatedRows(value, chapter: chapter, identity: identity)
                session.updateTranslations(Self.translations(rows))
                if let library, !running { try await library.cacheCloudPassages(rows.filter { !$0["translations"].object.isEmpty }, bookID: session.book.id) }
            }
        } catch is CancellationError { }
        catch { if marker == refreshID { self.error = "暂时无法更新译文，已保留原文与此设备上的译文。\n" + error.localizedDescription } }
    }

    static func validatedRows(_ value: CloudJSON, chapter: BookChapter, identity: CloudBookIdentity) throws -> [CloudJSON] {
        guard value["bookId"].string == identity.bookID, value["contentVersion"].string == identity.contentVersion,
              value["chapterId"].string == chapter.id else { throw LibraryError.invalid("章节版本已变化，请重新同步书房。") }
        let source = Dictionary(uniqueKeysWithValues: chapter.passages.map { ($0.id, $0.text) })
        let rows = value["sections"].array.flatMap { $0["paragraphs"].array }
        var ids = Set<String>()
        for row in rows {
            guard let id = row["id"].string, ids.insert(id).inserted, source[id] == row["original"].string else { throw LibraryError.invalid("译文无法对应这份原文，尚未显示。") }
        }
        guard ids == Set(source.keys) else { throw LibraryError.invalid("章节尚未完整返回，已保留本机内容。") }
        return rows
    }
    static func translations(_ rows: [CloudJSON]) -> [String: ReadingTranslation] {
        var result: [String: ReadingTranslation] = [:]
        for row in rows { if let id = row["id"].string, let translation = ReadingTranslation(row) { result[id] = translation } }
        return result
    }

    func prepare(_ session: ReaderSession, cloud: CloudLibraryClient?, library: OfflineLibrary?) async {
        guard !running, !loading, let identity = session.book.cloud, let cloud, let library else { error = "请先登录并同步这本书，再准备译文。"; return }
        error = nil; loading = true
        defer { loading = false }
        do {
            guard await cloud.activeAccount()?.id == identity.ownerID else { throw LibraryError.invalid("账号已变化，请重新打开书房。") }
            if let data = try await library.pendingReadingTranslation(bookID: session.book.id) {
                let saved = try JSONDecoder().decode(ReaderTranslationRun.self, from: data)
                try Self.validate(saved, session: session)
                if saved.plan.chapterIDs.contains(session.chapter.id) || saved.pending != nil {
                    proposed = saved; return
                }
                // A new explicit request replaces only unsubmitted work. Preserve
                // completed results; an uncertain request always goes through recovery.
                try await library.cacheCloudPassages(saved.completed, bookID: session.book.id)
                session.updateTranslations(Self.translations(saved.completed))
                try await library.savePendingReadingTranslation(nil, bookID: session.book.id)
            }
            let plan = try ReadingTranslationPlan.make(book: session.book, chapterIndex: session.chapterIndex, translations: session.translations)
            guard !plan.passageIDs.isEmpty else { status = "当前章与下一章的双译已准备好。"; return }
            proposed = ReaderTranslationRun(plan: plan)
        } catch { self.error = error.localizedDescription }
    }
    static func validate(_ run: ReaderTranslationRun, session: ReaderSession) throws {
        guard let identity = session.book.cloud, run.plan.ownerID == identity.ownerID, run.plan.bookID == identity.bookID,
              run.plan.contentVersion == identity.contentVersion, (0...run.plan.passageIDs.count).contains(run.next),
              run.plan.passageIDs.count <= 100, (1...2).contains(run.plan.chapterIDs.count),
              let start = session.book.chapters.firstIndex(where: { $0.id == run.plan.chapterIDs.first }),
              Array(session.book.chapters.dropFirst(start).prefix(run.plan.chapterIDs.count)).map(\.id) == run.plan.chapterIDs else {
            throw LibraryError.invalid("预译恢复记录与这本书不一致，尚未提交。")
        }
        let ids = Set(session.book.chapters.filter { run.plan.chapterIDs.contains($0.id) }.flatMap(\.passages).map(\.id))
        guard Set(run.plan.passageIDs).count == run.plan.passageIDs.count, Set(run.plan.passageIDs).isSubset(of: ids),
              run.completed.allSatisfy({ ids.contains($0["id"].string ?? "") }) else { throw LibraryError.invalid("预译范围无法核对。") }
        if let pending = run.pending {
            guard run.next < run.plan.passageIDs.count, pending.ownerID == identity.ownerID,
                  pending.passageID == run.plan.passageIDs[run.next], pending.action == "translation",
                  pending.path == "/api/library/books/" + CloudJSON.component(identity.bookID) + "/translate",
                  let body = try? CloudJSON.decode(pending.body), body["id"].string == pending.id,
                  body["passageId"].string == pending.passageID, body["contentVersion"].string == identity.contentVersion else { throw LibraryError.invalid("未完成的预译请求无法核对，尚未重试。") }
        }
    }
    func confirm(_ run: ReaderTranslationRun, session: ReaderSession, cloud: CloudLibraryClient?, library: OfflineLibrary?) {
        guard !running, foreground, session.state.preferences.viewMode != .source, let cloud, let library else { return }
        proposed = nil; running = true; error = nil; activeChapterIDs = run.plan.chapterIDs
        task = Task { await execute(run, session: session, cloud: cloud, library: library) }
    }
    func stop() { task?.cancel() }
    func setForeground(_ active: Bool) { foreground = active; if !active { stop() } }
    func enteredChapter(_ id: String) { if running && !activeChapterIDs.contains(id) { stop() } }

    private func execute(_ saved: ReaderTranslationRun, session: ReaderSession, cloud: CloudLibraryClient, library: OfflineLibrary) async {
        var run = saved
        let worker = ReaderCloudTools()
        defer { running = false; task = nil }
        func persist() async throws { try await library.savePendingReadingTranslation(JSONEncoder().encode(run), bookID: session.book.id) }
        func flush() async throws {
            guard !run.completed.isEmpty else { return }
            try await library.cacheCloudPassages(run.completed, bookID: session.book.id)
            run.completed = []; try await persist()
        }
        do {
            try Self.validate(run, session: session)
            try await persist()
            session.updateTranslations(Self.translations(run.completed))
            try await flush()
            while run.next < run.plan.passageIDs.count {
                try Task.checkCancellation()
                guard foreground, session.state.preferences.viewMode != .source, (run.plan.chapterIDs.contains(session.chapter.id) || run.pending != nil),
                      await cloud.activeAccount()?.id == run.plan.ownerID else { throw CancellationError() }
                let id = run.plan.passageIDs[run.next]
                guard let chapter = session.book.chapters.first(where: { $0.passages.contains { $0.id == id } }),
                      let passage = chapter.passages.first(where: { $0.id == id }) else { throw LibraryError.invalid("原文段落已变化，预译已停止。") }
                if run.pending == nil {
                    // Refresh may have brought a complete result from another device.
                    if let existing = session.translations[id], existing.original == passage.text,
                       existing.text(.literal) != nil, existing.text(.interpretive) != nil {
                        run.next += 1; try await persist(); continue
                    }
                    await worker.prepare("translation", session: session, cloud: cloud,
                        selection: SelectedQuote(anchor: ReadingAnchor(chapterID: chapter.id, passageID: id), text: passage.text))
                    try Task.checkCancellation()
                    guard let intent = worker.consent else { throw LibraryError.invalid(worker.error ?? "预译暂时无法开始。") }
                    run.pending = intent
                    try await persist() // Durable idempotency key before the first submission.
                }
                try Task.checkCancellation()
                guard let intent = run.pending else { break }
                status = "正在准备译文 · \(run.next + 1)/\(run.plan.passageIDs.count)"
                await worker.perform(intent, cloud: cloud)
                guard let result = worker.completedTranslation else {
                    // Only a scoped terminal billing receipt can retire a durable
                    // request. Authentication/rate-limit failures during recovery say
                    // nothing about whether an earlier submission executed.
                    if worker.generationTerminalStatus != nil && !Task.isCancelled { run.pending = nil; try await persist() }
                    throw LibraryError.invalid(worker.error ?? "已停止后续预译；当前请求的结果仍可恢复核对。")
                }
                guard result["id"].string == id, result["original"].string == passage.text,
                      let translated = ReadingTranslation(result), translated.text(.literal) != nil, translated.text(.interpretive) != nil else {
                    throw LibraryError.invalid("译文结果无法对应原文，已保留请求供核对。")
                }
                run.completed.append(result); run.pending = nil; run.next += 1
                try await persist() // Completed results survive even before a cache batch flush.
                session.updateTranslations([id: translated])
                if run.completed.count >= 4 { try await flush() }
                if !run.plan.chapterIDs.contains(session.chapter.id) {
                    try await flush()
                    try await library.savePendingReadingTranslation(nil, bookID: session.book.id)
                    status = "上次请求已核对，可以准备当前章与下一章。"
                    return
                }
            }
            try await flush()
            try await library.savePendingReadingTranslation(nil, bookID: session.book.id)
            status = "本次译文已准备好。"
        } catch {
            // Do not cancel an already submitted server task or create another key.
            // The saved envelope owns both uncertain and completed work.
            try? await flush()
            status = Task.isCancelled ? "已停止后续预译，已提交的一段仍可能完成。" : nil
            if !Task.isCancelled { self.error = error.localizedDescription }
        }
    }
}
