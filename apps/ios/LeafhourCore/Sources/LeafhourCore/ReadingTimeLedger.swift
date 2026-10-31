import Foundation

public struct ReadingTimeLedger: Codable, Sendable {
    public var ownerID: String?
    public var bookID: String
    public var contentVersion: String
    public var cloudBound: Bool
    private struct Entry: Codable, Sendable { var snapshot: ReadingTimeSnapshot; var acknowledgedSequence: Int = 0 }
    private var entries: [Entry] = []
    public init(ownerID: String?, bookID: String, contentVersion: String, cloudBound: Bool = false) { self.ownerID = ownerID; self.bookID = bookID; self.contentVersion = contentVersion; self.cloudBound = cloudBound }
    private enum CodingKeys: String, CodingKey { case ownerID, bookID, contentVersion, cloudBound, entries }
    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        ownerID = try values.decodeIfPresent(String.self, forKey: .ownerID)
        bookID = try values.decode(String.self, forKey: .bookID); contentVersion = try values.decode(String.self, forKey: .contentVersion)
        cloudBound = try values.decodeIfPresent(Bool.self, forKey: .cloudBound) ?? false
        entries = try values.decode([Entry].self, forKey: .entries)
    }
    public var pending: [ReadingTimeSnapshot] { entries.filter { $0.acknowledgedSequence < $0.snapshot.sequence }.map(\.snapshot) }
    public var snapshots: [ReadingTimeSnapshot] { entries.map(\.snapshot) }
    func validate() throws {
        guard entries.count <= 10000, Set(entries.map { $0.snapshot.id }).count == entries.count,
              entries.allSatisfy({ $0.acknowledgedSequence >= 0 && $0.acknowledgedSequence <= $0.snapshot.sequence }) else { throw ReadingTimeDate.fail() }
        for entry in entries { try entry.snapshot.validate() }
    }
    public mutating func retain(_ snapshot: ReadingTimeSnapshot) throws {
        try snapshot.validate()
        guard snapshot.contentVersion == contentVersion else { throw ReadingTimeDate.fail() }
        if let index = entries.firstIndex(where: { $0.snapshot.id == snapshot.id }) {
            let old = entries[index].snapshot
            guard old.sameIdentity(as: snapshot), old.status != .finished || snapshot.status == .finished else { throw ReadingTimeDate.fail() }
            if old.sequence == snapshot.sequence { guard old == snapshot else { throw ReadingTimeDate.fail() }; return }
            guard snapshot.sequence > old.sequence else { return }
            guard ReadingTimeSegment.union(snapshot.segments + old.segments) == ReadingTimeSegment.union(snapshot.segments), snapshot.endedAt >= old.endedAt else { throw ReadingTimeDate.fail() }
            entries[index].snapshot = snapshot
        } else {
            guard entries.count < 10000 else { throw ReadingTimeDate.fail("阅读时段较多，请先保留导出备份。") }
            guard !cloudBound || pending.count < 20 else { throw ReadingTimeDate.fail("待同步阅读时段较多，请联网保存后再开始。") }
            entries.append(Entry(snapshot: snapshot))
        }
    }
    public mutating func recoverInterrupted() {
        for index in entries.indices where entries[index].snapshot.status != .finished {
            entries[index].snapshot.status = .finished; entries[index].snapshot.sequence += 1
        }
    }
    public mutating func acknowledge(_ received: ReadingTimeSnapshot, submitted: ReadingTimeSnapshot, ownerID: String) throws {
        guard self.ownerID == ownerID, received.matches(submitted), let index = entries.firstIndex(where: { $0.snapshot.id == submitted.id }), entries[index].snapshot.sameIdentity(as: submitted) else { throw ReadingTimeDate.fail("书房尚未确认这次阅读，记录仍留在本机。") }
        entries[index].acknowledgedSequence = max(entries[index].acknowledgedSequence, submitted.sequence)
    }
}

public protocol ReadingTimeStore: Sendable {
    func retainReadingTime(_ snapshot: ReadingTimeSnapshot, bookID: String) async throws
    func recoverReadingTime(bookID: String) async throws
}

