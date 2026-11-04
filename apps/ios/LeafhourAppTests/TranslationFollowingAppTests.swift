import XCTest
import LeafhourCore
@testable import Leafhour

@MainActor final class TranslationFollowingAppTests: XCTestCase {
    private func fixture() async throws -> (ReaderSession, CloudLibraryClient, OfflineLibrary) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let owner = UUID(), ownerID = owner.uuidString.lowercased()
        let library = try OfflineLibrary(root: root, scope: .account(owner))
        let chapters = try JSONDecoder().decode([BookChapter].self, from: Data(#"[{"id":"c","title":"章","sourcePath":"c","passages":[{"id":"p1","text":"这是供测试使用的第一段中文原文。","heading":false},{"id":"p2","text":"这是供测试使用的第二段中文原文。","heading":false}]},{"id":"next","title":"下一章","sourcePath":"next","passages":[{"id":"p3","text":"这是下一章供测试使用的第三段中文原文。","heading":false}]}]"#.utf8))
        let identity = CloudBookIdentity(ownerID: ownerID, bookID: "synthetic", contentVersion: "v1", sourceFormat: "txt")
        let sections: [[String: Any]] = chapters.map { chapter in
            ["chapterId": chapter.id, "paragraphs": chapter.passages.map { ["id": $0.id, "original": $0.text, "translations": [:]] as [String: Any] }]
        }
        let content = try JSONSerialization.data(withJSONObject: ["bookId": "synthetic", "contentVersion": "v1", "sections": sections])
        let book = try await library.importCloud(CloudReadingCopy(identity: identity, title: "Synthetic", author: "", chapters: chapters, content: content))
        let session = ReaderSession(book: book, state: try await library.state(book.id), original: try await library.originalURL(book.id), directory: try await library.bookDirectory(book.id), library: library)
        session.changeTranslationSettings(.init(sourceLanguage: .zh, targetLanguage: .en))
        var preferences = session.state.preferences; preferences.viewMode = .parallel; session.changePreferences(preferences)
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [TranslationFollowingProtocol.self]
        let cloud = CloudLibraryClient(baseURL: URL(string: "https://translation.test")!, credential: CloudCredential(account: CloudAccount(id: ownerID, email: nil), token: "isolated-translation-test"), configuration: configuration)
        TranslationFollowingProtocol.reset()
        return (session, cloud, library)
    }

    func testClosingCancelsTransportAndRecoveryKeepsExactRequestWithoutAdvancing() async throws {
        let (session, cloud, library) = try await fixture()
        let book = session.book
        let reading = ReaderReadingContent(), layout = ReaderVisiblePageLayout()
        let page = try XCTUnwrap(ReaderVisiblePage(session: session, chapterID: "c", passageIDs: ["p1"], layout: layout))
        await reading.follow(session, cloud: cloud, library: library, page: page, userNavigationID: UUID())
        XCTAssertEqual(TranslationFollowingProtocol.translationRequests, 0, "Position updates cannot enable generation")
        await reading.startFollowing(session, cloud: cloud, library: library, page: page, userNavigationID: UUID())
        for _ in 0..<200 {
            if TranslationFollowingProtocol.pendingBody != nil { break }
            try await Task.sleep(for: .milliseconds(10))
        }
        let body = try XCTUnwrap(TranslationFollowingProtocol.pendingBody)
        reading.stopFollowing()
        for _ in 0..<200 {
            if !reading.running && TranslationFollowingProtocol.cancelled { break }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertFalse(reading.isFollowing)
        XCTAssertTrue(TranslationFollowingProtocol.cancelled)
        XCTAssertTrue(session.translations.isEmpty)
        let pending = try await library.pendingReadingTranslation(bookID: book.id, targetLanguage: .en)
        let saved = try XCTUnwrap(pending)
        let run = try JSONDecoder().decode(ReaderTranslationRun.self, from: saved)
        XCTAssertEqual(run.pending?.body, body)
        XCTAssertEqual(run.next, 0)
        XCTAssertEqual(TranslationFollowingProtocol.translationRequests, 1)
        TranslationFollowingProtocol.setImmediateReplies(true)
        let nextPage = try XCTUnwrap(ReaderVisiblePage(session: session, chapterID: "c", passageIDs: ["p2"], layout: layout))
        await reading.startFollowing(session, cloud: cloud, library: library, page: nextPage, userNavigationID: UUID())
        for _ in 0..<200 {
            if !reading.running { break }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertFalse(reading.isFollowing, "Recovery must stop rather than starting the new page's range")
        XCTAssertEqual(TranslationFollowingProtocol.translationRequests, 2)
        XCTAssertEqual(Set(session.translations.keys), ["p1"])
    }
    func testChapterNavigationRetainsSwitchButNeedsNewUserMarkerAndRealPage() async throws {
        let (session, cloud, library) = try await fixture()
        TranslationFollowingProtocol.setImmediateReplies(true)
        let reading = ReaderReadingContent(), layout = ReaderVisiblePageLayout(), oldMarker = UUID()
        let page = try XCTUnwrap(ReaderVisiblePage(session: session, chapterID: "c", passageIDs: ["p1"], layout: layout))
        await reading.startFollowing(session, cloud: cloud, library: library, page: page, userNavigationID: oldMarker)
        for _ in 0..<200 { if !reading.running { break }; try await Task.sleep(for: .milliseconds(10)) }
        XCTAssertTrue(reading.isFollowing)
        XCTAssertEqual(TranslationFollowingProtocol.translationRequests, 2, "Completing a chapter must not automatically request the next one")
        session.go(to: 1); reading.enteredChapter("next")
        XCTAssertTrue(reading.isFollowing)
        let next = try XCTUnwrap(ReaderVisiblePage(session: session, chapterID: "next", passageIDs: ["p3"], layout: layout))
        await reading.follow(session, cloud: cloud, library: library, page: next, userNavigationID: oldMarker)
        XCTAssertEqual(TranslationFollowingProtocol.translationRequests, 2, "A reflow with the revoked marker cannot plan another chapter")
        let newMarker = UUID()
        await reading.follow(session, cloud: cloud, library: library, page: nil, userNavigationID: newMarker)
        XCTAssertEqual(TranslationFollowingProtocol.translationRequests, 2, "A navigation marker alone cannot substitute for a real visible page")
        await reading.follow(session, cloud: cloud, library: library, page: next, userNavigationID: newMarker)
        for _ in 0..<200 { if !reading.running { break }; try await Task.sleep(for: .milliseconds(10)) }
        XCTAssertEqual(TranslationFollowingProtocol.translationRequests, 3)
        XCTAssertEqual(session.translations["p3"]?.literal, "Literal English.")
        let reflow = try XCTUnwrap(ReaderVisiblePage(session: session, chapterID: "next", passageIDs: ["p3"], layout: layout))
        await reading.follow(session, cloud: cloud, library: library, page: reflow, userNavigationID: newMarker)
        XCTAssertEqual(TranslationFollowingProtocol.translationRequests, 3)
        reading.setForeground(false)
        XCTAssertFalse(reading.isFollowing)
    }

}

private final class TranslationFollowingProtocol: URLProtocol, @unchecked Sendable {
    static let lock = NSLock()
    private static var savedBody: Data?
    private static var wasCancelled = false
    private static var count = 0
    private static var immediateReplies = false
    static var pendingBody: Data? { lock.lock(); defer { lock.unlock() }; return savedBody }
    static var cancelled: Bool { lock.lock(); defer { lock.unlock() }; return wasCancelled }
    static var translationRequests: Int { lock.lock(); defer { lock.unlock() }; return count }
    static func reset() { lock.lock(); defer { lock.unlock() }; savedBody = nil; wasCancelled = false; count = 0; immediateReplies = false }
    static func setImmediateReplies(_ value: Bool) { lock.lock(); defer { lock.unlock() }; immediateReplies = value }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        if request.url?.path.hasSuffix("/translate") == true {
            var body = request.httpBody
            if body == nil, let stream = request.httpBodyStream {
                stream.open(); defer { stream.close() }
                var bytes = Data(), buffer = [UInt8](repeating: 0, count: 4096)
                while stream.hasBytesAvailable { let n = stream.read(&buffer, maxLength: buffer.count); if n <= 0 { break }; bytes.append(buffer, count: n) }
                body = bytes
            }
            Self.lock.lock(); Self.savedBody = body; Self.count += 1; let immediate = Self.immediateReplies; Self.lock.unlock()
            if immediate, let body, let input = try? CloudJSON.decode(body), let id = input["passageId"].string {
                let original = ["p1": "这是供测试使用的第一段中文原文。", "p2": "这是供测试使用的第二段中文原文。", "p3": "这是下一章供测试使用的第三段中文原文。"][id] ?? ""
                respond(["id": id, "original": original, "translations": ["literal": ["text": "Literal English.", "targetLanguage": "en", "status": "draft"], "interpretive": ["text": "Interpretive English.", "targetLanguage": "en", "status": "draft"]]])
            }
            return
        }
        let value: [String: Any] = ["user": ["id": request.value(forHTTPHeaderField: "X-Reader-Owner") ?? ""], "billing": ["enabled": false]]
        respond(value)
    }
    private func respond(_ value: [String: Any]) {
        let data = try! JSONSerialization.data(withJSONObject: value)
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {
        guard request.url?.path.hasSuffix("/translate") == true else { return }
        Self.lock.lock(); Self.wasCancelled = true; Self.lock.unlock()
    }
}
