import Foundation

/// One actor owns a profile's writes. Device-local and authenticated UUID namespaces never overlap.
public actor OfflineLibrary {
    private let root: URL
    private let limits: ImportLimits
    private struct CloudStartCache { var identity: CloudBookIdentity; var digest: String; var anchor: ReadingAnchor? }
    private var cloudStarts: [String: CloudStartCache] = [:]
    public init(root: URL, scope: LibraryScope, limits: ImportLimits = ImportLimits()) throws {
        guard limits.maximumFileBytes > 0, limits.maximumExpandedBytes > 0, limits.maximumEntryBytes > 0, limits.maximumEntries > 0 else { throw LibraryError.invalid("导入上限必须大于零。") }
        self.root = root.appendingPathComponent(scope.folder, isDirectory: true); self.limits = limits
        for name in ["books", "states", "imports", "staging"] { try Disk.directory(self.root.appendingPathComponent(name, isDirectory: true)) }
        try Self.recoverRepair(root: self.root)
        // A terminated process leaves a retained source and an honest interrupted job, never a complete book.
        let imports = self.root.appendingPathComponent("imports")
        for folder in try Disk.fm.contentsOfDirectory(at: imports, includingPropertiesForKeys: nil) {
            let file = folder.appendingPathComponent("job.json")
            if var job = try? Disk.read(ImportJob.self, from: file), job.phase == .processing {
                job.phase = .interrupted; job.error = "上次导入中断，原件已保留。可手动重试。"; try Disk.write(job, to: file)
            }
        }
    }
    public func importFile(_ url: URL) throws -> LocalBook {
        try Task.checkCancellation()
        let ext = url.pathExtension.lowercased()
        let kind: BookKind
        switch ext { case "epub": kind = .epub; case "pdf": kind = .pdf; case "txt": kind = .txt; case "md", "markdown": kind = .markdown; default: throw LibraryError.invalid("暂不支持这个文件格式。请选择 EPUB、PDF、TXT 或 Markdown。") }
        let size = try Disk.size(url)
        guard size > 0, size <= limits.maximumFileBytes else { throw LibraryError.invalid("文件为空或超过本机导入上限。原始文件未改动。") }
        if let available = try root.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]).volumeAvailableCapacityForImportantUsage, available < size * 2 + 20_000_000 { throw LibraryError.invalid("设备空间不足，请保留原件并释放空间后重试。") }
        let job = ImportJob(id: UUID(), filename: url.lastPathComponent, kind: kind, phase: .processing)
        let folder = importsFolder(job.id)
        try Disk.directory(folder)
        let original = folder.appendingPathComponent("source." + kind.rawValue)
        do {
            try Disk.write(job, to: folder.appendingPathComponent("job.json"))
            try Disk.fm.copyItem(at: url, to: original)
            guard try Disk.size(original) == size else { throw LibraryError.invalid("原件没有完整复制，请重新选择文件。") }
            return try process(job)
        } catch {
            try? recordFailure(job, error: error)
            throw error
        }
    }
    public func retry(_ id: UUID) throws -> LocalBook {
        var job = try Disk.read(ImportJob.self, from: importsFolder(id).appendingPathComponent("job.json"))
        guard job.id == id, job.phase != .complete else { throw LibraryError.invalid("此导入已完成或记录无效。") }
        job.phase = .processing; job.error = nil
        try Disk.write(job, to: importsFolder(id).appendingPathComponent("job.json"))
        do { return try process(job) } catch { try? recordFailure(job, error: error); throw error }
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
    private func process(_ initial: ImportJob) throws -> LocalBook {
        try Task.checkCancellation()
        var job = initial
        let original = try jobOriginalURL(job.id)
        guard try Disk.size(original) <= limits.maximumFileBytes else { throw LibraryError.invalid("原件超过导入上限。") }
        let id = try Disk.hashFile(original)
        let target = try bookDirectory(id)
        if Disk.fm.fileExists(atPath: target.path) {
            // Verify before reusing; do not replace a corrupt package or existing personal data implicitly.
            let existing = try book(id)
            job.phase = .complete; job.bookID = id; job.error = nil
            try Disk.write(job, to: importsFolder(job.id).appendingPathComponent("job.json"))
            try? Disk.fm.removeItem(at: original)
            return existing
        }
        let stage = root.appendingPathComponent("staging/" + job.id.uuidString, isDirectory: true)
        if Disk.fm.fileExists(atPath: stage.path) { try Disk.fm.removeItem(at: stage) }
        defer { try? Disk.fm.removeItem(at: stage) }
        let parsed = try build(source: original, kind: job.kind, filename: job.filename, id: id, destination: stage)
        try Task.checkCancellation()
        try Disk.fm.moveItem(at: stage, to: target)
        job.phase = .complete; job.bookID = id; job.error = nil
        // If this final job receipt fails, the complete book is still safely published and a retry deduplicates it.
        try Disk.write(job, to: importsFolder(job.id).appendingPathComponent("job.json"))
        try? Disk.fm.removeItem(at: original)
        return parsed
    }
    private func build(source: URL, kind: BookKind, filename: String, id: String, destination: URL) throws -> LocalBook {
        try Disk.directory(destination)
        let copy = destination.appendingPathComponent("source." + kind.rawValue)
        try Disk.fm.copyItem(at: source, to: copy)
        guard try Disk.hashFile(copy) == id else { throw LibraryError.invalid("原件复制校验失败。") }
        let book = try BookParser.parse(source: copy, kind: kind, filename: filename, id: id, destination: destination, limits: limits)
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
        try checkPackage(destination, id: id)
        return book
    }
    private func recordFailure(_ initial: ImportJob, error: Error) throws {
        var job = initial
        job.phase = error is CancellationError ? .cancelled : .failed
        job.error = error is CancellationError ? "导入已取消，原件仍保留，可稍后重试。" : error.localizedDescription
        try Disk.write(job, to: importsFolder(job.id).appendingPathComponent("job.json"))
    }
    public func bookDirectory(_ id: String) throws -> URL { try Disk.validID(id); return try Disk.url(root, "books/" + id) }
    public func originalURL(_ id: String) throws -> URL {
        let book = try book(id)
        return try Disk.url(bookDirectory(id), "source." + book.kind.rawValue)
    }
    public func book(_ id: String) throws -> LocalBook {
        let directory = try bookDirectory(id)
        let manifest = try checkPackage(directory, id: id)
        var book = try Disk.read(LocalBook.self, from: directory.appendingPathComponent("book.json"))
        guard book.id == id, book.sourceVersion == "sha256-" + id, !book.chapters.isEmpty else { throw LibraryError.invalid("书籍索引无效。原文件仍保留。") }
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
        return book
    }
    public func books() throws -> [LocalBook] {
        // Listing does not claim a new integrity pass. Opening/explicit verification hashes every file.
        try Disk.fm.contentsOfDirectory(at: root.appendingPathComponent("books"), includingPropertiesForKeys: nil).map { folder in
            let id = folder.lastPathComponent
            try Disk.validID(id)
            if let book = try? Disk.read(LocalBook.self, from: folder.appendingPathComponent("book.json")), book.id == id { return book }
            let kind = [BookKind.epub, .pdf, .txt, .markdown].first { Disk.fm.fileExists(atPath: folder.appendingPathComponent("source." + $0.rawValue).path) } ?? .unknown
            return LocalBook(id: id, title: "待修复的书籍", author: "", kind: kind, sourceVersion: "sha256-" + id, originalFilename: "Recovered." + kind.rawValue, importedAt: .distantPast, chapters: [])
        }.sorted { $0.importedAt > $1.importedAt }
    }

    @discardableResult public func verify(_ id: String) throws -> Bool { _ = try book(id); return true }
    @discardableResult private func checkPackage(_ folder: URL, id: String) throws -> OfflineManifest {
        let manifest = try Disk.read(OfflineManifest.self, from: folder.appendingPathComponent("manifest.json"))
        guard manifest.version == 1, manifest.bookID == id, !manifest.files.isEmpty, manifest.files.contains(where: { $0.path == "book.json" }), Set(manifest.files.map(\.path)).count == manifest.files.count else { throw LibraryError.invalid("离线清单不完整。") }
        var originalFound = false
        for file in manifest.files {
            try Task.checkCancellation()
            let url = try Disk.url(folder, file.path)
            guard file.bytes >= 0, try Disk.size(url) == file.bytes, try Disk.hashFile(url) == file.sha256 else { throw LibraryError.invalid("离线文件缺失或损坏，请从原件修复。") }
            if file.path.hasPrefix("source.") { guard file.sha256 == id else { throw LibraryError.invalid("原件版本不匹配。") }; originalFound = true }
        }
        guard originalFound else { throw LibraryError.invalid("离线清单缺少原件。") }
        return manifest
    }
    public func state(_ id: String) throws -> ReaderState {
        _ = try bookDirectory(id)
        guard Disk.fm.fileExists(atPath: try bookDirectory(id).appendingPathComponent("manifest.json").path) else { throw LibraryError.invalid("此书不属于当前书房。") }
        let url = root.appendingPathComponent("states/" + id + ".json")
        guard Disk.fm.fileExists(atPath: url.path) else { return ReaderState() }
        do { return try Disk.read(ReaderState.self, from: url) } catch { throw LibraryError.invalid("阅读记录无法读取，已保留原文件。请先导出恢复，勿重置。") }
    }
    public func saveState(_ state: ReaderState, bookID: String) throws {
        let directory = try bookDirectory(bookID)
        // Content was verified on open; avoid rehashing a 150 MB book on every keystroke.
        guard Disk.fm.fileExists(atPath: directory.appendingPathComponent("manifest.json").path) else { throw LibraryError.invalid("此书不属于当前书房。") }
        let book = try Disk.read(LocalBook.self, from: directory.appendingPathComponent("book.json"))
        func validate(_ anchor: ReadingAnchor) throws {
            guard let chapter = book.chapters.first(where: { $0.id == anchor.chapterID }), let passage = chapter.passages.first(where: { $0.id == anchor.passageID }), anchor.characterOffset >= 0, anchor.characterOffset <= passage.text.unicodeScalars.count, anchor.pageY?.isFinite != false else { throw LibraryError.invalid("引用与当前原文版本不匹配，未覆盖已有记录。") }
            if let y = anchor.resourceY {
                guard y.isFinite, (0...1).contains(y), passage.resourcePath != nil, book.kind != .pdf,
                      anchor.characterOffset == 0, anchor.pageY == nil else { throw LibraryError.invalid("插图位置与当前原文资源不匹配，未覆盖已有记录。") }
            }
        }
        if let anchor = state.anchor { try validate(anchor) }
        for (key, draft) in state.drafts { try validate(draft.anchor); guard key == draft.anchor.key else { throw LibraryError.invalid("草稿引用无效。") } }
        for note in state.notes { try validate(note.anchor) }
        guard (16...36).contains(state.preferences.fontSize), (4...18).contains(state.preferences.lineSpacing), ["paper", "night", "system"].contains(state.preferences.theme) else { throw LibraryError.invalid("阅读设置超出支持范围。") }
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
        guard Disk.fm.fileExists(atPath: folder.path), try Disk.size(source) <= limits.maximumFileBytes, try Disk.hashFile(source) == id else { throw LibraryError.invalid("所选原件与这本书的来源版本不一致，未覆盖原件或私人记录。") }
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
        guard try Disk.hashFile(source) == id else { throw LibraryError.invalid("原件本身已损坏，请重新选择原始文件修复。个人记录仍保留。") }
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
        let rebuilt = try build(source: source, kind: kind, filename: filename, id: id, destination: stage)
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
    public func cacheCloudPassage(_ passage: CloudJSON, bookID: String) throws {
        let book = try book(bookID)
        guard book.cloud != nil, let passageID = passage["id"].string, !passage["translations"].object.isEmpty else { throw LibraryError.invalid("译文缓存回执不完整。") }
        let folder = try bookDirectory(bookID)
        let content = try CloudJSON.decode(Data(contentsOf: folder.appendingPathComponent("cloud-content.json")))
        var found = false
        let sections = content["sections"].array.map { section -> CloudJSON in
            var object = section.object
            object["paragraphs"] = .array(section["paragraphs"].array.map { row in
                guard row["id"].string == passageID, row["original"].string == passage["original"].string else { return row }
                found = true; var changed = row.object; changed["translations"] = passage["translations"]; return .object(changed)
            })
            return .object(object)
        }
        guard found else { throw LibraryError.invalid("译文与当前离线原文版本不一致。") }
        var object = content.object; object["sections"] = .array(sections)
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
    public func cloudMetadata(_ bookID: String) throws -> CloudSyncMetadata {
        _ = try bookDirectory(bookID)
        let url = root.appendingPathComponent("states/" + bookID + "-sync.json")
        guard Disk.fm.fileExists(atPath: url.path) else { return CloudSyncMetadata() }
        return try Disk.read(CloudSyncMetadata.self, from: url)
    }
    public func saveCloudMetadata(_ metadata: CloudSyncMetadata, bookID: String) throws {
        _ = try bookDirectory(bookID)
        try Disk.write(metadata, to: root.appendingPathComponent("states/" + bookID + "-sync.json"))
    }
    public func cacheCloudView(_ name: String, data: Data) throws {
        guard ["shelf", "summary", "activity", "notebook", "workspace"].contains(name), root.lastPathComponent.hasPrefix("account-") else { throw LibraryError.invalid("书房缓存归属无效。") }
        try data.write(to: root.appendingPathComponent("cloud-" + name + ".json"), options: .atomic)
    }
    public func cloudView(_ name: String) throws -> Data? {
        guard ["shelf", "summary", "activity", "notebook", "workspace"].contains(name), root.lastPathComponent.hasPrefix("account-") else { return nil }
        let file = root.appendingPathComponent("cloud-" + name + ".json")
        return Disk.fm.fileExists(atPath: file.path) ? try Data(contentsOf: file) : nil
    }
    private func importsFolder(_ id: UUID) -> URL { root.appendingPathComponent("imports/" + id.uuidString, isDirectory: true) }
}
