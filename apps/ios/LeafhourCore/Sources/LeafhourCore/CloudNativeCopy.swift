import Foundation
import zlib

/// The compressed archive is private and immutable. Keep the original JSON bytes
/// for saved translations/editorial data; decode only the source projection here.
extension CloudLibraryClient {
    func downloadNativeReadingCopy(_ remote: CloudShelfBook, ownerID: String, progress: (@Sendable (CloudDownloadProgress) async -> Void)?) async throws -> CloudReadingCopy? {
        let path = "/api/library/books/" + CloudJSON.component(remote.id) + "/native-copy"
        let planBytes: Data
        do {
            planBytes = try await readingCopyData(path: path, ownerID: ownerID, preparing: true)
        } catch let error as CloudRequestError where error.status == 404 || error.status == 405 {
            return nil
        }
        try Task.checkCancellation()
        let plan = try NativeReadingCopyPlan(planBytes, bookID: remote.id)
        var compressed = Data(); compressed.reserveCapacity(plan.compressedBytes)
        while compressed.count < plan.compressedBytes {
            try Task.checkCancellation()
            let offset = compressed.count
            let bytes = try await readingCopyData(path: path + "/part?archive=" + plan.sha256 + "&offset=\(offset)", ownerID: ownerID)
            let expected = min(NativeReadingCopyPlan.partBytes, plan.compressedBytes - offset)
            guard bytes.count == expected else { throw NativeReadingCopyPlan.invalid() }
            compressed.append(bytes)
        }
        try Task.checkCancellation()
        guard Disk.hash(compressed) == plan.sha256 else { throw NativeReadingCopyPlan.invalid() }
        let content = try NativeReadingCopyGzip.decode(compressed, expectedBytes: plan.uncompressedBytes)
        let model: NativeReadingCopyModel
        do { model = try JSONDecoder().decode(NativeReadingCopyModel.self, from: content) }
        catch { throw NativeReadingCopyPlan.invalid() }
        let copy = try model.copy(content: content, plan: plan, ownerID: ownerID, fallbackAuthor: remote.author)
        try Task.checkCancellation()
        let verified = try CloudJSON.decode(await readingCopyData(path: path + "/verify?archive=" + plan.sha256, ownerID: ownerID, preparing: true))
        guard verified["valid"] == .bool(true), verified["bookId"].string == remote.id,
              verified["contentVersion"].string == plan.contentVersion, verified["snapshotId"].string == plan.snapshotID,
              verified["sha256"].string == plan.sha256 else { throw NativeReadingCopyPlan.invalid() }
        await progress?(CloudDownloadProgress(completedChapters: 0, totalChapters: copy.chapters.count))
        try Task.checkCancellation()
        await progress?(CloudDownloadProgress(completedChapters: copy.chapters.count, totalChapters: copy.chapters.count))
        try Task.checkCancellation()
        return copy
    }
}

private struct NativeReadingCopyPlan {
    static let maximumCompressedBytes = 32 * 1024 * 1024
    static let maximumContentBytes = 96 * 1024 * 1024
    static let partBytes = 1_048_576
    let bookID: String
    let contentVersion: String
    let snapshotID: String
    let sha256: String
    let compressedBytes: Int
    let uncompressedBytes: Int
    init(_ bytes: Data, bookID: String) throws {
        guard bytes.count <= 16 * 1024 else { throw Self.invalid() }
        let value = try CloudJSON.decode(bytes)
        guard value["kind"].string == "leafhour-native-copy-v1", value["bookId"].string == bookID,
              let version = value["contentVersion"].string, !version.isEmpty, version.utf8.count <= 4096,
              let snapshot = value["snapshotId"].string, Self.isDigest(snapshot),
              let digest = value["sha256"].string, Self.isDigest(digest),
              let compressed = Self.positiveInteger(value["compressedBytes"], maximum: Self.maximumCompressedBytes),
              let uncompressed = Self.positiveInteger(value["uncompressedBytes"], maximum: Self.maximumContentBytes),
              value["partBytes"].number == Double(Self.partBytes), value["encoding"].string == "gzip" else { throw Self.invalid() }
        self.bookID = bookID; contentVersion = version; snapshotID = snapshot; sha256 = digest
        compressedBytes = compressed; uncompressedBytes = uncompressed
    }
    private static func positiveInteger(_ json: CloudJSON, maximum: Int) -> Int? {
        guard let value = json.number, value.isFinite, value > 0, value <= Double(maximum), value.rounded(.towardZero) == value else { return nil }
        return Int(value)
    }
    private static func isDigest(_ value: String) -> Bool { value.utf8.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) } }
    static func invalid() -> CloudRequestError { CloudRequestError(status: 409, message: "正文尚未完整下载。") }
}

