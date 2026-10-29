import Foundation
import UIKit
import Observation
import LeafhourCore

/// Synthetic local acceptance only. Production bundles cannot opt into this factory.
enum VideoAcceptanceFixture {
    @MainActor static func makeModelIfRequested() -> LibraryModel? {
        #if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        guard Bundle.main.bundleIdentifier == "org.leafhour.get317.testing" else { return nil }
        let hostedUnitTest = ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
            || NSClassFromString("XCTestCase") != nil || NSClassFromString("XCTest.XCTestCase") != nil
        guard arguments.contains("--get317-acceptance") || hostedUnitTest else { return nil }
        do {
            let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            let root = support.appendingPathComponent("GET317Acceptance", isDirectory: true)
            if arguments.contains("--get317-reset"), FileManager.default.fileExists(atPath: root.path) {
                // This exact child is the only location the reset flag can remove.
                guard root.lastPathComponent == "GET317Acceptance", root.deletingLastPathComponent() == support else {
                    preconditionFailure("GET317 fixture root failed its isolation check")
                }
                try FileManager.default.removeItem(at: root)
            }
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            try prepareSystemPickerDocuments()
            GET317Transport.configure(root: root, arguments: arguments)
            let configuration = URLSessionConfiguration.ephemeral
            configuration.protocolClasses = [GET317Transport.self]
            configuration.urlCache = nil
            let credential = CloudCredential(account: CloudAccount(id: GET317Transport.owner, email: "get317-synthetic@example.invalid"), token: "get317-isolated-fixture")
            let cloud = CloudLibraryClient(baseURL: URL(string: "https://fixture.invalid")!, credential: credential, configuration: configuration)
            // Supplying both objects bypasses credential-store reads and writes.
            let model = LibraryModel(root: root.appendingPathComponent("library", isDirectory: true), cloud: cloud, credential: credential, monitorNetwork: false)
            if arguments.contains("--get317-gated-download") { observeReaderForDownloadGate(model) }
            Task { @MainActor in
                do {
                    let marker = root.appendingPathComponent("seed-v1.complete")
                    if !FileManager.default.fileExists(atPath: marker.path) {
                        guard let library = model.library else { throw LibraryError.invalid("GET317 合成书房未能打开") }
                        let sources = root.appendingPathComponent("sources", isDirectory: true)
                        try FileManager.default.createDirectory(at: sources, withIntermediateDirectories: true)
                        let text = sources.appendingPathComponent("GET317 合成验收 · 本机文本.txt")
                        let paragraphs = (1...35).map { index in
                            "GET317 synthetic paragraph \(index). This is invented acceptance material, not an uploaded book. A quiet reader keeps the selected words and the saved position together. The searchable marker ORCHARD_\(index) identifies this paragraph. " + String(repeating: "Reading this invented passage should not move another book's position. ", count: 3)
                        }
                        try Data(paragraphs.joined(separator: "\n\n").utf8).write(to: text, options: .atomic)
                        _ = try await library.importFile(text)
                        let markdown = sources.appendingPathComponent("GET317 合成验收 · Markdown.md")
                        let markdownText = "# GET317 synthetic Markdown\n\nAll material in this fixture is invented for UI acceptance.\n\n## A small orchard\n\nThe **bold orchard** and the *quiet river* are synthetic examples.\n\n- A synthetic first item\n- A synthetic second item\n\n" + paragraphs.prefix(8).joined(separator: "\n\n")
                        try Data(markdownText.utf8).write(to: markdown, options: .atomic)
                        _ = try await library.importFile(markdown)
                        let pdf = sources.appendingPathComponent("GET317 合成验收 · PDF.pdf")
                        let format = UIGraphicsPDFRendererFormat()
                        format.documentInfo = [kCGPDFContextTitle as String: "GET317 合成验收 · PDF", kCGPDFContextAuthor as String: "GET317 合成作者 PDF"]
                        let renderer = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 420, height: 595), format: format)
                        try renderer.writePDF(to: pdf) { context in
                            for page in 1...3 {
                                context.beginPage()
                                let content = "GET317 SYNTHETIC PDF\nPage \(page) of 3\n\nThis page is invented acceptance material.\nNo user book was copied.\n\n" + (page == 3 ? "GET317_SYNTHETIC_PDF_LAST_PAGE" : "GET317_SYNTHETIC_PDF_PAGE_\(page)")
                                (content as NSString).draw(in: CGRect(x: 36, y: 48, width: 348, height: 480), withAttributes: [.font: UIFont.systemFont(ofSize: 20), .foregroundColor: UIColor.black])
                            }
                        }
                        _ = try await library.importFile(pdf)
                        let remote = CloudShelfBook(id: "get317-translated", title: "GET317 合成验收 · 双译", author: "GET317 合成作者甲", contentVersion: "get317-v1")
                        let copy = try await cloud.downloadReadingCopy(remote, ownerID: GET317Transport.owner)
                        _ = try await library.importCloud(copy)
                        try Data("Synthetic acceptance seeded through OfflineLibrary v1".utf8).write(to: marker, options: .atomic)
                    }
                    await model.reload()
                    await model.synchronize()
                } catch {
                    model.message = "GET317 合成验收夹具未准备完成：" + error.localizedDescription
                }
            }
            return model
        } catch {
            // Never fall back to a real-account model after an opted-in fixture fails.
            preconditionFailure("GET317 isolated fixture could not initialize: \(error.localizedDescription)")
        }
        #else
        return nil
        #endif
    }

    #if DEBUG
    @MainActor private static func prepareSystemPickerDocuments() throws {
        let documents = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let sources = documents.appendingPathComponent("GET317AcceptanceSources", isDirectory: true)
        let exports = documents.appendingPathComponent("GET317AcceptanceExports", isDirectory: true)
        try FileManager.default.createDirectory(at: sources, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: exports, withIntermediateDirectories: true)
        let selectedFile = sources.appendingPathComponent("GET317-System-Picker-Import.txt")
        let bytes = Data("GET317_SYSTEM_PICKER_IMPORT_SUCCESS\n\nThis synthetic source is prepared for the real system Files picker. The fixture must not import this file into OfflineLibrary. Only the user-facing import action may create its readable book.\n\nGET317_SYSTEM_PICKER_IMPORT_END".utf8)
        if FileManager.default.fileExists(atPath: selectedFile.path) {
            guard try Data(contentsOf: selectedFile) == bytes else { throw LibraryError.invalid("GET317 系统导入样本路径已有其他内容，未覆盖。") }
        } else { try bytes.write(to: selectedFile, options: .atomic) }
        // No export JSON is seeded here. UI35 must make the real fileExporter
        // write its own bytes into this otherwise fixture-owned destination.
    }

    @MainActor private static func observeReaderForDownloadGate(_ model: LibraryModel) {
        withObservationTracking {
            if let reader = model.reader, reader.book.cloud == nil {
                GET317Transport.releaseGatedDownloads()
            }
        } onChange: { [weak model] in
            // Observation is one-shot and fires before the mutation commits.
            // Re-register on the main actor to inspect the actual new reader.
            Task { @MainActor [weak model] in
                guard let model else { return }
                observeReaderForDownloadGate(model)
            }
        }
    }
    #endif
}

