import Foundation

/// An authorized source/index snapshot. This does not claim that every retained resource was verified.
public struct LocalReadingOpening: Sendable {
    public let book: LocalBook
    public let state: ReaderState
    public let original: URL
    public let directory: URL
    public let preparation: ReaderOpeningPreparation
    fileprivate let id: UUID
    fileprivate let profile: URL
    fileprivate let stamps: [String: Disk.FileStamp]
    fileprivate let indexDigest: String
}

public struct ReaderOpeningPreparation: Sendable {
    public let sourceLanguage: ReadingLanguage?
    public let verifiedResourcePaths: Set<String>
    /// Exact source window already prepared during the critical resource check.
    public let textWindow: ReadingTextWindow
}

public struct ReaderOpeningRecovery: Codable, Sendable {
    public let bookID: String
    public let sourceVersion: String
    public let indexDigest: String
    public let profile: String
    public let state: ReaderState
    public let recordedAt: Date
}

/// One actor owns a profile's writes. Device-local and authenticated UUID namespaces never overlap.
public actor OfflineLibrary {
    let root: URL
    private var activeImports: Set<UUID> = []
    private let limits: ImportLimits
    private struct CloudStartCache { var identity: CloudBookIdentity; var digest: String; var anchor: ReadingAnchor?; var stamp: Disk.FileStamp? = nil }
    private var cloudStarts: [String: CloudStartCache] = [:]
    private struct ListedIndexCache {
        let stamp: Disk.FileStamp
        let book: LocalBook
    }
    private var listedIndexes: [String: ListedIndexCache] = [:]
    private struct ReadingIndexCache {
        let stamps: [String: Disk.FileStamp]
        let book: LocalBook
        let language: ReadingLanguage?
    }
    private var readingIndexes: [String: ReadingIndexCache] = [:]
    private var readingOpenings: [String: UUID] = [:]
    private var rejectedReadingPackages: Set<String> = []
    private var readingOwners: [String: UUID] = [:]
    func claimReadingOwnership(_ id: String, token: UUID) { readingOwners[id] = token }
    func releaseReadingOwnership(_ id: String, token: UUID) { if readingOwners[id] == token { readingOwners[id] = nil } }
    func hasReadingOwnership(_ id: String) -> Bool { readingOwners[id] != nil }
    func savePulledStateIfUnchanged(_ state: ReaderState, bookID: String, expected: ReaderState) throws -> Bool {
        guard readingOwners[bookID] == nil else { return false }
        let metadata = try cloudMetadata(bookID)
        guard !metadata.positionConflict || metadata.explicitDeviceChoice == true else { return false }
        return try saveStateIfUnchanged(state, bookID: bookID, expected: expected)
    }
    public init(root: URL, scope: LibraryScope, limits: ImportLimits = ImportLimits()) throws {
        guard limits.maximumFileBytes > 0, limits.maximumExpandedBytes > 0, limits.maximumEntryBytes > 0, limits.maximumEntries > 0 else { throw LibraryError.invalid("导入上限必须大于零。") }
        self.root = root.appendingPathComponent(scope.folder, isDirectory: true); self.limits = limits
        for name in ["books", "states", "imports", "staging"] { try Disk.directory(self.root.appendingPathComponent(name, isDirectory: true)) }
        try Self.recoverRepair(root: self.root)
        try Self.recoverInterruptedReadingTimes(at: self.root)
        // A terminated process leaves a retained source and an honest interrupted job, never a complete book.
        let imports = self.root.appendingPathComponent("imports")
        for folder in try Disk.fm.contentsOfDirectory(at: imports, includingPropertiesForKeys: nil) {
            let file = folder.appendingPathComponent("job.json")
            if var job = try? Disk.read(ImportJob.self, from: file), job.phase == .processing {
                job.phase = .interrupted; job.error = "上次导入中断，原件已保留。可手动重试。"; try Disk.write(job, to: file)
            }
        }
    }
    public func importFile(_ url: URL, duplicatePolicy: DuplicateImportPolicy = .keep, operationID: UUID = UUID(), progress: @escaping @Sendable (ImportProgress) -> Void = { _ in }) async throws -> LocalBook {
        try Task.checkCancellation()
        let ext = url.pathExtension.lowercased()
        let kind: BookKind
        switch ext { case "epub": kind = .epub; case "pdf": kind = .pdf; case "txt": kind = .txt; case "md", "markdown": kind = .markdown; default: throw LibraryError.invalid("暂不支持这个文件格式。请选择 EPUB、PDF、TXT 或 Markdown。") }
        let size = try Disk.size(url)
        guard size > 0, size <= limits.maximumFileBytes else { throw LibraryError.invalid("文件为空或超过本机导入上限。原始文件未改动。") }
        if let available = try root.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]).volumeAvailableCapacityForImportantUsage, available < size * 2 + 20_000_000 { throw LibraryError.invalid("设备空间不足，请保留原件并释放空间后重试。") }
        let job = ImportJob(id: UUID(), filename: url.lastPathComponent, kind: kind, phase: .processing, duplicatePolicy: duplicatePolicy, operationID: operationID)
        activeImports.insert(job.id)
        defer { activeImports.remove(job.id) }
        progress(ImportProgress(stage: .retaining))
        let folder = importsFolder(job.id)
        try Disk.directory(folder)
        let original = folder.appendingPathComponent("source." + kind.rawValue)
        do {
            try Disk.write(job, to: folder.appendingPathComponent("job.json"))
            // Finish retaining the selected source even if cancellation arrives
            // during this copy, so the cancelled job really can retry offline.
            try await Task.detached(priority: .utility) { try Disk.fm.copyItem(at: url, to: original) }.value
            guard try Disk.size(original) == size else { throw LibraryError.invalid("原件没有完整复制，请重新选择文件。") }
            return try await process(job, progress: progress)
        } catch {
            try? recordFailure(job, error: error)
            throw error
        }
    }
    /// The record ID and verified source digest are separate for intentional copies.
    public func duplicate(for url: URL) async throws -> LocalBook? {
        let hash = try await Self.importWork { try Disk.hashFile(url) }
        return try duplicate(sourceDigest: hash)
    }
    private func duplicate(sourceDigest: String) throws -> LocalBook? {
        // Identity discovery is not an integrity pass. Damaged source/assets must
        // not prevent presenting a new independent import from a valid original.
        var candidates: [LocalBook] = []
        for folder in try Disk.fm.contentsOfDirectory(at: root.appendingPathComponent("books"), includingPropertiesForKeys: nil) {
            guard (try? Disk.validID(folder.lastPathComponent)) != nil else { continue }
            let index = folder.appendingPathComponent("book.json")
            guard let size = try? Disk.size(index), size <= limits.maximumExpandedBytes,
                  let value = try? Disk.read(LocalBook.self, from: index), value.id == folder.lastPathComponent,
                  value.cloud == nil, value.sourceVersion == "sha256-" + sourceDigest else { continue }
            candidates.append(value)
        }
        if let canonical = candidates.first(where: { $0.id == sourceDigest }) { return canonical }
        if let first = candidates.sorted(by: { $0.importedAt < $1.importedAt }).first { return first }
        return nil
    }
    private func expectedSourceDigest(_ folder: URL, id: String) throws -> String {
        if let manifest = try? Disk.read(OfflineManifest.self, from: folder.appendingPathComponent("manifest.json")),
           manifest.bookID == id, let source = manifest.files.first(where: { $0.path.hasPrefix("source.") }) {
            try Disk.validID(source.sha256)
            return source.sha256
        }
        // Legacy record IDs were the source hash: this fallback still verifies
        // exact original bytes, and cannot misidentify an independent copy.
        try Disk.validID(id)
        return id
    }
    public func retry(_ id: UUID, progress: @escaping @Sendable (ImportProgress) -> Void = { _ in }) async throws -> LocalBook {
        guard activeImports.insert(id).inserted else { throw LibraryError.invalid("此原件正在处理中，请稍候。") }
        defer { activeImports.remove(id) }
        var job = try Disk.read(ImportJob.self, from: importsFolder(id).appendingPathComponent("job.json"))
        guard job.id == id, job.phase != .complete else { throw LibraryError.invalid("此导入已完成或记录无效。") }
        job.phase = .processing; job.error = nil
        try Disk.write(job, to: importsFolder(id).appendingPathComponent("job.json"))
        do { return try await process(job, progress: progress) } catch { try? recordFailure(job, error: error); throw error }
    }
    public func jobs() throws -> [ImportJob] {
        try Disk.fm.contentsOfDirectory(at: root.appendingPathComponent("imports"), includingPropertiesForKeys: nil).compactMap { try? Disk.read(ImportJob.self, from: $0.appendingPathComponent("job.json")) }
    }
    public func jobOriginalURL(_ id: UUID) throws -> URL {
        let job = try Disk.read(ImportJob.self, from: importsFolder(id).appendingPathComponent("job.json"))
        guard job.id == id else { throw LibraryError.invalid("导入记录无效。") }
        let url = importsFolder(id).appendingPathComponent("source." + job.kind.rawValue)
        guard Disk.fm.fileExists(atPath: url.path) else { throw LibraryError.invalid("保留的原件暂不可用，请重新选择文件。") }
        return url
    }
    private func process(_ initial: ImportJob, progress: @escaping @Sendable (ImportProgress) -> Void = { _ in }) async throws -> LocalBook {
        try Task.checkCancellation()
        var job = initial
        let original = try jobOriginalURL(job.id)
        guard try Disk.size(original) <= limits.maximumFileBytes else { throw LibraryError.invalid("原件超过导入上限。") }
        let hash = try await Self.importWork { try Disk.hashFile(original) }
        let policy = job.duplicatePolicy ?? .keep
        let duplicate = policy == .new ? nil : try duplicate(sourceDigest: hash)
        let id = policy == .new ? Disk.hash(Data(("copy:" + (job.operationID ?? job.id).uuidString.lowercased()).utf8)) : duplicate?.id ?? hash
        try Task.checkCancellation()
        let target = try bookDirectory(id)
        if Disk.fm.fileExists(atPath: target.path) {
            // Verify before reusing; do not replace a corrupt package or existing personal data implicitly.
            let existing = try book(id)
            guard existing.sourceVersion == "sha256-" + hash else { throw LibraryError.invalid("此操作已用于另一份原件，未覆盖已有书籍。") }
            if policy == .replace { _ = try rebuild(id, source: original, kind: job.kind, filename: existing.originalFilename) }
            job.phase = .complete; job.bookID = id; job.error = nil
            try Disk.write(job, to: importsFolder(job.id).appendingPathComponent("job.json"))
            try? Disk.fm.removeItem(at: original)
            return existing
        }
        let stage = root.appendingPathComponent("staging/" + job.id.uuidString, isDirectory: true)
        if Disk.fm.fileExists(atPath: stage.path) { try Disk.fm.removeItem(at: stage) }
        defer { try? Disk.fm.removeItem(at: stage) }
        let limits = self.limits, kind = job.kind, filename = job.filename
        let parsed = try await Self.importWork {
            try Self.buildPackage(source: original, kind: kind, filename: filename, id: id, destination: stage, limits: limits, progress: progress)
        }
        try Task.checkCancellation()
        // Another job may have published identical bytes while this worker ran.
        // Publication stays serialized here; never replace personal state.
        if Disk.fm.fileExists(atPath: target.path) {
            let existing = try book(id)
            guard existing.sourceVersion == "sha256-" + hash else { throw LibraryError.invalid("此操作已用于另一份原件。") }
            job.phase = .complete; job.bookID = id; job.error = nil
            try Disk.write(job, to: importsFolder(job.id).appendingPathComponent("job.json"))
            try? Disk.fm.removeItem(at: original)
            return existing
        }
        try Disk.fm.moveItem(at: stage, to: target)
        job.phase = .complete; job.bookID = id; job.error = nil
        // If this final job receipt fails, the complete book is still safely published and a retry deduplicates it.
        try Disk.write(job, to: importsFolder(job.id).appendingPathComponent("job.json"))
        try? Disk.fm.removeItem(at: original)
        return parsed
    }
    private nonisolated static func importWork<T: Sendable>(_ operation: @escaping @Sendable () throws -> T) async throws -> T {
        let worker = Task.detached(priority: .utility) { try Task.checkCancellation(); return try operation() }
        return try await withTaskCancellationHandler { try await worker.value } onCancel: { worker.cancel() }
    }
    private func build(source: URL, kind: BookKind, filename: String, id: String, destination: URL, preservedTextBook: LocalBook? = nil, translationDefaultsVersion: Int? = 1) throws -> LocalBook {
        try Self.buildPackage(source: source, kind: kind, filename: filename, id: id, destination: destination, limits: limits, preservedTextBook: preservedTextBook, translationDefaultsVersion: translationDefaultsVersion)
    }
    private nonisolated static func buildPackage(source: URL, kind: BookKind, filename: String, id: String, destination: URL, limits: ImportLimits, progress: @Sendable (ImportProgress) -> Void = { _ in }, preservedTextBook: LocalBook? = nil, translationDefaultsVersion: Int? = 1) throws -> LocalBook {
        try Disk.directory(destination)
        let copy = destination.appendingPathComponent("source." + kind.rawValue)
        try Disk.fm.copyItem(at: source, to: copy)
        let sourceDigest = try Disk.hashFile(source)
        guard try Disk.hashFile(copy) == sourceDigest else { throw LibraryError.invalid("原件复制校验失败。") }
        var book = try preservedTextBook ?? BookParser.parse(source: copy, kind: kind, filename: filename, id: id, destination: destination, limits: limits, progress: progress)
        book.sourceVersion = "sha256-" + sourceDigest
        book.translationDefaultsVersion = translationDefaultsVersion
        progress(ImportProgress(stage: .verifying))
        try Task.checkCancellation()
        try Disk.write(book, to: destination.appendingPathComponent("book.json"))
        let keys: [URLResourceKey] = [.isRegularFileKey, .isSymbolicLinkKey]
        guard let files = Disk.fm.enumerator(atPath: destination.path) else { throw LibraryError.invalid("无法建立离线文件目录。") }
        var digests: [FileDigest] = []
        for case let path as String in files {
            let file = try Disk.url(destination, path)
            let values = try file.resourceValues(forKeys: Set(keys))
            guard values.isSymbolicLink != true else { throw LibraryError.invalid("离线文件含符号链接。") }
            if values.isRegularFile == true {
                digests.append(FileDigest(path: try Disk.safePath(path), sha256: try Disk.hashFile(file), bytes: try Disk.size(file)))
            }
        }
        let manifest = OfflineManifest(bookID: id, files: digests.sorted { $0.path < $1.path })
        try Disk.write(manifest, to: destination.appendingPathComponent("manifest.json"))
        try Self.verifyPackage(destination, id: id)
        return book
    }
    private func recordFailure(_ initial: ImportJob, error: Error) throws {
        var job = initial
        job.phase = error is CancellationError ? .cancelled : .failed
        job.error = error is CancellationError ? "导入已取消，原件仍保留，可稍后重试。" : error.localizedDescription
        try Disk.write(job, to: importsFolder(job.id).appendingPathComponent("job.json"))
    }
    public func bookDirectory(_ id: String) throws -> URL { try Disk.validID(id); return try Disk.url(root, "books/" + id) }
    public func localCoverURL(_ id: String) throws -> URL? {
        let directory = try bookDirectory(id)
        let book = try Disk.read(LocalBook.self, from: directory.appendingPathComponent("book.json"))
        guard book.cloud == nil, book.kind == .epub,
              let resource = book.coverResourcePath ?? BookParser.legacyCoverResource(for: book, directory: directory) else { return nil }
        let url = try Disk.url(directory.appendingPathComponent("assets"), resource)
        guard try Disk.size(url) <= 4 * 1024 * 1024 else { return nil }
        return url
    }
    public func originalURL(_ id: String) throws -> URL {
        let book = try book(id)
        return try Disk.url(bookDirectory(id), "source." + book.kind.rawValue)
    }
    public func readingOpening(_ id: String) throws -> LocalReadingOpening {
        let directory = try bookDirectory(id)
        // A failed deferred pass cannot be hidden by another fast opening. Only
        // a real full pass (after repair, if needed) releases the write barrier.
        if rejectedReadingPackages.contains(id) { _ = try book(id) }
        let manifestURL = try Disk.url(directory, "manifest.json"), manifestStamp = try Disk.fileStamp(manifestURL)
        let manifest = try Disk.read(OfflineManifest.self, from: manifestURL)
        guard manifest.version == 1, manifest.bookID == id, !manifest.files.isEmpty,
              Set(manifest.files.map(\.path)).count == manifest.files.count,
              let index = manifest.files.first(where: { $0.path == "book.json" }),
              let source = manifest.files.first(where: { $0.path.hasPrefix("source.") }) else { throw LibraryError.invalid("离线清单不完整，原件与记录仍保留。") }
        let criticalPaths = ["manifest.json", index.path, source.path]
        let stamps = try readingStamps(criticalPaths, directory: directory)
        guard stamps["manifest.json"] == manifestStamp else { throw LibraryError.invalid("离线清单在打开时发生变化，请重新打开。") }
        let value: LocalBook, language: ReadingLanguage?
        if let cached = readingIndexes[id], cached.stamps == stamps {
            value = cached.book; language = cached.language
        } else {
            readingIndexes[id] = nil
            try Self.verifyFile(index, directory: directory)
            try Self.verifyFile(source, directory: directory)
            value = try indexedBook(id, at: directory)
            guard value.id == id, !value.chapters.isEmpty,
                  source.path == "source." + value.kind.rawValue,
                  value.sourceVersion == "sha256-" + source.sha256 else { throw LibraryError.invalid("书籍索引与原件版本不匹配，原件与记录仍保留。") }
            if let identity = value.cloud {
                guard let owner = UUID(uuidString: identity.ownerID), root.lastPathComponent == "account-" + owner.uuidString.lowercased() else { throw LibraryError.invalid("这本书不属于当前账号。") }
            }
            language = ReadingLanguage.detect(in: value)
            guard try readingStamps(criticalPaths, directory: directory) == stamps else { throw LibraryError.invalid("书籍在打开时发生变化，请重新打开。") }
            if readingIndexes.count >= 4 { readingIndexes.removeAll() }
            readingIndexes[id] = ReadingIndexCache(stamps: stamps, book: value, language: language)
        }
        var prepared = value
        if let identity = value.cloud {
            prepared.readingStartAnchor = CloudReadingStartResolver.validated(value.readingStartAnchor.map { CloudReadingStartHint(identity: identity, anchor: $0) }, identity: identity, chapters: value.chapters)
            // Legacy hints are auxiliary cloud metadata, so verify their own
            // bytes before decoding rather than trusting the critical-file cache.
            if prepared.readingStartAnchor == nil, let file = manifest.files.first(where: { $0.path == "cloud-content.json" }) {
                let url = try Disk.url(directory, file.path), stamp = try Disk.fileStamp(url)
                let digest = file.sha256 + ":" + index.sha256
                if let cached = cloudStarts[id], cached.identity == identity, cached.digest == digest, cached.stamp == stamp { prepared.readingStartAnchor = cached.anchor }
                else {
                    try Self.verifyFile(file, directory: directory)
                    let anchor = CloudReadingStartResolver.legacy(at: url, identity: identity, chapters: value.chapters)
                    guard try Disk.fileStamp(url) == stamp else { throw LibraryError.invalid("书籍起始信息在打开时发生变化，请重新打开。") }
                    if cloudStarts.count >= 128 { cloudStarts.removeAll() }
                    cloudStarts[id] = CloudStartCache(identity: identity, digest: digest, anchor: anchor, stamp: stamp)
                    prepared.readingStartAnchor = anchor
                }
            }
        }
        let saved = try state(id)
        let anchor = saved.anchor ?? prepared.readingStartAnchor
        let chapter = anchor.flatMap { a in prepared.chapters.first { $0.id == a.chapterID } } ?? prepared.chapters[0]
        let textWindow = ReadingTextWindow(chapter: chapter, anchor: anchor)
        let resources = Set(textWindow.slices.compactMap { $0.original.resourcePath })
        for resource in resources {
            guard let file = manifest.files.first(where: { $0.path == "assets/" + resource }) else { throw LibraryError.invalid("当前书页资源没有校验记录，请从原件修复。") }
            try Self.verifyFile(file, directory: directory)
        }
        guard try readingStamps(criticalPaths, directory: directory) == stamps else { throw LibraryError.invalid("书籍在打开时发生变化，请重新打开。") }
        let marker = UUID(); readingOpenings[id] = marker
        return LocalReadingOpening(book: prepared, state: saved, original: try Disk.url(directory, source.path), directory: directory,
                                   preparation: ReaderOpeningPreparation(sourceLanguage: language, verifiedResourcePaths: resources, textWindow: textWindow), id: marker, profile: root, stamps: stamps, indexDigest: index.sha256)
    }
    /// Hashes every retained file off this actor so reading checkpoints do not
    /// queue behind the full-book pass. The receipt is bound to one opening.
    public func verifyReadingOpening(_ opening: LocalReadingOpening) async throws {
        let id = opening.book.id
        guard opening.profile == root, readingOpenings[id] == opening.id else { throw LibraryError.invalid("阅读校验已过期，未更新当前书籍。") }
        do {
            guard try readingStamps(Array(opening.stamps.keys), directory: opening.directory) == opening.stamps else { throw LibraryError.invalid("书籍原件或索引已变化，请重新打开。") }
            _ = try await Self.importWork { try Self.verifyPackage(opening.directory, id: id) }
            guard readingOpenings[id] == opening.id,
                  try readingStamps(Array(opening.stamps.keys), directory: opening.directory) == opening.stamps else { throw LibraryError.invalid("书籍在校验时发生变化，请重新打开。") }
            rejectedReadingPackages.remove(id)
        } catch {
            if !(error is CancellationError), readingOpenings[id] == opening.id {
                rejectedReadingPackages.insert(id); readingIndexes[id] = nil
            }
            throw error
        }
    }
    private func readingStamps(_ paths: [String], directory: URL) throws -> [String: Disk.FileStamp] {
        try Dictionary(uniqueKeysWithValues: paths.map { ($0, try Disk.fileStamp(Disk.url(directory, $0))) })
    }
    /// Preserve live work against the opening's original identity even when its
    /// current on-disk index no longer authorizes canonical record writes.
    public func retainReaderOpeningRecovery(_ state: ReaderState, opening: LocalReadingOpening) throws {
        guard opening.profile == root else { throw LibraryError.invalid("恢复记录不属于当前书房。") }
        let folder = try openingRecoveryDirectory(opening.book.id)
        try Disk.directory(folder)
        let value = ReaderOpeningRecovery(bookID: opening.book.id, sourceVersion: opening.book.sourceVersion, indexDigest: opening.indexDigest,
                                          profile: root.lastPathComponent, state: state, recordedAt: Date())
        // Unique receipts never overwrite a prior recovery or canonical state.
        try Disk.write(value, to: folder.appendingPathComponent(UUID().uuidString.lowercased() + ".json"))
    }
    public func readerOpeningRecoveries(_ id: String) throws -> [ReaderOpeningRecovery] {
        let folder = try openingRecoveryDirectory(id)
        guard Disk.fm.fileExists(atPath: folder.path) else { return [] }
        return try Disk.fm.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil).filter { $0.pathExtension == "json" }.map {
            let value = try Disk.read(ReaderOpeningRecovery.self, from: $0)
            guard value.bookID == id, value.profile == root.lastPathComponent else { throw LibraryError.invalid("恢复记录的书籍或账号不匹配，已保留文件。") }
            return value
        }.sorted { $0.recordedAt > $1.recordedAt }
    }
    private func openingRecoveryDirectory(_ id: String) throws -> URL {
        try Disk.validID(id)
        return try Disk.url(root, "states/" + id + "-opening-recovery")
    }
    private nonisolated static func verifyFile(_ file: FileDigest, directory: URL) throws {
        let url = try Disk.url(directory, file.path)
        guard file.bytes >= 0, try Disk.fileStamp(url).size == file.bytes, try Disk.hashFile(url) == file.sha256 else { throw LibraryError.invalid("离线文件缺失或损坏，请从原件修复。") }
    }
    public func book(_ id: String) throws -> LocalBook {
        let directory = try bookDirectory(id)
        let manifest = try checkPackage(directory, id: id)
        var book = try Disk.read(LocalBook.self, from: directory.appendingPathComponent("book.json"))
        guard book.id == id, book.sourceVersion == "sha256-" + (manifest.files.first(where: { $0.path == "source." + book.kind.rawValue })?.sha256 ?? ""), !book.chapters.isEmpty else { throw LibraryError.invalid("书籍索引无效。原文件仍保留。") }
        if let identity = book.cloud {
            guard let owner = UUID(uuidString: identity.ownerID), root.lastPathComponent == "account-" + owner.uuidString.lowercased() else {
                book.readingStartAnchor = nil
                return book
            }
            let current = CloudReadingStartResolver.validated(book.readingStartAnchor.map { CloudReadingStartHint(identity: identity, anchor: $0) }, identity: identity, chapters: book.chapters)
            book.readingStartAnchor = current
            if let current { book.readingStartAnchor = current }
            else if let file = manifest.files.first(where: { $0.path == "cloud-content.json" }) {
                let digest = file.sha256 + ":" + (manifest.files.first(where: { $0.path == "book.json" })?.sha256 ?? "")
                if let cached = cloudStarts[id], cached.identity == identity, cached.digest == digest { book.readingStartAnchor = cached.anchor }
                else {
                    let anchor = CloudReadingStartResolver.legacy(at: try Disk.url(directory, file.path), identity: identity, chapters: book.chapters)
                    if cloudStarts.count >= 128 { cloudStarts.removeAll() }
                    cloudStarts[id] = CloudStartCache(identity: identity, digest: digest, anchor: anchor)
                    book.readingStartAnchor = anchor
                }
            }
        }
        rejectedReadingPackages.remove(id)
        return book
    }
    public func books() throws -> [LocalBook] {
        // Listing does not claim a new integrity pass. Opening/explicit verification hashes every file.
        let folders = try Disk.fm.contentsOfDirectory(at: root.appendingPathComponent("books"), includingPropertiesForKeys: nil)
        let ids = Set(folders.map(\.lastPathComponent))
        listedIndexes = listedIndexes.filter { ids.contains($0.key) }
        return try folders.map { folder in
            let id = folder.lastPathComponent
            try Disk.validID(id)
            if let book = try? indexedBook(id, at: folder) { return book }
            let kind = [BookKind.epub, .pdf, .txt, .markdown].first { Disk.fm.fileExists(atPath: folder.appendingPathComponent("source." + $0.rawValue).path) } ?? .unknown
            return LocalBook(id: id, title: "待修复的书籍", author: "", kind: kind, sourceVersion: "sha256-" + id, originalFilename: "Recovered." + kind.rawValue, importedAt: .distantPast, chapters: [])
        }.sorted { $0.importedAt > $1.importedAt }
    }

    /// Decode an unchanged index once for listing and frequent durable state
    /// and reading-time saves. Opening/verify keep their full integrity checks.
    func indexedBook(_ id: String, at folder: URL) throws -> LocalBook {
        let file = try Disk.url(folder, "book.json"), stamp = try Disk.fileStamp(file)
        if let cached = listedIndexes[id], cached.stamp == stamp { return cached.book }
        // A damaged/replaced index must never revive an older cached anchor.
        listedIndexes[id] = nil
        let book = try Disk.read(LocalBook.self, from: file)
        guard book.id == id else { throw LibraryError.invalid("书籍索引与当前书房不匹配，未覆盖已有记录。") }
        listedIndexes[id] = ListedIndexCache(stamp: stamp, book: book)
        return book
    }

    @discardableResult public func verify(_ id: String) throws -> Bool { _ = try book(id); return true }
    @discardableResult private func checkPackage(_ folder: URL, id: String) throws -> OfflineManifest {
        try Self.verifyPackage(folder, id: id)
    }
    @discardableResult private nonisolated static func verifyPackage(_ folder: URL, id: String) throws -> OfflineManifest {
        let manifest = try Disk.read(OfflineManifest.self, from: folder.appendingPathComponent("manifest.json"))
        guard manifest.version == 1, manifest.bookID == id, !manifest.files.isEmpty, manifest.files.contains(where: { $0.path == "book.json" }), Set(manifest.files.map(\.path)).count == manifest.files.count else { throw LibraryError.invalid("离线清单不完整。") }
        let index = try Disk.read(LocalBook.self, from: folder.appendingPathComponent("book.json"))
        let sourceDigest = String(index.sourceVersion.dropFirst(7))
        try Disk.validID(sourceDigest)
        guard index.id == id, index.sourceVersion == "sha256-" + sourceDigest else { throw LibraryError.invalid("原件版本无效。") }
        var originalFound = false
        for file in manifest.files {
            try Task.checkCancellation()
            let url = try Disk.url(folder, file.path)
            guard file.bytes >= 0, try Disk.size(url) == file.bytes, try Disk.hashFile(url) == file.sha256 else { throw LibraryError.invalid("离线文件缺失或损坏，请从原件修复。") }
            if file.path.hasPrefix("source.") { guard file.path == "source." + index.kind.rawValue, file.sha256 == sourceDigest else { throw LibraryError.invalid("原件版本不匹配。") }; originalFound = true }
        }
        guard originalFound else { throw LibraryError.invalid("离线清单缺少原件。") }
        return manifest
    }
    public func state(_ id: String) throws -> ReaderState {
        let directory = try bookDirectory(id)
        guard Disk.fm.fileExists(atPath: directory.appendingPathComponent("manifest.json").path) else { throw LibraryError.invalid("此书不属于当前书房。") }
        let url = root.appendingPathComponent("states/" + id + ".json")
        let exists = Disk.fm.fileExists(atPath: url.path)
        var state: ReaderState
        do {
            if exists { state = try Disk.read(ReaderState.self, from: url) }
            else {
                state = ReaderState()
                state.translationDefaultsVersion = try indexedBook(id, at: directory).translationDefaultsVersion
            }
        }
        catch { throw LibraryError.invalid("阅读记录无法读取，已保留原文件。请先导出恢复，勿重置。") }
        state.preferences = try readerPreferences(legacy: exists ? state.preferences : nil)
        return state
    }
    public func saveState(_ state: ReaderState, bookID: String) throws {
        guard !rejectedReadingPackages.contains(bookID) else { throw LibraryError.invalid("此阅读副本未通过校验，已保留原件与已有记录。请先修复。") }
        let directory = try bookDirectory(bookID)
        // Content was verified on open; avoid rehashing a 150 MB book on every keystroke.
        guard Disk.fm.fileExists(atPath: directory.appendingPathComponent("manifest.json").path) else { throw LibraryError.invalid("此书不属于当前书房。") }
        let book = try indexedBook(bookID, at: directory)
        func validate(_ anchor: ReadingAnchor) throws {
            guard let chapter = book.chapters.first(where: { $0.id == anchor.chapterID }), let passage = chapter.passages.first(where: { $0.id == anchor.passageID }), anchor.characterOffset >= 0, anchor.characterOffset <= passage.text.unicodeScalars.count, anchor.pageY?.isFinite != false else { throw LibraryError.invalid("引用与当前原文版本不匹配，未覆盖已有记录。") }
            if let y = anchor.resourceY {
                guard y.isFinite, (0...1).contains(y), passage.resourcePath != nil, book.kind != .pdf,
                      anchor.characterOffset == 0, anchor.pageY == nil else { throw LibraryError.invalid("插图位置与当前原文资源不匹配，未覆盖已有记录。") }
            }
        }
        if let anchor = state.anchor { try validate(anchor) }
        for (key, draft) in state.drafts { try validate(draft.anchor); guard key == draft.id else { throw LibraryError.invalid("草稿引用无效。") } }
        for note in state.notes { try validate(note.anchor) }
        try Self.validateBookmarks(state.bookmarks ?? [], in: book)
        try Self.validateReaderPreferences(state.preferences)
        try Disk.write(state, to: root.appendingPathComponent("states/" + bookID + ".json"))
    }
    public func lastOpenedBook() throws -> String? {
        let url = root.appendingPathComponent("last-opened.json")
        guard Disk.fm.fileExists(atPath: url.path) else { return nil }
        let id = try Disk.read(String.self, from: url); try Disk.validID(id); return id
    }
    public func setLastOpenedBook(_ id: String) throws {
        guard Disk.fm.fileExists(atPath: try bookDirectory(id).appendingPathComponent("manifest.json").path) else { throw LibraryError.invalid("此书不属于当前书房。") }
        try Disk.write(id, to: root.appendingPathComponent("last-opened.json"))
    }
    public func repair(_ id: String, usingOriginal source: URL) throws -> LocalBook {
        let folder = try bookDirectory(id)
        guard Disk.fm.fileExists(atPath: folder.path), try Disk.size(source) <= limits.maximumFileBytes, try Disk.hashFile(source) == expectedSourceDigest(folder, id: id) else { throw LibraryError.invalid("所选原件与这本书的来源版本不一致，未覆盖原件或私人记录。") }
        let oldBook = try? Disk.read(LocalBook.self, from: folder.appendingPathComponent("book.json"))
        let ext = source.pathExtension.lowercased()
        let kind = oldBook?.kind ?? (ext == "md" ? .markdown : [BookKind.epub, .pdf, .txt, .markdown].first { $0.rawValue == ext })
        guard let kind, kind != .unknown else { throw LibraryError.invalid("无法确认原件格式。") }
        return try rebuild(id, source: source, kind: kind, filename: oldBook?.originalFilename ?? source.lastPathComponent)
    }
    public func repair(_ id: String) throws -> LocalBook {
        let folder = try bookDirectory(id)
        let kind = [BookKind.epub, .pdf, .txt, .markdown].first { Disk.fm.fileExists(atPath: folder.appendingPathComponent("source." + $0.rawValue).path) }
        guard let kind else { throw LibraryError.invalid("无法定位保留的原件，请重新选择原始文件修复。") }
        let source = try Disk.url(folder, "source." + kind.rawValue)
        guard try Disk.hashFile(source) == expectedSourceDigest(folder, id: id) else { throw LibraryError.invalid("原件本身已损坏，请重新选择原始文件修复。个人记录仍保留。") }
        let oldBook = try? Disk.read(LocalBook.self, from: folder.appendingPathComponent("book.json"))
        return try rebuild(id, source: source, kind: kind, filename: oldBook?.originalFilename ?? "Recovered." + kind.rawValue)
    }
    private func rebuild(_ id: String, source: URL, kind: BookKind, filename: String) throws -> LocalBook {
        try Self.recoverRepair(root: root)
        let folder = try bookDirectory(id)
        let transaction = RepairTransaction(bookID: id, stage: "staging/repair-" + UUID().uuidString, backup: "staging/backup-" + UUID().uuidString)
        let stage = try Disk.url(root, transaction.stage), backup = try Disk.url(root, transaction.backup)
        let journal = root.appendingPathComponent("repair-transaction.json")
        var journaled = false
        defer { if !journaled { try? Disk.fm.removeItem(at: stage) } }
        let preserved = verifiedTextIndex(at: folder, id: id, kind: kind)
        if (kind == .txt || kind == .markdown) && preserved == nil {
            throw LibraryError.invalid("原有文本索引无法验证，修复已停止，以免改变笔记和阅读位置。原件与记录仍保留；可在独立书房重新导入原件副本。")
        }
        let defaultsVersion = (try? Disk.read(LocalBook.self, from: folder.appendingPathComponent("book.json")))?.translationDefaultsVersion
        let rebuilt = try build(source: source, kind: kind, filename: filename, id: id, destination: stage, preservedTextBook: preserved, translationDefaultsVersion: defaultsVersion)
        try Task.checkCancellation()
        try Disk.write(transaction, to: journal)
        journaled = true
        do {
            try Disk.fm.moveItem(at: folder, to: backup)
            try Disk.fm.moveItem(at: stage, to: folder)
            try checkPackage(folder, id: id)
        } catch {
            if !Disk.fm.fileExists(atPath: folder.path), Disk.fm.fileExists(atPath: backup.path) { try? Disk.fm.moveItem(at: backup, to: folder) }
            // Keep journal and sources for startup recovery rather than deleting ambiguous state.
            throw error
        }
        try? Disk.fm.removeItem(at: backup)
        try Disk.fm.removeItem(at: journal)
        return rebuilt
    }
    /// A repair rebuilds packaging, not a saved text book's chapter/passage identities.
    /// Only reuse an index whose bytes still match its manifest; otherwise repair must stop.
    private func verifiedTextIndex(at folder: URL, id: String, kind: BookKind) -> LocalBook? {
        guard kind == .txt || kind == .markdown else { return nil }
        let indexURL = folder.appendingPathComponent("book.json")
        guard let manifest = try? Disk.read(OfflineManifest.self, from: folder.appendingPathComponent("manifest.json")),
              manifest.version == 1, manifest.bookID == id,
              let index = manifest.files.first(where: { $0.path == "book.json" }),
              (try? Disk.size(indexURL)) == index.bytes, (try? Disk.hashFile(indexURL)) == index.sha256,
              let book = try? Disk.read(LocalBook.self, from: indexURL), book.id == id,
              book.kind == kind, book.cloud == nil, book.sourceVersion == "sha256-" + (manifest.files.first(where: { $0.path == "source." + kind.rawValue })?.sha256 ?? ""),
              !book.chapters.isEmpty, book.chapters.allSatisfy({ !$0.passages.isEmpty }),
              Set(book.chapters.map(\.id)).count == book.chapters.count else { return nil }
        let passageIDs = book.chapters.flatMap { $0.passages.map(\.id) }
        guard Set(passageIDs).count == passageIDs.count else { return nil }
        return book
    }
    private struct RepairTransaction: Codable { var bookID: String; var stage: String; var backup: String }
    private static func recoverRepair(root: URL) throws {
        let journal = root.appendingPathComponent("repair-transaction.json")
        guard Disk.fm.fileExists(atPath: journal.path) else { return }
        let transaction = try Disk.read(RepairTransaction.self, from: journal)
        try Disk.validID(transaction.bookID)
        guard transaction.backup.hasPrefix("staging/backup-"), transaction.stage.hasPrefix("staging/repair-") else { throw LibraryError.invalid("修复事务路径无效，已保留原件。") }
        let target = try Disk.url(root, "books/" + transaction.bookID), backup = try Disk.url(root, transaction.backup)
        if !Disk.fm.fileExists(atPath: target.path) {
            guard Disk.fm.fileExists(atPath: backup.path) else { throw LibraryError.invalid("修复中断，未能定位原件。请保留本机数据并导出恢复。") }
            try Disk.fm.moveItem(at: backup, to: target)
        }
        // Leftover stage/backup copies are deliberately preserved after a crash.
        try Disk.fm.removeItem(at: journal)
    }
    /// A cloud copy contains extracted text and its web IDs; it never masquerades as the uploaded original.
    public func importCloud(_ copy: CloudReadingCopy, replaceExisting: Bool = false) throws -> LocalBook {
        try Task.checkCancellation()
        guard let owner = UUID(uuidString: copy.identity.ownerID), root.lastPathComponent == "account-" + owner.uuidString.lowercased(), !copy.chapters.isEmpty,
              Set(copy.chapters.map(\.id)).count == copy.chapters.count,
              Set(copy.chapters.flatMap { $0.passages.map(\.id) }).count == copy.chapters.reduce(0, { $0 + $1.passages.count }) else { throw LibraryError.invalid("离线副本不属于当前书房或章节标识不完整。") }
        let header = "Leafhour 正文离线副本\n\(copy.title)\n\(copy.author)\n书籍：\(copy.identity.bookID)\n版本：\(copy.identity.contentVersion)\n\n"
        let source = Data((header + copy.chapters.map { $0.title + "\n\n" + $0.passages.map(\.text).joined(separator: "\n\n") }.joined(separator: "\n\n")).utf8)
        let id = Disk.hash(source), target = try bookDirectory(id)
        if Disk.fm.fileExists(atPath: target.path) && !replaceExisting {
            let existing = try book(id)
            guard existing.cloud == copy.identity else { throw LibraryError.invalid("离线副本身份不一致，已有记录仍保留。") }
            return existing
        }
        let stage = root.appendingPathComponent("staging/repair-cloud-" + UUID().uuidString)
        try Disk.directory(stage)
        defer { try? Disk.fm.removeItem(at: stage) }
        try source.write(to: stage.appendingPathComponent("source.txt"), options: .atomic)
        try copy.content.write(to: stage.appendingPathComponent("cloud-content.json"), options: .atomic)
        var value = LocalBook(id: id, title: copy.title, author: copy.author, kind: .txt, sourceVersion: "sha256-" + id, originalFilename: "Leafhour-reading-copy.txt", importedAt: Date(), chapters: copy.chapters)
        value.cloud = copy.identity
        if Disk.fm.fileExists(atPath: target.path) {
            value.translationDefaultsVersion = (try? indexedBook(id, at: target))?.translationDefaultsVersion
        }
        value.readingStartAnchor = CloudReadingStartResolver.validated(copy.readingStart, identity: copy.identity, chapters: copy.chapters)
        try Disk.write(value, to: stage.appendingPathComponent("book.json"))
        var digests: [FileDigest] = []
        for name in ["source.txt", "book.json", "cloud-content.json"] {
            let file = stage.appendingPathComponent(name)
            digests.append(FileDigest(path: name, sha256: try Disk.hashFile(file), bytes: try Disk.size(file)))
        }
        try Disk.write(OfflineManifest(bookID: id, files: digests), to: stage.appendingPathComponent("manifest.json"))
        try checkPackage(stage, id: id)
        // Cancellation remains cooperative until the atomic publication begins.
        // Once published, the verified copy and its personal state remain intact.
        try Task.checkCancellation()
        if Disk.fm.fileExists(atPath: target.path) { try publishCloudStage(stage, bookID: id) }
        else { try Disk.fm.moveItem(at: stage, to: target) }
        return value
    }
    public func readingTranslations(bookID: String, targetLanguage: ReadingLanguage = .zh) throws -> [String: ReadingTranslation] {
        if targetLanguage != .zh { return try cachedLanguageTranslations(bookID: bookID, language: targetLanguage) }
        let book = try book(bookID)
        guard let identity = book.cloud else { return [:] }
        let folder = try bookDirectory(bookID)
        let content = try CloudJSON.decode(Data(contentsOf: folder.appendingPathComponent("cloud-content.json")))
        guard content["contentVersion"].string == identity.contentVersion else { throw LibraryError.invalid("离线译文版本无法核对。") }
        var rows: [String: ReadingTranslation] = [:]
        for row in content["sections"].array.flatMap({ $0["paragraphs"].array }) {
            if let id = row["id"].string, let translation = ReadingTranslation(row) { rows[id] = translation }
        }
        return rows
    }
    public func pendingReadingTranslation(bookID: String, targetLanguage: ReadingLanguage = .zh) throws -> Data? {
        _ = try book(bookID)
        let file = root.appendingPathComponent("states/" + bookID + "-translation-run" + (targetLanguage == .zh ? "" : "-" + targetLanguage.rawValue) + ".json")
        guard Disk.fm.fileExists(atPath: file.path) else { return nil }
        guard try Disk.size(file) <= 8 * 1024 * 1024 else { throw LibraryError.invalid("预译恢复记录过大，请先保留并核对。") }
        return try Data(contentsOf: file)
    }
    public func savePendingReadingTranslation(_ data: Data?, bookID: String, targetLanguage: ReadingLanguage = .zh) throws {
        _ = try book(bookID)
        let file = root.appendingPathComponent("states/" + bookID + "-translation-run" + (targetLanguage == .zh ? "" : "-" + targetLanguage.rawValue) + ".json")
        if let data {
            guard data.count <= 8 * 1024 * 1024 else { throw LibraryError.invalid("预译恢复记录超过容量，尚未提交后续段落。") }
            try data.write(to: file, options: .atomic)
        } else if Disk.fm.fileExists(atPath: file.path) { try Disk.fm.removeItem(at: file) }
    }
    public func cacheCloudPassage(_ passage: CloudJSON, bookID: String, targetLanguage: ReadingLanguage = .zh) throws { try cacheCloudPassages([passage], bookID: bookID, targetLanguage: targetLanguage) }
    public func cacheCloudPassages(_ passages: [CloudJSON], bookID: String, targetLanguage: ReadingLanguage = .zh) throws {
        if targetLanguage != .zh { try cacheLanguageTranslations(passages, bookID: bookID, language: targetLanguage); return }
        guard !passages.isEmpty else { return }
        let book = try book(bookID)
        var updates: [String: CloudJSON] = [:]
        for passage in passages {
            guard book.cloud != nil, let id = passage["id"].string, !passage["translations"].object.isEmpty, updates[id] == nil else { throw LibraryError.invalid("译文缓存回执不完整。") }
            updates[id] = passage
        }
        let folder = try bookDirectory(bookID)
        let content = try CloudJSON.decode(Data(contentsOf: folder.appendingPathComponent("cloud-content.json")))
        var found = Set<String>()
        let sections = content["sections"].array.map { section -> CloudJSON in
            var object = section.object
            object["paragraphs"] = .array(section["paragraphs"].array.map { row in
                guard let id = row["id"].string, let passage = updates[id], row["original"].string == passage["original"].string else { return row }
                found.insert(id)
                var changed = row.object, translations = row["translations"].object
                for variant in ["literal", "interpretive"] {
                    let incoming = passage["translations"][variant], prior = translations[variant] ?? .null
                    guard let text = incoming["text"].string, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { continue }
                    if prior["status"].string == "reviewed", incoming["status"].string != "reviewed" { continue }
                    if let oldDate = prior["createdAt"].string, let newDate = incoming["createdAt"].string, oldDate > newDate { continue }
                    translations[variant] = incoming
                }
                changed["translations"] = .object(translations)
                return .object(changed)
            })
            return .object(object)
        }
        guard found.count == updates.count else { throw LibraryError.invalid("译文与当前离线原文版本不一致。") }
        var object = content.object; object["sections"] = .array(sections)
        guard object["sections"] != content["sections"] else { return }
        let stage = root.appendingPathComponent("staging/repair-cloud-cache-" + UUID().uuidString)
        try Disk.fm.copyItem(at: folder, to: stage)
        defer { try? Disk.fm.removeItem(at: stage) }
        let updated = stage.appendingPathComponent("cloud-content.json")
        try JSONEncoder().encode(CloudJSON.object(object)).write(to: updated, options: .atomic)
        var manifest = try Disk.read(OfflineManifest.self, from: stage.appendingPathComponent("manifest.json"))
        guard let index = manifest.files.firstIndex(where: { $0.path == "cloud-content.json" }) else { throw LibraryError.invalid("离线清单没有译文缓存。") }
        manifest.files[index] = FileDigest(path: "cloud-content.json", sha256: try Disk.hashFile(updated), bytes: try Disk.size(updated))
        try Disk.write(manifest, to: stage.appendingPathComponent("manifest.json"))
        try checkPackage(stage, id: bookID)
        try publishCloudStage(stage, bookID: bookID)
    }
    private func publishCloudStage(_ stage: URL, bookID: String) throws {
        try Self.recoverRepair(root: root)
        let target = try bookDirectory(bookID), backup = root.appendingPathComponent("staging/backup-" + UUID().uuidString)
        let journal = root.appendingPathComponent("repair-transaction.json")
        let transaction = RepairTransaction(bookID: bookID, stage: "staging/" + stage.lastPathComponent, backup: "staging/" + backup.lastPathComponent)
        try Disk.write(transaction, to: journal)
        do {
            try Disk.fm.moveItem(at: target, to: backup)
            try Disk.fm.moveItem(at: stage, to: target)
            try checkPackage(target, id: bookID)
        } catch {
            if !Disk.fm.fileExists(atPath: target.path) { try? Disk.fm.moveItem(at: backup, to: target) }
            throw error
        }
        try? Disk.fm.removeItem(at: backup); try Disk.fm.removeItem(at: journal)
    }
    /// Recovery is additive and scoped to this account/book. A failed write stops
    /// reconciliation before the only copy of an unsynced checkpoint is replaced.
    public func retainPositionRecovery(_ position: ReadingPositionRecovery, bookID: String) throws {
        _ = try book(bookID)
        let directory = root.appendingPathComponent("position-recovery/" + bookID)
        try Disk.fm.createDirectory(at: directory, withIntermediateDirectories: true)
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        let bytes = try encoder.encode(position)
        let file = directory.appendingPathComponent(Disk.hash(bytes) + ".json")
        if !Disk.fm.fileExists(atPath: file.path) { try bytes.write(to: file, options: .atomic) }
    }
    public func positionRecoveries(_ bookID: String) throws -> [ReadingPositionRecovery] {
        _ = try book(bookID)
        let directory = root.appendingPathComponent("position-recovery/" + bookID)
        guard Disk.fm.fileExists(atPath: directory.path) else { return [] }
        return try Disk.fm.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" }.map { try Disk.read(ReadingPositionRecovery.self, from: $0) }
    }
    public func cloudMetadata(_ bookID: String) throws -> CloudSyncMetadata {
        _ = try bookDirectory(bookID)
        let url = root.appendingPathComponent("states/" + bookID + "-sync.json")
        guard Disk.fm.fileExists(atPath: url.path) else { return CloudSyncMetadata() }
        return try Disk.read(CloudSyncMetadata.self, from: url)
    }
    /// A reader-first opening defers a remote anchor to the existing explicit
    /// choice UI. This atomic metadata edit never rewrites notes or progress.
    public func requireDeferredPositionChoice(_ bookID: String) throws -> CloudSyncMetadata {
        var metadata = try cloudMetadata(bookID)
        if let remote = metadata.remoteAnchor, remote != (try state(bookID)).anchor {
            metadata.positionConflict = true
            try saveCloudMetadata(metadata, bookID: bookID)
        }
        return metadata
    }
    public func saveCloudMetadata(_ metadata: CloudSyncMetadata, bookID: String) throws {
        _ = try bookDirectory(bookID)
        try Disk.write(metadata, to: root.appendingPathComponent("states/" + bookID + "-sync.json"))
    }
    /// The choice UI may publish while a request is suspended. Merge its current
    /// position fields atomically instead of replacing them with that request's
    /// older snapshot. Explicit position resolution uses the ordinary writer.
    func saveSynchronizationMetadata(_ incoming: CloudSyncMetadata, bookID: String, preservePositionChoice: Bool) throws -> CloudSyncMetadata {
        var value = incoming
        let current = try cloudMetadata(bookID)
        if preservePositionChoice, current.positionConflict, current.explicitDeviceChoice != true {
            value.positionConflict = true
            value.positionRevision = current.positionRevision
            value.lastSyncedAnchor = current.lastSyncedAnchor
            value.lastSyncedActivityAt = current.lastSyncedActivityAt
            value.lastSyncedViewMode = current.lastSyncedViewMode
            value.lastSyncedTranslationVariant = current.lastSyncedTranslationVariant
            value.explicitDeviceChoice = current.explicitDeviceChoice
            if (current.remotePositionRevision ?? -1) >= (value.remotePositionRevision ?? -1) {
                value.remoteAnchor = current.remoteAnchor; value.remotePositionRevision = current.remotePositionRevision; value.remoteActivityAt = current.remoteActivityAt
            }
            if value.lastError == nil { value.lastError = "阅读位置在另一台设备有更新，请选择从哪里继续。" }
        }
        try saveCloudMetadata(value, bookID: bookID)
        return value
    }
    public func cacheCloudView(_ name: String, data: Data) throws {
        guard ["shelf", "summary", "activity", "notebook", "workspace", "journal"].contains(name), root.lastPathComponent.hasPrefix("account-") else { throw LibraryError.invalid("书房缓存归属无效。") }
        try data.write(to: root.appendingPathComponent("cloud-" + name + ".json"), options: .atomic)
    }
    public func cloudView(_ name: String) throws -> Data? {
        guard ["shelf", "summary", "activity", "notebook", "workspace", "journal"].contains(name), root.lastPathComponent.hasPrefix("account-") else { return nil }
        let file = root.appendingPathComponent("cloud-" + name + ".json")
        return Disk.fm.fileExists(atPath: file.path) ? try Data(contentsOf: file) : nil
    }
    private func importsFolder(_ id: UUID) -> URL { root.appendingPathComponent("imports/" + id.uuidString, isDirectory: true) }
}
