import Foundation
import CryptoKit

public struct CloudShelfBook: Codable, Identifiable, Equatable, Sendable {
    public var id: String
    public var title: String
    public var author: String
    public var contentVersion: String
    public init(id: String, title: String, author: String, contentVersion: String) {
        self.id = id; self.title = title; self.author = author; self.contentVersion = contentVersion
    }
    public init?(json: CloudJSON) {
        guard let id = json["bookId"].string, let version = json["contentVersion"].string else { return nil }
        self.init(id: id, title: Self.title(json["title"]), author: json["author"].string ?? "", contentVersion: version)
    }
    public static func title(_ json: CloudJSON) -> String { json.string ?? json["zh"].string ?? json["en"].string ?? json.object.values.compactMap(\.string).first ?? "未命名书籍" }
}

public struct CloudSyncMetadata: Codable, Sendable {
    public var syncedNotes: [String: String] = [:]
    public var syncedNoteBodies: [String: String] = [:]
    public var noteConflict: Bool = false
    public var noteErrors: [String: String] = [:]
    public var positionRevision: Int = 0
    public var lastSyncedAnchor: ReadingAnchor?
    public var positionConflict: Bool = false
    public var remoteAnchor: ReadingAnchor?
    public var remotePositionRevision: Int?
    public var lastError: String?
    public init() {}
}

public struct CloudReadingStartHint: Sendable {
    public var identity: CloudBookIdentity
    public var anchor: ReadingAnchor
    public init(identity: CloudBookIdentity, anchor: ReadingAnchor) { self.identity = identity; self.anchor = anchor }
}

public struct CloudReadingCopy: Sendable {
    public var identity: CloudBookIdentity
    public var title: String
    public var author: String
    public var chapters: [BookChapter]
    public var content: Data
    public var readingStart: CloudReadingStartHint?
    public init(identity: CloudBookIdentity, title: String, author: String, chapters: [BookChapter], content: Data, readingStart: CloudReadingStartHint? = nil) {
        self.identity = identity; self.title = title; self.author = author; self.chapters = chapters; self.content = content
        self.readingStart = readingStart
    }
}

/// The service supplies only IDs, never an inferred heading or a source-file path.
enum CloudReadingStartResolver {
    static let maximumContentBytes = 32 * 1024 * 1024
    private static let maximumMetadataBytes = 16 * 1024
    static func validated(_ hint: CloudReadingStartHint?, identity: CloudBookIdentity, chapters: [BookChapter]) -> ReadingAnchor? {
        guard let hint, hint.identity == identity, hint.anchor.characterOffset == 0, hint.anchor.pageY == nil, hint.anchor.resourceY == nil,
              identity.ownerID.utf8.count + identity.bookID.utf8.count + identity.contentVersion.utf8.count + hint.anchor.chapterID.utf8.count + hint.anchor.passageID.utf8.count <= maximumMetadataBytes,
              let chapter = chapters.first(where: { $0.id == hint.anchor.chapterID }),
              chapter.passages.contains(where: { $0.id == hint.anchor.passageID }) else { return nil }
        return ReadingAnchor(chapterID: chapter.id, passageID: hint.anchor.passageID)
    }
    static func hint(from manifest: CloudJSON, identity: CloudBookIdentity, chapters: [BookChapter]) -> CloudReadingStartHint? {
        let start = manifest["readingStart"]
        guard manifest["bookId"].string == identity.bookID, manifest["contentVersion"].string == identity.contentVersion,
              Set(start.object.keys) == ["chapterId", "passageId"],
              let chapter = start["chapterId"].string, let passage = start["passageId"].string,
              identity.bookID.utf8.count + identity.contentVersion.utf8.count + chapter.utf8.count + passage.utf8.count <= maximumMetadataBytes else { return nil }
        let hint = CloudReadingStartHint(identity: identity, anchor: ReadingAnchor(chapterID: chapter, passageID: passage))
        return validated(hint, identity: identity, chapters: chapters) == nil ? nil : hint
    }
    /// Called on OfflineLibrary's actor after package verification. Only the
    /// small envelope is decoded; sections are not materialized as CloudJSON.
    static func legacy(at url: URL, identity: CloudBookIdentity, chapters: [BookChapter]) -> ReadingAnchor? {
        guard let size = try? Disk.size(url), size > 0, size <= Int64(maximumContentBytes),
              let data = try? Data(contentsOf: url, options: .mappedIfSafe),
              let metadata = try? JSONDecoder().decode(Metadata.self, from: data),
              metadata.bookId == identity.bookID, metadata.contentVersion == identity.contentVersion,
              let start = metadata.readingStart,
              metadata.bookId.utf8.count + metadata.contentVersion.utf8.count + start.chapterId.utf8.count + start.passageId.utf8.count <= maximumMetadataBytes else { return nil }
        return validated(CloudReadingStartHint(identity: identity, anchor: ReadingAnchor(chapterID: start.chapterId, passageID: start.passageId)), identity: identity, chapters: chapters)
    }
    private struct Metadata: Decodable {
        let bookId: String
        let contentVersion: String
        let readingStart: Start?
    }
    private struct Start: Decodable {
        let chapterId: String
        let passageId: String
        init(from decoder: Decoder) throws {
            let values = try decoder.container(keyedBy: Key.self)
            guard Set(values.allKeys.map(\.stringValue)) == ["chapterId", "passageId"] else {
                throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unexpected reading-start fields"))
            }
            chapterId = try values.decode(String.self, forKey: Key(stringValue: "chapterId")!)
            passageId = try values.decode(String.self, forKey: Key(stringValue: "passageId")!)
        }
    }
    private struct Key: CodingKey {
        let stringValue: String
        var intValue: Int? { nil }
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { return nil }
    }
}

