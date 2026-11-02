import SwiftUI
import LeafhourCore

enum JournalScope: String, CaseIterable, Identifiable {
    case account, device
    var id: Self { self }
    var title: String { self == .account ? "账号书房" : "此设备" }
}

@MainActor @Observable final class ReadingJournalModel {
    private(set) var months: [String: CloudJSON] = [:]
    private(set) var state: AccountRecordsState = .idle
    private(set) var localNotes: [ReadingJournal.Note] = []
    private(set) var localBooks: [LocalBook] = []
    private(set) var intervals: [ReadingJournal.Interval] = []
    private var hasDeviceSnapshot = false
    private var availableTimeBooks: Set<String> = []
    private(set) var hasCompleteDeviceNotes = false
    private var context: UUID?
    private var scope: JournalScope?
    private var request = UUID()
    private(set) var calendar = Calendar.current

    func load(_ model: LibraryModel, scope: JournalScope, month: Date, recent: Bool, refresh: Bool = false) async {
        let marker = model.importAccountContext, request = UUID()
        if context != marker || self.scope != scope || calendar.timeZone.identifier != TimeZone.current.identifier {
            months = [:]; localNotes = []; localBooks = []; intervals = []; state = .idle; hasDeviceSnapshot = false; availableTimeBooks = []; hasCompleteDeviceNotes = false
            context = marker; self.scope = scope
        }
        self.request = request
        calendar = Calendar(identifier: .gregorian); calendar.timeZone = .current
        let previous = state
        state = .loading
        guard let library = model.library else { state = .failed("书房尚未打开，请稍后重试。"); return }
        func current() -> Bool { self.request == request && model.importAccountContext == marker && !Task.isCancelled }
        if scope == .device {
            do {
                let books = try await library.books()
                var notes: [ReadingJournal.Note] = [], rows: [ReadingJournal.Interval] = [], failed = 0
                var available = Set<String>(), missingTime = false, missingNotes = false
                for book in books {
                    guard current() else { return }
                    do { notes += ReadingJournal.localNotes(book: book, state: try await library.state(book.id)) } catch { failed += 1; missingNotes = true; notes += localNotes.filter { $0.bookID == book.id } }
                    do {
                        for snapshot in try await library.readingTimeLedger(bookID: book.id).snapshots {
                            rows += snapshot.segments.map { ReadingJournal.Interval(bookID: book.id, start: $0.startedAt, end: $0.endedAt) }
                        }
                        available.insert(book.id)
                    } catch {
                        failed += 1; rows += intervals.filter { $0.bookID == book.id }
                        if availableTimeBooks.contains(book.id) { available.insert(book.id) } else { missingTime = true }
                    }
                }
                guard current() else { return }
                localBooks = books; localNotes = notes.sorted { ($0.date ?? .distantFuture) > ($1.date ?? .distantFuture) }; intervals = rows
                availableTimeBooks = available; hasDeviceSnapshot = !missingTime; hasCompleteDeviceNotes = !missingNotes
                state = failed > 0 ? .partial("部分本机记录暂未读取，原文件仍保留。") : .ready
            } catch { if current() { state = previous.hasSnapshot ? .cached("暂时无法更新，保留此前载入的记录。") : .failed("暂时无法读取本机记录，请重试。") } }
            return
        }
        guard let account = model.account else { state = .idle; return }
        // Notebook owns its existing cursor, partial-failure and owner fences.
        async let notebook: Void = model.loadNotebookRecords(refresh: refresh)
        let zone = calendar.timeZone.identifier
        var cache: [String: CloudJSON] = [:]
        if let data = try? await library.cloudView("journal"), let saved = try? CloudJSON.decode(data) { cache = saved.object }
        guard current() else { _ = await notebook; return }
        var wanted = Set([ReadingJournal.monthKey(month, calendar: calendar)])
        if recent { wanted.formUnion(ReadingJournal.lastSevenDays(ending: Date(), calendar: calendar).map { ReadingJournal.monthKey($0, calendar: calendar) }) }
        var failed = false, anyCached = false
        for key in wanted.sorted() {
            let cacheKey = zone + ":" + key
            if months[key] == nil, let cached = cache[cacheKey], (try? ReadingJournal.validateMonth(cached, month: key, calendar: calendar)) != nil { months[key] = cached }
            do {
                let data = try await model.cloud.data(path: "/api/library/reading-summary?month=" + key + "&timeZone=" + CloudJSON.component(zone), ownerID: account.id)
                let value = try CloudJSON.decode(data)
                try ReadingJournal.validateMonth(value, month: key, calendar: calendar)
                guard current() else { _ = await notebook; return }
                months[key] = value; cache[cacheKey] = value
            } catch {
                guard current() else { _ = await notebook; return }
                failed = true; anyCached = anyCached || months[key] != nil
            }
        }
        _ = await notebook
        guard current() else { return }
        let available = wanted.allSatisfy { months[$0] != nil }
        state = failed ? (available || anyCached ? .cached("部分阅读日历暂未更新，保留已载入的记录。") : .failed("暂时无法读取阅读日历，请重试。")) : .ready
        let kept = Dictionary(uniqueKeysWithValues: cache.keys.sorted().suffix(24).compactMap { key in cache[key].map { (key, $0) } })
        do { try await library.cacheCloudView("journal", data: JSONEncoder().encode(CloudJSON.object(kept))) }
        catch { if current(), !failed { state = .partial("记录已读取，此设备的离线副本暂未保存。") } }
    }
    func notes(_ model: LibraryModel, scope: JournalScope) -> [ReadingJournal.Note] { scope == .account ? ReadingJournal.cloudNotes(model.notebookEntries) : localNotes }
    func seconds(on date: Date, scope: JournalScope, bookID: String? = nil) -> Int? {
        if scope == .device {
            let known = bookID.map { availableTimeBooks.contains($0) } ?? hasDeviceSnapshot
            return known ? ReadingJournal.seconds(intervals, on: date, bookID: bookID, calendar: calendar) : nil
        }
        guard let day = cloudDay(date) else { return nil }
        let value = bookID.map { id in day["books"].array.first { $0["bookId"].string == id }?["durationSeconds"].number ?? 0 } ?? day["durationSeconds"].number ?? 0
        return Int(value)
    }
    func cloudDay(_ date: Date) -> CloudJSON? {
        months[ReadingJournal.monthKey(date, calendar: calendar)]?["days"].array.first { $0["date"].string == ReadingJournal.dayKey(date, calendar: calendar) }
    }
    func bookIDs(on date: Date, scope: JournalScope) -> [String] {
        if scope == .account { return cloudDay(date)?["books"].array.filter { ($0["durationSeconds"].number ?? 0) > 0 }.compactMap { $0["bookId"].string } ?? [] }
        return localBooks.filter { (seconds(on: date, scope: scope, bookID: $0.id) ?? 0) > 0 }.map(\.id)
    }
    func title(_ id: String, on date: Date, scope: JournalScope) -> String {
        if scope == .device { return localBooks.first { $0.id == id }?.title ?? "书籍暂不可用" }
        return CloudShelfBook.title(cloudDay(date)?["books"].array.first { $0["bookId"].string == id }?["title"] ?? .null)
    }
}