extension OfflineLibrary: ReadingTimeStore {
    static func recoverInterruptedReadingTimes(at root: URL) throws {
        let states = root.appendingPathComponent("states")
        for file in try Disk.fm.contentsOfDirectory(at: states, includingPropertiesForKeys: nil) where file.lastPathComponent.hasSuffix("-reading-time.json") {
            // A corrupt ledger remains byte-for-byte intact and reports its
            // own failure when opened; it must not prevent other books opening.
            guard var ledger = try? Disk.read(ReadingTimeLedger.self, from: file), (try? ledger.validate()) != nil,
                  ledger.snapshots.contains(where: { $0.status != .finished }) else { continue }
            ledger.recoverInterrupted(); try Disk.write(ledger, to: file)
        }
    }
    private func timeLedgerURL(_ bookID: String) throws -> URL { _ = try bookDirectory(bookID); return root.appendingPathComponent("states/" + bookID + "-reading-time.json") }
    private func timeIdentity(_ book: LocalBook) -> (String?, String, String) {
        (book.cloud?.ownerID ?? (root.lastPathComponent.hasPrefix("account-") ? String(root.lastPathComponent.dropFirst(8)) : nil), book.cloud?.bookID ?? book.id, book.cloud?.contentVersion ?? book.sourceVersion)
    }
    private func timeBook(_ bookID: String) throws -> LocalBook {
        // Like saveState, checkpoints use metadata verified when the book was
        // opened; hashing the complete original every 30 seconds blocks writes.
        let directory = try bookDirectory(bookID)
        guard Disk.fm.fileExists(atPath: directory.appendingPathComponent("manifest.json").path) else { throw ReadingTimeDate.fail() }
        let book = try Disk.read(LocalBook.self, from: directory.appendingPathComponent("book.json"))
        guard book.id == bookID, book.sourceVersion == "sha256-" + bookID else { throw ReadingTimeDate.fail() }
        if let identity = book.cloud {
            guard let owner = UUID(uuidString: identity.ownerID), root.lastPathComponent == "account-" + owner.uuidString.lowercased() else { throw ReadingTimeDate.fail() }
        }
        return book
    }
    public func readingTimeLedger(bookID: String) throws -> ReadingTimeLedger {
        let book = try timeBook(bookID), (owner, _, version) = timeIdentity(book), url = try timeLedgerURL(bookID)
        guard Disk.fm.fileExists(atPath: url.path) else { return ReadingTimeLedger(ownerID: owner, bookID: bookID, contentVersion: version, cloudBound: book.cloud != nil) }
        var ledger: ReadingTimeLedger
        do { ledger = try Disk.read(ReadingTimeLedger.self, from: url) } catch { throw ReadingTimeDate.fail("本机阅读时段无法读取，原文件已保留。") }
        guard ledger.ownerID == owner, ledger.bookID == bookID, ledger.contentVersion == version else { throw ReadingTimeDate.fail() }
        // Binding follows the verified book identity, never mere login state or
        // an old serialized default. Account-local originals are still local.
        ledger.cloudBound = book.cloud != nil
        try ledger.validate()
        for row in ledger.snapshots { try validateReadingTime(row, book: book) }
        return ledger
    }
    private func validateReadingTime(_ row: ReadingTimeSnapshot, book: LocalBook) throws {
        try row.validate(); let (_, wireID, version) = timeIdentity(book)
        func valid(_ anchor: ReadingAnchor) -> Bool { book.chapters.first(where: { $0.id == anchor.chapterID })?.passages.contains(where: { $0.id == anchor.passageID }) == true }
        guard row.bookId == wireID, row.contentVersion == version, valid(row.start), valid(row.end) else { throw ReadingTimeDate.fail() }
    }
    public func retainReadingTime(_ snapshot: ReadingTimeSnapshot, bookID: String) throws {
        try validateReadingTime(snapshot, book: timeBook(bookID))
        var ledger = try readingTimeLedger(bookID: bookID); try ledger.retain(snapshot); try Disk.write(ledger, to: timeLedgerURL(bookID))
    }
    public func recoverReadingTime(bookID: String) throws {
        var ledger = try readingTimeLedger(bookID: bookID)
        guard ledger.snapshots.contains(where: { $0.status != .finished }) else { return }
        ledger.recoverInterrupted(); try Disk.write(ledger, to: timeLedgerURL(bookID))
    }
    public func acknowledgeReadingTime(_ received: ReadingTimeSnapshot, submitted: ReadingTimeSnapshot, bookID: String, ownerID: String) throws {
        let book = try timeBook(bookID); guard book.cloud?.ownerID == ownerID else { throw ReadingTimeDate.fail() }
        try validateReadingTime(received, book: book)
        var ledger = try readingTimeLedger(bookID: bookID); try ledger.acknowledge(received, submitted: submitted, ownerID: ownerID); try Disk.write(ledger, to: timeLedgerURL(bookID))
    }
}