public struct CloudDownloadProgress: Equatable, Sendable {
    public let completedChapters: Int
    public let totalChapters: Int
    public var fraction: Double { totalChapters > 0 ? Double(completedChapters) / Double(totalChapters) : 0 }
}

public extension CloudLibraryClient {
    func shelf(ownerID: String) async throws -> [CloudShelfBook] {
        let value = try CloudJSON.decode(await data(path: "/api/library?view=books", ownerID: ownerID))
        guard value["user"]["id"].string == ownerID else { throw CloudRequestError(status: 409, message: "账号已切换，未载入其他书房。") }
        return value["books"].array.compactMap(CloudShelfBook.init(json:))
    }
    func downloadReadingCopy(_ remote: CloudShelfBook, ownerID: String, progress: (@Sendable (CloudDownloadProgress) async -> Void)? = nil) async throws -> CloudReadingCopy {
        let path = "/api/library/books/" + CloudJSON.component(remote.id)
        var manifest = try await readingJSON(path: path + "/reading-manifest", ownerID: ownerID)
        guard manifest["bookId"].string == remote.id, let version = manifest["contentVersion"].string else { throw CloudRequestError(status: 409, message: "书籍版本无法核对，请重新打开书房。") }
        guard manifest["chapters"].array.count <= 5000 else { throw CloudRequestError(status: 413, message: "章节较多，暂不能整本下载。原书仍保留在云端。") }
        var downloadBytes = try JSONEncoder().encode(manifest).count
        var passageIDs: Set<String> = [], chapterIDs: Set<String> = []
        var chapters: [BookChapter] = [], sections: [CloudJSON] = []
        let totalChapters = manifest["chapters"].array.count
        await progress?(CloudDownloadProgress(completedChapters: 0, totalChapters: totalChapters))
        for chapter in manifest["chapters"].array {
            try Task.checkCancellation()
            guard let chapterID = chapter["id"].string else { throw CloudRequestError(status: 409, message: "章节目录不完整，尚未标为离线可用。") }
            let value = try await readingJSON(path: path + "/chapters/" + CloudJSON.component(chapterID) + "?contentVersion=" + CloudJSON.component(version), ownerID: ownerID)
            guard value["bookId"].string == remote.id, value["contentVersion"].string == version, value["chapterId"].string == chapterID else { throw CloudRequestError(status: 409, message: "书籍已更新，请重新下载，现有副本仍保留。") }
            downloadBytes += try JSONEncoder().encode(value).count
            guard downloadBytes <= 32 * 1024 * 1024, chapterIDs.insert(chapterID).inserted else { throw CloudRequestError(status: 413, message: "书籍超过离线容量或目录重复，未标为下载完成。") }
            var passages: [Passage] = []
            for section in value["sections"].array {
                guard section["chapterId"].string == chapterID else { throw CloudRequestError(status: 409, message: "章节归属不一致，未保存离线副本。") }
                sections.append(section)
                for row in section["paragraphs"].array {
                    guard let id = row["id"].string, let text = row["original"].string else { throw CloudRequestError(status: 409, message: "正文尚未完整下载。") }
                    guard passageIDs.insert(id).inserted, passageIDs.count <= 100_000 else { throw CloudRequestError(status: 409, message: "正文段落标识重复或超出离线容量。") }
                    passages.append(Passage(id: id, text: text, heading: row["source"]["type"].string == "heading"))
                }
            }
            if !passages.isEmpty { chapters.append(BookChapter(id: chapterID, title: CloudShelfBook.title(chapter["title"]), sourcePath: chapterID, passages: passages)) }
            await progress?(CloudDownloadProgress(completedChapters: chapterIDs.count, totalChapters: totalChapters))
            try Task.checkCancellation()
        }
        guard !chapters.isEmpty else { throw CloudRequestError(status: 409, message: "这本书暂时没有可下载的文字正文，请在网页查看原件。") }
        if let snapshot = manifest["readingCache"]["snapshotId"].string {
            let current = try await readingJSON(path: path + "/reading-manifest", ownerID: ownerID)
            guard current["contentVersion"].string == version, current["readingCache"]["snapshotId"].string == snapshot else { throw CloudRequestError(status: 409, message: "正文或译文刚刚更新，请重试下载。已有副本仍保留。") }
        }
        var object = manifest.object; object["sections"] = .array(sections); manifest = .object(object)
        try Task.checkCancellation()
        let identity = CloudBookIdentity(ownerID: ownerID, bookID: remote.id, contentVersion: version, sourceFormat: manifest["source"]["format"].string ?? "text")
        return CloudReadingCopy(identity: identity, title: CloudShelfBook.title(manifest["title"]), author: manifest["author"].string ?? remote.author, chapters: chapters, content: try JSONEncoder().encode(manifest), readingStart: CloudReadingStartResolver.hint(from: manifest, identity: identity, chapters: chapters))
    }
    /// The web transport switches to stable base64 parts for a chapter over its response limit.
    private func readingJSON(path: String, ownerID: String) async throws -> CloudJSON {
        let first = try CloudJSON.decode(await data(path: path, ownerID: ownerID))
        guard first["kind"].string == "leafhour-book-transfer-v1" else { return first }
        guard let snapshot = first["snapshot"].string, snapshot.count == 64, let total = first["totalBytes"].number,
              total > 0, total <= 32 * 1024 * 1024, first["partBytes"].number == 1_048_576 else { throw CloudRequestError(status: 409, message: "章节分段回执不完整。") }
        var result = Data()
        while result.count < Int(total) {
            let offset = result.count
            let separator = path.contains("?") ? "&" : "?"
            let part = try CloudJSON.decode(await data(path: path + separator + "offset=\(offset)&snapshot=" + CloudJSON.component(snapshot), ownerID: ownerID))
            let expectedLength = min(1_048_576, Int(total) - offset)
            guard part["kind"].string == "leafhour-book-part-v1", part["snapshot"].string == snapshot, part["offset"].number == Double(offset), part["totalBytes"].number == total,
                  let encoded = part["data"].string, let bytes = Data(base64Encoded: encoded), bytes.count == expectedLength,
                  part["nextOffset"] == (offset + expectedLength < Int(total) ? .number(Double(offset + expectedLength)) : .null) else { throw CloudRequestError(status: 409, message: "章节版本已变化，未混合保存正文。") }
            result.append(bytes)
        }
        guard result.count == Int(total), Disk.hash(result) == snapshot else { throw CloudRequestError(status: 409, message: "章节尚未完整下载。") }
        return try CloudJSON.decode(result)
    }
}

