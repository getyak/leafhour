import Foundation

public struct PendingChatVoiceCapture: Sendable {
    public let id: UUID
    public let source: URL
    public let metadata: Data
}

/// The original recording and its editable transcript have separate identities.
public struct ChatVoiceReceipt: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let mimeType: String
    public let bytes: Int
    public let sha256: String
    public let durationMs: Int
    public init(id: String, mimeType: String, bytes: Int, sha256: String, durationMs: Int) {
        self.id = id; self.mimeType = mimeType; self.bytes = bytes; self.sha256 = sha256; self.durationMs = durationMs
    }
    public var isValid: Bool {
        UUID(uuidString: id) != nil && ["audio/x-caf", "audio/mp4", "audio/wav"].contains(mimeType)
            && bytes >= 8 && bytes <= 256 * 1024 * 1024 && durationMs > 0
            && sha256.count == 64 && sha256.allSatisfy { $0.isHexDigit && !$0.isUppercase }
    }
}

public struct ChatVoiceComposition: Sendable {
    public private(set) var isRecording = false
    private var original = ""
    private var transcript = ""
    public init() { }
    public mutating func begin(draft: String) { original = draft; transcript = ""; isRecording = true }
    public mutating func transcribe(_ text: String) -> String {
        guard isRecording else { return combined }
        transcript = text; return combined
    }
    public mutating func cancel() -> String { isRecording = false; transcript = ""; return original }
    public mutating func finish() -> String { isRecording = false; return combined }
    private var combined: String { [original, transcript].filter { !$0.isEmpty }.joined(separator: "\n") }
}

extension OfflineLibrary {
    /// Account-local outbox, sealed before auth/network/draft restoration. A
    /// failed later retention still has an indexed original after relaunch.
    public func stageChatVoiceCapture(_ source: URL, id: UUID, ownerID: String, metadata: Data) throws -> URL {
        let folder = try voiceDirectory(ownerID: ownerID).appendingPathComponent("captures/" + id.uuidString.lowercased(), isDirectory: true)
        try Disk.directory(folder)
        let destination = folder.appendingPathComponent("original.caf")
        if source.standardizedFileURL != destination.standardizedFileURL {
            if Disk.fm.fileExists(atPath: destination.path) {
                guard try Disk.hashFile(source) == Disk.hashFile(destination) else { throw LibraryError.invalid("录音标识冲突，原件未覆盖。") }
            } else { try Disk.fm.copyItem(at: source, to: destination) }
        }
        try metadata.write(to: folder.appendingPathComponent("capture.json"), options: .atomic)
        return destination
    }
    public func pendingChatVoiceCaptures(ownerID: String) throws -> [PendingChatVoiceCapture] {
        let root = try voiceDirectory(ownerID: ownerID).appendingPathComponent("captures", isDirectory: true)
        guard Disk.fm.fileExists(atPath: root.path) else { return [] }
        return try Disk.fm.contentsOfDirectory(at: root, includingPropertiesForKeys: nil).sorted { $0.lastPathComponent < $1.lastPathComponent }.compactMap { folder in
            guard let id = UUID(uuidString: folder.lastPathComponent) else { return nil }
            let source = folder.appendingPathComponent("original.caf"), manifest = folder.appendingPathComponent("capture.json")
            guard Disk.fm.fileExists(atPath: source.path), Disk.fm.fileExists(atPath: manifest.path) else { return nil }
            return PendingChatVoiceCapture(id: id, source: source, metadata: try Data(contentsOf: manifest))
        }
    }
    public func removeStagedChatVoiceCapture(id: UUID, ownerID: String) throws {
        let folder = try voiceDirectory(ownerID: ownerID).appendingPathComponent("captures/" + id.uuidString.lowercased(), isDirectory: true)
        if Disk.fm.fileExists(atPath: folder.path) { try Disk.fm.removeItem(at: folder) }
    }