enum NativeReadingCopyGzip {
    /// zlib checks the gzip header, stream and footer CRC. Stop before appending
    /// anything above the declared bounded size, and reject extra gzip members.
    static func decode(_ bytes: Data, expectedBytes: Int) throws -> Data {
        guard !bytes.isEmpty, bytes.count <= 32 * 1024 * 1024, expectedBytes > 0, expectedBytes <= 96 * 1024 * 1024 else { throw NativeReadingCopyPlan.invalid() }
        var stream = z_stream()
        guard inflateInit2_(&stream, MAX_WBITS + 16, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size)) == Z_OK else { throw NativeReadingCopyPlan.invalid() }
        defer { inflateEnd(&stream) }
        return try bytes.withUnsafeBytes { (input: UnsafeRawBufferPointer) in
            stream.next_in = UnsafeMutablePointer(mutating: input.bindMemory(to: UInt8.self).baseAddress!)
            stream.avail_in = UInt32(bytes.count)
            var output = Data(); output.reserveCapacity(expectedBytes)
            while true {
                try Task.checkCancellation()
                var chunk = Data(count: 65_536); stream.avail_out = UInt32(chunk.count)
                let status = chunk.withUnsafeMutableBytes { (buffer: UnsafeMutableRawBufferPointer) in
                    stream.next_out = buffer.bindMemory(to: UInt8.self).baseAddress!
                    return inflate(&stream, Z_NO_FLUSH)
                }
                guard status == Z_OK || status == Z_STREAM_END else { throw NativeReadingCopyPlan.invalid() }
                chunk.count -= Int(stream.avail_out)
                guard chunk.count <= expectedBytes - output.count else { throw NativeReadingCopyPlan.invalid() }
                output.append(chunk)
                if status == Z_STREAM_END {
                    guard stream.avail_in == 0, output.count == expectedBytes else { throw NativeReadingCopyPlan.invalid() }
                    return output
                }
                guard !chunk.isEmpty || stream.avail_in > 0 else { throw NativeReadingCopyPlan.invalid() }
            }
        }
    }
}

private struct NativeReadingCopyModel: Decodable {
    let bookId: String
    let contentVersion: String
    let title: CloudJSON?
    let author: String?
    let source: Source?
    let chapters: [Chapter]
    let sections: [Section]
    let reading: Reading?
    let readingStart: CloudJSON?
    let readingCache: Cache?
    struct Source: Decodable { let format: String? }
    struct Chapter: Decodable { let id: String; let title: CloudJSON? }
    struct Section: Decodable { let chapterId: String; let paragraphs: [Paragraph] }
    struct Paragraph: Decodable { let id: String; let original: String; let source: ParagraphSource?; let unloaded: Bool? }
    struct ParagraphSource: Decodable { let type: String? }
    struct Reading: Decodable { let partial: Bool? }
    struct Cache: Decodable { let snapshotId: String? }
    func copy(content: Data, plan: NativeReadingCopyPlan, ownerID: String, fallbackAuthor: String) throws -> CloudReadingCopy {
        guard bookId == plan.bookID, contentVersion == plan.contentVersion, reading?.partial != true,
              readingCache?.snapshotId == nil || readingCache?.snapshotId == plan.snapshotID,
              !chapters.isEmpty, chapters.count <= 5_000 else { throw NativeReadingCopyPlan.invalid() }
        var declared = Set<String>()
        for chapter in chapters {
            guard !chapter.id.isEmpty, declared.insert(chapter.id).inserted else { throw NativeReadingCopyPlan.invalid() }
        }
        var passages: [String: [Passage]] = [:], passageIDs = Set<String>()
        for section in sections {
            try Task.checkCancellation()
            guard declared.contains(section.chapterId) else { throw NativeReadingCopyPlan.invalid() }
            if passages[section.chapterId] == nil { passages[section.chapterId] = [] }
            for row in section.paragraphs {
                guard !row.id.isEmpty, row.unloaded != true, passageIDs.insert(row.id).inserted, passageIDs.count <= 300_000 else { throw NativeReadingCopyPlan.invalid() }
                passages[section.chapterId]!.append(Passage(id: row.id, text: row.original, heading: row.source?.type == "heading"))
            }
        }
        guard !passageIDs.isEmpty, Set(passages.keys) == declared else { throw NativeReadingCopyPlan.invalid() }
        let localChapters = chapters.map { chapter in BookChapter(id: chapter.id, title: CloudShelfBook.title(chapter.title ?? .null), sourcePath: chapter.id, passages: passages[chapter.id]!) }
        let identity = CloudBookIdentity(ownerID: ownerID, bookID: bookId, contentVersion: contentVersion, sourceFormat: source?.format ?? "text")
        let metadata = CloudJSON.object(["bookId": .string(bookId), "contentVersion": .string(contentVersion), "readingStart": readingStart ?? .null])
        return CloudReadingCopy(identity: identity, title: CloudShelfBook.title(title ?? .null), author: author ?? fallbackAuthor, chapters: localChapters, content: content, readingStart: CloudReadingStartResolver.hint(from: metadata, identity: identity, chapters: localChapters))
    }
}
