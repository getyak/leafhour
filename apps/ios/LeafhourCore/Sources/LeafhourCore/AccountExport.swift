import Foundation

extension OfflineLibrary {
    /// All saved conversation drafts belong to this library's account directory;
    /// credentials live in Keychain and are never part of this directory.
    public func exportDeviceRecords(includeOriginals: Bool = false, settingsOnly: Bool = false, maximumBytes: Int = 512 * 1024 * 1024) throws -> CloudJSON {
        var total = 0
        func reserve(_ count: Int) throws { total += count; if total > maximumBytes { throw LibraryError.invalid("导出超过 512 MiB，请分批导出。") } }
        let encoder = JSONEncoder()
        var result: [String: CloudJSON] = ["preferences": try CloudJSON.decode(encoder.encode(readingPreferences()))]
        try reserve(encoder.encode(CloudJSON.object(result)).count)
        guard !settingsOnly else { return .object(result) }
        var entries: [CloudJSON] = [], drafts: [CloudJSON] = []
        for book in try books() {
            try Task.checkCancellation()
            var row: [String: CloudJSON] = ["book": try CloudJSON.decode(encoder.encode(book)), "state": try CloudJSON.decode(encoder.encode(state(book.id))), "readingTime": try CloudJSON.decode(encoder.encode(readingTimeLedger(bookID: book.id)))]
            if includeOriginals {
                let url = try originalURL(book.id), size = try Disk.size(url)
                guard size <= 256 * 1024 * 1024 else { throw LibraryError.invalid("原文件超过 256 MiB，请单独导出。") }
                try reserve(Int(size) * 4 / 3 + 4)
                row["originalBase64"] = .string(try Data(contentsOf: url).base64EncodedString())
            }
            let value = CloudJSON.object(row)
            // Count metadata as well, without counting source bytes twice.
            try reserve(encoder.encode(CloudJSON.object(row.filter { $0.key != "originalBase64" })).count)
            entries.append(value)
        }
        for file in try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isSymbolicLinkKey, .fileSizeKey]) {
            guard file.lastPathComponent.range(of: "^chat-[a-f0-9]{64}\\.json$", options: .regularExpression) != nil else { continue }
            let attributes = try file.resourceValues(forKeys: [.isSymbolicLinkKey, .fileSizeKey])
            guard attributes.isSymbolicLink != true else { throw LibraryError.invalid("对话草稿路径无法核对。") }
            try reserve((attributes.fileSize ?? 0) * 4 / 3 + 4)
            let data = try Data(contentsOf: file)
            // Preserve even an unreadable draft verbatim, so export never
            // silently drops the only recovery copy of a user's conversation.
            drafts.append(.object(["filename": .string(file.lastPathComponent), "base64": .string(data.base64EncodedString())]))
        }
        result["books"] = .array(entries); result["conversationDrafts"] = .array(drafts)
        return .object(result)
    }
}