    private func voiceDirectory(ownerID: String) throws -> URL {
        guard let owner = UUID(uuidString: ownerID), root.lastPathComponent == LibraryScope.account(owner).folder else {
            throw LibraryError.invalid("这条语音不属于当前书房。")
        }
        let directory = root.appendingPathComponent("chat-voices", isDirectory: true)
        try Disk.directory(directory); return directory
    }
    public func retainChatVoice(_ source: URL, id: UUID, ownerID: String, durationMs: Int) throws -> ChatVoiceReceipt {
        let count = try Disk.size(source)
        let receipt = ChatVoiceReceipt(id: id.uuidString.lowercased(), mimeType: "audio/x-caf", bytes: Int(count), sha256: try Disk.hashFile(source), durationMs: durationMs)
        guard receipt.isValid else { throw LibraryError.invalid("录音信息无法核对，原录音仍保留。") }
        let destination = try voiceDirectory(ownerID: ownerID).appendingPathComponent(receipt.id + ".audio")
        if Disk.fm.fileExists(atPath: destination.path) {
            guard try Disk.hashFile(destination) == receipt.sha256 else { throw LibraryError.invalid("语音标识冲突，原录音未覆盖。") }
        } else { try Disk.fm.copyItem(at: source, to: destination) }
        return receipt
    }
    public func chatVoiceURL(_ receipt: ChatVoiceReceipt, ownerID: String) throws -> URL {
        guard receipt.isValid else { throw LibraryError.invalid("语音信息无效。") }
        let destination = try voiceDirectory(ownerID: ownerID).appendingPathComponent(receipt.id.lowercased() + ".audio")
        guard try Disk.size(destination) == receipt.bytes, try Disk.hashFile(destination) == receipt.sha256 else { throw LibraryError.invalid("语音原件暂不可用，请联网重新读取。") }
        return destination
    }
    public func cacheChatVoice(_ data: Data, receipt: ChatVoiceReceipt, ownerID: String) throws -> URL {
        guard receipt.isValid, data.count == receipt.bytes, Disk.hash(data) == receipt.sha256 else { throw LibraryError.invalid("语音下载校验失败。") }
        let destination = try voiceDirectory(ownerID: ownerID).appendingPathComponent(receipt.id.lowercased() + ".audio")
        try data.write(to: destination, options: .atomic); return destination
    }
}

extension CloudLibraryClient {
    public func uploadChatVoice(_ receipt: ChatVoiceReceipt, source: URL, ownerID: String) async throws -> ChatVoiceReceipt {
        let marker = try readingDownloadGeneration(ownerID: ownerID)
        guard receipt.isValid, try Disk.size(source) == receipt.bytes, try Disk.hashFile(source) == receipt.sha256 else { throw LibraryError.invalid("语音原件无法核对。") }
        let path = "/api/library/chat-voice/" + receipt.id
        let encoded = try JSONEncoder().encode(receipt)
        let plan = try CloudJSON.decode(await data(path: path + "/start", method: "POST", body: encoded, ownerID: ownerID))
        guard let count = plan["count"].number, let partBytes = plan["partBytes"].number, Int(partBytes) == 2 * 1024 * 1024,
              Int(count) == (receipt.bytes + Int(partBytes) - 1) / Int(partBytes) else { throw LibraryError.invalid("语音上传回执无法核对。") }
        let received = Set(plan["received"].array.compactMap { $0.number.map(Int.init) })
        let file = try FileHandle(forReadingFrom: source); defer { try? file.close() }
        for index in 0..<Int(count) where !received.contains(index) {
            try validateReadingDownload(ownerID: ownerID, generation: marker)
            try file.seek(toOffset: UInt64(index * Int(partBytes)))
            let part = try file.read(upToCount: Int(partBytes)) ?? Data()
            let body = try CloudJSON.encode(["index": .number(Double(index)), "base64": .string(part.base64EncodedString()), "sha256": .string(Disk.hash(part))])
            _ = try await data(path: path + "/part", method: "POST", body: body, ownerID: ownerID)
        }
        try validateReadingDownload(ownerID: ownerID, generation: marker)
        let completed = try JSONDecoder().decode(ChatVoiceReceipt.self, from: await data(path: path + "/complete", method: "POST", body: Data("{}".utf8), ownerID: ownerID))
        guard completed == receipt else { throw LibraryError.invalid("语音原件回执不一致。") }
        return completed
    }
    public func downloadChatVoice(_ receipt: ChatVoiceReceipt, ownerID: String) async throws -> Data {
        guard receipt.isValid else { throw LibraryError.invalid("语音信息无效。") }
        let marker = try readingDownloadGeneration(ownerID: ownerID), path = "/api/library/chat-voice/" + receipt.id
        let plan = try CloudJSON.decode(await data(path: path, ownerID: ownerID))
        let verified = try JSONDecoder().decode(ChatVoiceReceipt.self, from: JSONEncoder().encode(plan))
        guard verified == receipt, let count = plan["count"].number,
              Int(count) == (receipt.bytes + 2 * 1024 * 1024 - 1) / (2 * 1024 * 1024) else { throw LibraryError.invalid("语音来源无法核对。") }
        var original = Data()
        for index in 0..<Int(count) {
            try validateReadingDownload(ownerID: ownerID, generation: marker)
            original.append(try await data(path: path + "/parts/" + String(index), ownerID: ownerID))
            guard original.count <= receipt.bytes else { throw LibraryError.invalid("语音下载大小不一致。") }
        }
        try validateReadingDownload(ownerID: ownerID, generation: marker)
        guard original.count == receipt.bytes, Disk.hash(original) == receipt.sha256 else { throw LibraryError.invalid("语音原件校验失败。") }
        return original
    }
}