/// Disk state is the durable outbox: only acknowledged note IDs and the last
/// acknowledged anchor are marked synced. A failed request leaves local edits pending.
public actor CloudBookSync {
    private let client: CloudLibraryClient
    private let library: OfflineLibrary
    private struct Work {
        var id: UUID
        var task: Task<Void, Error>
        var activePull: Bool?
        var pendingPull: Bool?
    }
    private var running: [String: Work] = [:]
    private var deferred: [String: Task<Void, Never>] = [:]
    public init(client: CloudLibraryClient, library: OfflineLibrary) { self.client = client; self.library = library }
    public func schedule(_ bookID: String) {
        deferred[bookID]?.cancel()
        deferred[bookID] = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(2)); try Task.checkCancellation(); try await self?.synchronize(bookID, pull: false) } catch {}
        }
    }
    public func synchronize(_ bookID: String, pull: Bool = true) async throws {
        if var current = running[bookID] {
            // A push represents a new disk checkpoint. Merge checkpoints arriving
            // after this worker captured its snapshot into one subsequent pass.
            // Concurrent callers of an already running pull can share that pull.
            if !pull || current.activePull != true {
                current.pendingPull = (current.pendingPull ?? false) || pull
                running[bookID] = current
            }
            try await current.task.value
            return
        }
        let marker = UUID()
        let work = Task {
            defer { finishWork(bookID, marker: marker) }
            try await drainSynchronization(bookID, marker: marker, firstPull: pull)
        }
        running[bookID] = Work(id: marker, task: work, activePull: pull)
        try await work.value
    }
    private func finishWork(_ bookID: String, marker: UUID) {
        if running[bookID]?.id == marker { running.removeValue(forKey: bookID) }
    }
    private func nextSynchronization(_ bookID: String, marker: UUID) -> Bool? {
        guard var current = running[bookID], current.id == marker else { return nil }
        let next = current.pendingPull
        current.pendingPull = nil; current.activePull = next
        running[bookID] = current
        return next
    }
    private func drainSynchronization(_ bookID: String, marker: UUID, firstPull: Bool?) async throws {
        var next = firstPull
        while let pull = next {
            // Failure ends this worker and reaches every waiter. Pending disk
            // edits stay in the outbox until a later explicit or scheduled retry.
            guard try await performSynchronization(bookID, pull: pull) else { return }
            next = nextSynchronization(bookID, marker: marker)
        }
    }
    private func performSynchronization(_ bookID: String, pull: Bool) async throws -> Bool {
        let book = try await library.book(bookID)
        guard let identity = book.cloud else { return true }
        var metadata = try await library.cloudMetadata(bookID)
        var canDrain = true
        do {
            let path = "/api/library/books/" + CloudJSON.component(identity.bookID)
            let records = try CloudJSON.decode(await client.data(path: path + "/records", ownerID: identity.ownerID))
            guard records["bookId"].string == identity.bookID, records["contentVersion"].string == identity.contentVersion else { throw CloudRequestError(status: 409, message: "书籍内容已更新，旧副本与个人记录仍保留，请重新下载新版。") }
            var state = try await library.state(bookID)
            let snapshot = state
            var byID: [String: (String, String)] = [:]
            for chapter in book.chapters { for passage in chapter.passages {
                guard byID[passage.id] == nil else { throw CloudRequestError(status: 409, message: "离线段落标识重复，未上传记录。") }
                byID[passage.id] = (chapter.id, passage.text)
            } }
            if pull {
                metadata.noteConflict = false
                let rows = records["comments"].array.map { ($0, false) } + records["questions"].array.map { ($0, true) }
                for (row, question) in rows {
                    guard row["origin"].string == "user", let remoteID = row["id"].string,
                          let passageID = row["passageId"].string, let passage = byID[passageID], let text = row["text"].string else { continue }
                    let id = Self.noteID(question ? "question:" + remoteID : remoteID), key = id.uuidString
                    let existing = state.notes.firstIndex(where: { $0.id == id })
                    let localChanged = existing.map { metadata.syncedNoteBodies[key] != nil && state.notes[$0].body != metadata.syncedNoteBodies[key] } ?? false
                    if row["deletedAt"] != .null {
                        if let existing { if localChanged { metadata.noteConflict = true } else { state.notes.remove(at: existing) } }
                        metadata.syncedNotes[key] = remoteID
                        continue
                    }
                    let quote = row["quote"].string ?? String(passage.1.prefix(200))
                    var anchor = ReadingAnchor(chapterID: passage.0, passageID: passageID)
                    if let existing {
                        let local = state.notes[existing]
                        // Cloud comments do not carry a character offset. The
                        // same note/quote in this verified content version keeps
                        // its local selection, including formatted Markdown text.
                        if local.anchor.chapterID == passage.0, local.anchor.passageID == passageID, local.quote == quote,
                           (0...passage.1.unicodeScalars.count).contains(local.anchor.characterOffset) {
                            anchor = local.anchor
                        }
                    }
                    let remoteNote = ReaderNote(id: id, anchor: anchor, quote: quote, body: text, modifiedAt: Self.date(row["updatedAt"].string ?? row["createdAt"].string))
                    if let existing {
                        if localChanged && state.notes[existing].body != text { metadata.noteConflict = true }
                        else { state.notes[existing] = remoteNote }
                    } else { state.notes.append(remoteNote) }
                    metadata.syncedNotes[key] = remoteID
                    if !localChanged { metadata.syncedNoteBodies[key] = text }
                }
            }
            metadata.noteErrors = [:]
            for note in snapshot.notes where metadata.syncedNotes[note.id.uuidString] == nil {
                let key = note.id.uuidString, id = key.lowercased()
                guard (note.body as NSString).length <= 2000 else {
                    metadata.noteErrors[key] = "这条笔记超过云端 2000 字元上限，完整内容仍保存在设备，可从书籍详情导出。"
                    continue
                }
                var payload: [String: CloudJSON] = ["id": .string(id), "passageId": .string(note.anchor.passageID), "contentVersion": .string(identity.contentVersion), "text": .string(note.body), "quoteOrigin": .string("original"), "quoteLanguage": .string("en"), "origin": .string("user")]
                if (note.quote as NSString).length <= 4000 { payload["quote"] = .string(note.quote) }
                do {
                    _ = try await client.data(path: path + "/comments", method: "POST", body: CloudJSON.encode(payload), ownerID: identity.ownerID)
                    metadata.syncedNotes[key] = id; metadata.syncedNoteBodies[key] = note.body
                    try await library.saveCloudMetadata(metadata, bookID: bookID)
                } catch let error as CloudRequestError {
                    if error.status == 401 || error.status == 403 { throw error }
                    canDrain = false
                    metadata.noteErrors[key] = "这条笔记尚未同步：" + error.localizedDescription
                    if error.status >= 500 { break }
                } catch {
                    canDrain = false
                    metadata.noteErrors[key] = "这条笔记尚未同步，内容仍保存在设备。"
                    break
                }
            }
            let position = records["position"]
            let remoteRevision = Int(position["revision"].number ?? 0)
            let remoteAnchor = Self.anchor(position, book: book)
            let pendingPosition = snapshot.anchor != metadata.lastSyncedAnchor
            if pendingPosition, let anchor = snapshot.anchor {
                if remoteRevision != metadata.positionRevision {
                    metadata.positionConflict = true; metadata.remoteAnchor = remoteAnchor; metadata.remotePositionRevision = remoteRevision
                } else {
                    let count = byID[anchor.passageID]?.1.unicodeScalars.count ?? 0
                    let body = try CloudJSON.encode(["chapterId": .string(anchor.chapterID), "passageId": .string(anchor.passageID), "contentVersion": .string(identity.contentVersion), "offset": .number(0), "withinParagraph": .number(count > 0 ? min(1, Double(anchor.characterOffset) / Double(count)) : 0), "mode": .string("en"), "variant": .string("literal"), "baseRevision": .number(Double(metadata.positionRevision))])
                    do {
                        let saved = try CloudJSON.decode(await client.data(path: path + "/progress", method: "POST", body: body, ownerID: identity.ownerID))
                        metadata.positionRevision = Int(saved["revision"].number ?? Double(remoteRevision + 1)); metadata.lastSyncedAnchor = anchor; metadata.positionConflict = false
                    } catch let error as CloudRequestError where error.status == 409 {
                        metadata.positionConflict = true; metadata.remoteAnchor = remoteAnchor; metadata.remotePositionRevision = remoteRevision
                    }
                }
            } else if pull {
                state.anchor = remoteAnchor; metadata.lastSyncedAnchor = remoteAnchor; metadata.positionRevision = remoteRevision; metadata.positionConflict = false
            }
            // Pull is used only while no reader owns this book. Push never rewrites its live state.
            if pull && state != snapshot { try await library.saveState(state, bookID: bookID) }
            var issues: [String] = []
            if metadata.positionConflict { issues.append("阅读位置在另一台设备有更新，请选择从哪里继续。") }
            if metadata.noteConflict { issues.append("部分笔记在两处有修改；本机版本已保留，请在网页核对云端版本。") }
            if let error = metadata.noteErrors.values.sorted().first { issues.append(error) }
            metadata.lastError = issues.isEmpty ? nil : issues.joined(separator: " ")
            try await library.saveCloudMetadata(metadata, bookID: bookID)
            return canDrain
        } catch {
            metadata.lastError = error.localizedDescription
            try? await library.saveCloudMetadata(metadata, bookID: bookID)
            throw error
        }
    }
    public func resolvePosition(_ bookID: String, useDevice: Bool) async throws {
        // Recheck after suspension: another resolver may have acquired this book
        // while multiple callers were waiting for the previous worker.
        while let current = running[bookID] { try await current.task.value }
        let marker = UUID()
        let work = Task {
            defer { finishWork(bookID, marker: marker) }
            guard try await performPositionResolution(bookID, useDevice: useDevice) else { return }
            try await drainSynchronization(bookID, marker: marker, firstPull: nextSynchronization(bookID, marker: marker))
        }
        running[bookID] = Work(id: marker, task: work, activePull: nil)
        try await work.value
    }
    private func performPositionResolution(_ bookID: String, useDevice: Bool) async throws -> Bool {
        var metadata = try await library.cloudMetadata(bookID)
        guard metadata.positionConflict, let revision = metadata.remotePositionRevision else { return true }
        if useDevice {
            guard try await library.state(bookID).anchor != nil else { throw CloudRequestError(status: 409, message: "此设备暂没有可同步的阅读位置，请选择云端位置。") }
            // Choosing this device is an explicit write, even if the user has
            // returned to the previously acknowledged anchor. Keep the conflict
            // context until its CAS write succeeds so failed verification is retryable.
            metadata.positionRevision = revision; metadata.lastSyncedAnchor = nil
            try await library.saveCloudMetadata(metadata, bookID: bookID)
            return try await performSynchronization(bookID, pull: true)
        } else {
            var state = try await library.state(bookID); state.anchor = metadata.remoteAnchor
            metadata.lastSyncedAnchor = metadata.remoteAnchor; metadata.positionRevision = revision; metadata.positionConflict = false; metadata.lastError = nil
            try await library.saveState(state, bookID: bookID); try await library.saveCloudMetadata(metadata, bookID: bookID)
            return true
        }
    }
    public static func noteID(_ value: String) -> UUID {
        if let id = UUID(uuidString: value) { return id }
        let bytes = Array(SHA256.hash(data: Data(value.utf8)).prefix(16))
        return UUID(uuid: (bytes[0],bytes[1],bytes[2],bytes[3],bytes[4],bytes[5],bytes[6],bytes[7],bytes[8],bytes[9],bytes[10],bytes[11],bytes[12],bytes[13],bytes[14],bytes[15]))
    }
    public static func anchor(_ value: CloudJSON, book: LocalBook) -> ReadingAnchor? {
        guard let chapterID = value["chapterId"].string, let passageID = value["passageId"].string,
              let passage = book.chapters.first(where: { $0.id == chapterID })?.passages.first(where: { $0.id == passageID }) else { return nil }
        let ratio = min(1, max(0, value["withinParagraph"].number ?? 0))
        return ReadingAnchor(chapterID: chapterID, passageID: passageID, characterOffset: Int(Double(passage.text.unicodeScalars.count) * ratio))
    }
    private static func date(_ string: String?) -> Date {
        guard let string else { return .distantPast }
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: string) ?? ISO8601DateFormatter().date(from: string) ?? .distantPast
    }
}

public actor CloudReaderStateStore: ReaderStateStore {
    private let library: OfflineLibrary
    private let sync: CloudBookSync
    public init(library: OfflineLibrary, sync: CloudBookSync) { self.library = library; self.sync = sync }
    public func saveState(_ state: ReaderState, bookID: String) async throws {
        try await library.saveState(state, bookID: bookID)
        await sync.schedule(bookID)
    }
}