#if DEBUG
private final class GET317Transport: URLProtocol, @unchecked Sendable {
    static let owner = "00000000-0000-4000-8000-000000000317"
    private static let lock = NSLock()
    private static var root: URL?
    private static var arguments: [String] = []
    private static var downloadGateOpen = true
    private static var pendingDownloads: [ObjectIdentifier: PendingDownload] = [:]
    private let completionLock = NSLock()
    private var stopped = false

    static func configure(root: URL, arguments: [String]) {
        lock.lock(); defer { lock.unlock() }
        self.root = root; self.arguments = arguments
        downloadGateOpen = !arguments.contains("--get317-gated-download")
        pendingDownloads.removeAll()
    }

    // Intercept every URL in this dedicated session, including unexpected hosts.
    // Unknown destinations fail closed instead of falling through to the network.
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let result = Self.response(for: request)
        guard !Self.holdIfGated(self, response: result) else { return }
        deliver(result)
    }
    private func deliver(_ result: Response) {
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + result.delay) { [self] in
            completionLock.lock(); defer { completionLock.unlock() }
            guard !stopped, let url = request.url else { return }
            guard let response = HTTPURLResponse(url: url, statusCode: result.status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"]) else { return }
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: result.data)
            client?.urlProtocolDidFinishLoading(self)
        }
    }
    override func stopLoading() {
        completionLock.lock(); stopped = true; completionLock.unlock()
        Self.removePendingDownload(self)
    }

    private struct Response: Sendable { var status: Int; var data: Data; var delay: TimeInterval }
    private final class PendingDownload {
        weak var transport: GET317Transport?
        let response: Response
        init(transport: GET317Transport, response: Response) { self.transport = transport; self.response = response }
    }
    private static func holdIfGated(_ transport: GET317Transport, response: Response) -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard !downloadGateOpen, arguments.contains("--get317-gated-download"), response.status == 200,
              transport.request.url?.host == "fixture.invalid",
              transport.request.url?.path.hasPrefix("/api/library/books/get317-slow/chapters/") == true else { return false }
        transport.completionLock.lock(); defer { transport.completionLock.unlock() }
        guard !transport.stopped else { return false }
        pendingDownloads[ObjectIdentifier(transport)] = PendingDownload(transport: transport, response: response)
        return true
    }
    private static func removePendingDownload(_ transport: GET317Transport) {
        lock.lock(); defer { lock.unlock() }
        pendingDownloads.removeValue(forKey: ObjectIdentifier(transport))
    }
    static func releaseGatedDownloads() {
        lock.lock()
        downloadGateOpen = true
        let ready = Array(pendingDownloads.values)
        pendingDownloads.removeAll()
        lock.unlock()
        // Client delivery runs after unlocking; a cancelled URLProtocol is also
        // guarded by its own stopped state. No session thread waits on the gate.
        for item in ready { item.transport?.deliver(item.response) }
    }
    private static func response(for request: URLRequest) -> Response {
        lock.lock(); defer { lock.unlock() }
        func reply(_ object: [String: Any], status: Int = 200, delay: TimeInterval = 0.03) -> Response {
            Response(status: status, data: (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data("{}".utf8), delay: delay)
        }
        guard request.url?.host == "fixture.invalid", request.url?.scheme == "https" else {
            return reply(["error": "GET317 blocked an unexpected destination"], status: 403)
        }
        let path = request.url!.path
        let method = request.httpMethod ?? "GET"
        if path == "/api/auth/session" {
            var value: [String: Any] = ["user": ["id": owner, "email": "get317-synthetic@example.invalid"], "billing": ["enabled": false]]
            if arguments.contains("--get317-native-auth") {
                value["nativeOAuth"] = ["version": 1]
                value["providers"] = ["apple": true, "google": true]
            }
            return reply(value)
        }
        guard request.value(forHTTPHeaderField: "X-Reader-Owner") == owner else { return reply(["error": "GET317 owner mismatch"], status: 403) }
        if path == "/api/auth/identities", arguments.contains("--get317-native-auth") {
            return reply(["user": ["id": owner], "identities": [["provider": "email", "email": "get317-synthetic@example.invalid", "emailVerified": true]]])
        }
        if path == "/api/auth/native/start", arguments.contains("--get317-native-auth") {
            let input = bodyObject(request)
            guard method == "POST", input["mode"] as? String == "link",
                  ["apple", "google"].contains(input["provider"] as? String ?? "") else {
                return reply(["error": "GET317 synthetic link request did not match the fixture"], status: 400)
            }
            // Reject before returning any launch URL. No browser or real OAuth
            // provider can be started by this declared-capability test scenario.
            return reply(["error": "GET317 合成账号关联被拒绝，原书房与登录账号仍保留。"], status: 403)
        }
        if path == "/api/library" {
            if arguments.contains("--get317-cloud-error") { return reply(["error": "GET317 合成云书房读取失败"], status: 503) }
            return reply(["user": ["id": owner], "books": shelf])
        }
        if path == "/api/library/notebook" || path == "/api/library/reading-summary" {
            if arguments.contains("--get317-records-error") { return reply(["error": "GET317 合成记录读取失败"], status: 503) }
            if path.hasSuffix("notebook") {
                let entries: [[String: Any]] = shelf.compactMap { book in
                    let records = record(book["bookId"] as! String)
                    let comments = records["comments"] as? [[String: Any]] ?? []
                    return comments.isEmpty ? nil : ["book": book, "records": records]
                }
                return reply(["entries": entries, "nextCursor": NSNull(), "completed": shelf.count, "total": shelf.count])
            }
            return reply(["allTime": ["durationSeconds": 0, "readingDays": 0], "books": []])
        }
        let components = path.split(separator: "/").map(String.init)
        guard components.count >= 5, components[0...2].elementsEqual(["api", "library", "books"]), shelf.contains(where: { $0["bookId"] as? String == components[3] }) else {
            return reply(["error": "GET317 fixture endpoint was not configured: " + path], status: 404)
        }
        let bookID = components[3], action = components[4]
        let body = bodyObject(request)
        switch action {
        case "reading-manifest": return reply(manifest(bookID))
        case "chapters":
            guard components.count == 6, let chapter = chapter(bookID, id: components[5]) else { return reply(["error": "Unknown synthetic chapter"], status: 404) }
            let delay: TimeInterval = arguments.contains("--get317-slow-download") && bookID == "get317-slow" ? 2 : 0.03
            return reply(chapter, delay: delay)
        case "records": return reply(record(bookID))
        case "progress":
            var records = record(bookID), saved = body
            let previous = records["position"] as? [String: Any] ?? [:]
            saved["revision"] = (previous["revision"] as? Int ?? 0) + 1
            records["position"] = saved; persist(records, bookID: bookID)
            return reply(saved)
        case "comments":
            var records = record(bookID)
            var comments = records["comments"] as? [[String: Any]] ?? []
            if !comments.contains(where: { $0["id"] as? String == body["id"] as? String }) { comments.append(body) }
            records["comments"] = comments; persist(records, bookID: bookID)
            return reply(body)
        case "introduction": return reply(["text": "GET317 合成验收导读。这里不包含真实书籍或模型结果。", "source": "editorial"])
        case "chat":
            var records = record(bookID)
            var turns = records["syntheticTurns"] as? [[String: Any]] ?? []
            if method == "GET" { return reply(["available": true, "scope": ["mode": "book", "revision": 0], "turns": turns]) }
            let turn: [String: Any] = ["id": body["id"] as? String ?? "missing-id", "text": body["text"] as? String ?? "", "status": "completed", "answer": ["summary": "GET317 合成 AI 回答样本：这是离线网络夹具返回的固定测试文字，未调用任何模型。\n\n" + String(repeating: "输入框应继续可见，原文位置应保持稳定。 ", count: 18)]]
            if !turns.contains(where: { $0["id"] as? String == turn["id"] as? String }) { turns.append(turn) }
            records["syntheticTurns"] = turns; persist(records, bookID: bookID)
            return reply(turn)
        case "translate":
            let passageID = body["passageId"] as? String ?? "c1-p1"
            let chapterID = String(passageID.split(separator: "-").first ?? "c1")
            guard let value = chapter(bookID, id: chapterID), let section = (value["sections"] as? [[String: Any]])?.first,
                  let paragraph = (section["paragraphs"] as? [[String: Any]])?.first(where: { $0["id"] as? String == passageID }) else { return reply(["error": "Synthetic passage not found"], status: 404) }
            var records = record(bookID)
            var generated = records["syntheticTranslations"] as? [String: Any] ?? [:]
            generated[passageID] = translations
            records["syntheticTranslations"] = generated; persist(records, bookID: bookID)
            var result = paragraph; result["translations"] = translations
            return reply(result)
        default: return reply(["error": "GET317 fixture endpoint was not configured: " + path], status: 404)
        }
    }

    private static var shelf: [[String: Any]] {
        [
            ["bookId": "get317-translated", "title": "GET317 合成验收 · 双译", "author": "GET317 合成作者甲", "contentVersion": "get317-v1"],
            ["bookId": "get317-cloud", "title": "GET317 合成验收 · 云端未下载", "author": "GET317 合成作者乙", "contentVersion": "get317-v1"],
            ["bookId": "get317-slow", "title": "GET317 合成验收 · 慢速下载", "author": "GET317 合成作者丙", "contentVersion": "get317-v1"]
        ]
    }
    private static func manifest(_ id: String) -> [String: Any] {
        let metadata = shelf.first(where: { $0["bookId"] as? String == id })!
        var value = metadata
        value["source"] = ["format": "txt"]
        value["description"] = "明确标注的合成验收资料，未使用真实用户书籍。"
        value["chapters"] = (1...3).map { ["id": "c\($0)", "title": "GET317 合成第 \($0) 章"] }
        return value
    }
    private static var translations: [String: Any] {
        [
            "literal": ["text": "【GET317 合成直译样本 · 非真实书籍译文】\n\n" + String(repeating: "安静的果园是一段专门编写的测试资料，用来检查长译文是否完整、可滚动、可核对。", count: 28) + "\n\nGET317_LITERAL_END", "status": "draft"],
            "interpretive": ["text": "【GET317 合成意译样本 · 非真实书籍译文】\n\n" + String(repeating: "这里的河流和果园都只是测试场景，读者可以在原文与已保存样本之间来回核对。", count: 24) + "\n\nGET317_INTERPRETIVE_END", "status": "draft"]
        ]
    }
    private static func chapter(_ bookID: String, id: String) -> [String: Any]? {
        guard ["c1", "c2", "c3"].contains(id) else { return nil }
        let generated = record(bookID)["syntheticTranslations"] as? [String: Any] ?? [:]
        let paragraphs: [[String: Any]] = (1...12).map { number in
            var row: [String: Any] = ["id": "\(id)-p\(number)", "original": "GET317 SYNTHETIC \(id) paragraph \(number). This invented orchard is acceptance material written solely for the test. The stable search marker CLOUD_ORCHARD_\(id)_\(number) helps a reader return to exactly this passage. " + String(repeating: "The river stays beside the orchard while the tools open and close. ", count: 5), "source": ["review": "extracted_unreviewed"]]
            if bookID == "get317-translated" { row["translations"] = translations }
            else if let saved = generated["\(id)-p\(number)"] { row["translations"] = saved }
            return row
        }
        return ["bookId": bookID, "contentVersion": "get317-v1", "chapterId": id, "sections": [["id": "\(id)-section", "chapterId": id, "paragraphs": paragraphs]]]
    }
    private static func stateURL(_ bookID: String) -> URL { root!.appendingPathComponent("network-" + bookID + ".json") }
    private static func record(_ bookID: String) -> [String: Any] {
        if let data = try? Data(contentsOf: stateURL(bookID)), let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { return value }
        return ["bookId": bookID, "contentVersion": "get317-v1", "comments": [], "questions": [], "position": [:]]
    }
    private static func persist(_ record: [String: Any], bookID: String) {
        if let data = try? JSONSerialization.data(withJSONObject: record, options: [.sortedKeys]) { try? data.write(to: stateURL(bookID), options: .atomic) }
    }
    private static func bodyObject(_ request: URLRequest) -> [String: Any] {
        var bytes = request.httpBody ?? Data()
        if bytes.isEmpty, let stream = request.httpBodyStream {
            stream.open(); defer { stream.close() }
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                guard count > 0 else { break }
                bytes.append(contentsOf: buffer.prefix(count))
            }
        }
        return (try? JSONSerialization.jsonObject(with: bytes)) as? [String: Any] ?? [:]
    }
}
#endif