extension CloudLibraryClient {
    /// Downloads independently checksummed book parts; never generates content.
    /// The generation fence spans the complete export, including final encoding.
    public func exportPersonalData(ownerID: String, includeOriginals: Bool = false, includeAudio: Bool = false) async throws -> CloudJSON {
        let generation = try readingDownloadGeneration(ownerID: ownerID)
        func read(_ path: String) async throws -> CloudJSON {
            try validateReadingDownload(ownerID: ownerID, generation: generation)
            let bytes = try await data(path: path, ownerID: ownerID, timeout: 180)
            try validateReadingDownload(ownerID: ownerID, generation: generation)
            return try CloudJSON.decode(bytes)
        }
        let account = try await read("/api/account/export")
        let manifest = try await read("/api/account/export/manifest")
        guard account["kind"].string == "leafhour-account-data", account["schemaVersion"].number == 1,
              manifest["kind"].string == "marginalia-export-manifest", manifest["schemaVersion"].number == 1,
              case .array(let manifestBooks) = manifest["books"], manifestBooks.count <= 1000 else { throw invalidExport() }
        var books: [CloudJSON] = [], originals: [CloudJSON] = [], audio: [CloudJSON] = [], seen = Set<String>()
        var total = try JSONEncoder().encode(account).count
        func reserve(_ count: Int) throws { total += count; if total > 512 * 1024 * 1024 { throw CloudRequestError(status: 413, message: "导出超过 512 MiB，请在本机分批导出。") } }
        for row in manifestBooks {
            guard let id = row["bookId"].string, !id.isEmpty, seen.insert(id).inserted, let version = row["contentVersion"].string else { throw invalidExport() }
            let base = "/api/library/books/" + CloudJSON.component(id)
            var offset = 0, snapshot: String?, bytes = Data(), expectedTotal: Int?
            repeat {
                let part = try await read(base + "/portability-part?offset=\(offset)" + (snapshot.map { "&snapshot=" + $0 } ?? ""))
                guard part["kind"].string == "marginalia-book-export-part", part["schemaVersion"].number == 1,
                      part["bookId"].string == id, part["contentVersion"].string == version,
                      part["offset"].number == Double(offset), let size = part["totalBytes"].number,
                      size >= 1, size <= Double(512 * 1024 * 1024), size.rounded() == size,
                      let digest = part["snapshot"].string, digest.count == 64,
                      snapshot == nil || snapshot == digest, expectedTotal == nil || expectedTotal == Int(size),
                      let encoded = part["data"].string, encoded.count <= 1_398_104,
                      let chunk = Data(base64Encoded: encoded), chunk.count == min(1_048_576, Int(size) - offset) else { throw invalidExport() }
                if offset == 0 { try reserve(Int(size)) }
                bytes.append(chunk); offset += chunk.count; snapshot = digest; expectedTotal = Int(size)
                guard part["nextOffset"] == (offset < Int(size) ? .number(Double(offset)) : .null) else { throw invalidExport() }
            } while offset < (expectedTotal ?? 0)
            guard Disk.hash(bytes) == snapshot else { throw invalidExport() }
            let entry = try CloudJSON.decode(bytes)
            guard entry["book"]["bookId"].string == id, entry["book"]["contentVersion"].string == version else { throw invalidExport() }
            books.append(entry)
            if includeOriginals, entry["book"]["visibility"].string == "private" {
                let info = try await read(base + "/original/info")
                guard info["available"] == .bool(true), let size = info["bytes"].number, size >= 1,
                      size <= Double(256 * 1024 * 1024), size.rounded() == size,
                      let digest = info["sha256"].string, digest.count == 64 else { throw invalidExport() }
                try reserve(Int(size) * 4 / 3 + 4)
                var raw = Data(), parts: [CloudJSON] = []; offset = 0
                repeat {
                    let part = try await read(base + "/portability-original?offset=\(offset)&sha256=" + digest)
                    guard part["offset"].number == Double(offset), part["totalBytes"].number == size,
                          part["sha256"].string == digest, let encoded = part["data"].string,
                          encoded.count <= 1_398_104, let chunk = Data(base64Encoded: encoded),
                          chunk.count == min(1_048_576, Int(size) - offset) else { throw invalidExport() }
                    raw.append(chunk); parts.append(.string(encoded)); offset += chunk.count
                    guard part["nextOffset"] == (offset < Int(size) ? .number(Double(offset)) : .null) else { throw invalidExport() }
                } while offset < Int(size)
                guard Disk.hash(raw) == digest else { throw invalidExport() }
                originals.append(.object(["bookId": .string(id), "filename": entry["book"]["source"]["filename"], "sha256": .string(digest), "bytes": .number(size), "partBytes": .number(1_048_576), "base64Parts": .array(parts)]))
            }
            if includeAudio {
                let value = try await read(base + "/audio/export")
                try reserve(JSONEncoder().encode(value).count)
                audio.append(.object(["bookId": .string(id), "backup": value]))
            }
        }
        try validateReadingDownload(ownerID: ownerID, generation: generation)
        var library: [String: CloudJSON] = ["kind": .string("leafhour-account-library"), "schemaVersion": .number(1), "exportedAt": manifest["exportedAt"], "books": .array(books), "includesOriginalFiles": .bool(false)]
        if manifest["readingPreferences"] != .null { library["readingPreferences"] = manifest["readingPreferences"] }
        return .object(["kind": .string("leafhour-personal-data"), "schemaVersion": .number(1), "account": account,
                        "library": .object(library),
                        "originals": .array(originals), "listening": .array(audio), "includes": .object(["originals": .bool(includeOriginals), "listening": .bool(includeAudio)])])
    }
    private func invalidExport() -> CloudRequestError { CloudRequestError(status: 409, message: "导出内容在读取期间发生变化或校验失败，未生成文件，请重试。") }
}
