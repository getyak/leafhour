import XCTest
import Foundation
import UIKit
import LeafhourCore
@testable import Leafhour

@MainActor
final class ReaderToolsTests: XCTestCase {
    private let owner = "00000000-0000-4000-8000-000000000312"
    private struct Fixture {
        let session: ReaderSession
        let cloud: CloudLibraryClient
        let passage: Passage
    }
    private func fixture(source: String = "A 😀 café and a quiet page.", markdown: Bool = false) async throws -> Fixture {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent(markdown ? "reader.md" : "reader.txt")
        try Data(source.utf8).write(to: file)
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .device)
        var book = try await library.importFile(file)
        book.cloud = CloudBookIdentity(ownerID: owner, bookID: "cloud-book", contentVersion: "source-v1", sourceFormat: markdown ? "md" : "txt")
        let state = try await library.state(book.id), directory = try await library.bookDirectory(book.id)
        let original = try await library.originalURL(book.id)
        let session = ReaderSession(book: book, state: state, original: original, directory: directory, library: library)
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [ReaderToolsURLProtocol.self]
        let credential = CloudCredential(account: CloudAccount(id: owner, email: nil), token: "isolated-test-token")
        let cloud = CloudLibraryClient(baseURL: URL(string: "https://leafhour.test")!, credential: credential, configuration: configuration)
        return Fixture(session: session, cloud: cloud, passage: try XCTUnwrap(session.chapter.passages.first))
    }
    private nonisolated func metadata(enabled: Bool = true) -> [String: Any] {
        ["user": ["id": owner], "billing": ["enabled": enabled, "mode": "test", "unitsPerPoint": 1_000_000, "prices": ["translation": 1_000_000, "conversation": 4_000_000]]]
    }
    private nonisolated func quote(_ request: [String: Any], action: String = "translation") -> [String: Any] {
        let input = request["input"] as? [String: Any] ?? [:]
        return ["id": "quote-test", "ownerId": owner, "action": action, "mode": "test", "units": action == "translation" ? 1_000_000 : 4_000_000,
            "expiresAt": ISO8601DateFormatter().string(from: Date().addingTimeInterval(300)),
            "scope": ["bookId": "cloud-book", "requestId": input["id"] ?? "", "passageId": input["passageId"] ?? "", "contentVersion": "source-v1"]]
    }
    override func tearDown() {
        ReaderToolsURLProtocol.install(nil)
        super.tearDown()
    }
    func testOpeningTranslationOnlyReadsAndKeepsVariantsSeparate() async throws {
        let fixture = try await fixture(), probe = ReaderToolsProbe()
        probe.respond = { request, _ in
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertFalse(request.url!.absoluteString.contains("%2D"), "Unreserved book/chapter IDs must match the server's route IDs")
            return (200, ["sections": [["paragraphs": [["id": fixture.passage.id, "original": fixture.passage.text,
                "translations": ["literal": ["text": "直译内容", "status": "reviewed"], "interpretive": ["text": "独立的意译内容", "status": "draft"]]]]]]])
        }
        ReaderToolsURLProtocol.install(probe)
        let tools = ReaderCloudTools()
        await tools.loadTranslation(fixture.session, cloud: fixture.cloud)
        XCTAssertEqual(tools.translation?.literal, "直译内容")
        XCTAssertEqual(tools.translation?.interpretive, "独立的意译内容")
        XCTAssertEqual(tools.translation?.literalStatus, "reviewed")
        XCTAssertEqual(tools.translation?.interpretiveStatus, "draft")
        XCTAssertEqual(probe.requests.count, 1)
        XCTAssertNil(tools.consent)
        XCTAssertNil(tools.retry)
    }
    func testOpeningIntroductionAndConversationNeverGenerates() async throws {
        let fixture = try await fixture(), probe = ReaderToolsProbe()
        probe.respond = { request, _ in
            XCTAssertEqual(request.httpMethod, "GET")
            if request.url!.path.hasSuffix("introduction") { return (200, ["source": "ai", "text": "已保存的开篇导读"]) }
            return (200, ["available": true, "scope": ["mode": "book", "revision": 2], "turns": [["id": "saved", "text": "我之前的问题", "status": "completed", "answer": ["summary": "已保存的回答"]]]])
        }
        ReaderToolsURLProtocol.install(probe)
        let tools = ReaderCloudTools()
        await tools.loadIntroduction(fixture.session, cloud: fixture.cloud)
        await tools.loadConversation(fixture.session, cloud: fixture.cloud)
        XCTAssertEqual(tools.introduction, "已保存的开篇导读")
        XCTAssertEqual(tools.turns.first?.answer, "已保存的回答")
        XCTAssertEqual(tools.scopeRevision, 2)
        XCTAssertEqual(probe.requests.count, 2)
        XCTAssertTrue(probe.requests.allSatisfy { $0.httpMethod == "GET" })
    }
    func testPreparingRequiresConfirmationAndCancellationNeverSubmits() async throws {
        let fixture = try await fixture(), probe = ReaderToolsProbe()
        probe.respond = { [self] request, body in
            if request.url!.path == "/api/auth/session" { return (200, metadata()) }
            XCTAssertEqual(request.url!.path, "/api/billing/quotes")
            return (200, quote(body))
        }
        ReaderToolsURLProtocol.install(probe)
        let tools = ReaderCloudTools()
        await tools.prepare("translation", session: fixture.session, cloud: fixture.cloud)
        let consent = try XCTUnwrap(tools.consent)
        XCTAssertTrue(consent.explanation.contains("1 阅读点"))
        XCTAssertTrue(consent.explanation.contains("沙盒"))
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: consent.body) as? [String: Any])
        XCTAssertEqual((body["billing"] as? [String: String])?["quoteId"], "quote-test")
        tools.consent = nil
        XCTAssertNil(tools.retry)
        XCTAssertEqual(probe.requests.filter { $0.httpMethod == "POST" }.count, 1, "Only a quote may be requested before confirmation")
        XCTAssertFalse(probe.requests.contains { $0.url!.path.hasSuffix("translate") })
    }
    func testWrongOwnerPriceScopeAndExpiredQuotesNeverSubmit() async throws {
        let fixture = try await fixture()
        for invalid in ["owner", "price", "book", "version", "request", "mode", "expired"] {
            let probe = ReaderToolsProbe()
            probe.respond = { [self] request, body in
                if request.url!.path == "/api/auth/session" { return (200, metadata()) }
                XCTAssertEqual(request.url!.path, "/api/billing/quotes")
                var value = quote(body), scope = value["scope"] as! [String: Any]
                switch invalid {
                case "owner": value["ownerId"] = "different-owner"
                case "price": value["units"] = 99
                case "book": scope["bookId"] = "different-book"
                case "version": scope["contentVersion"] = "stale"
                case "request": scope["requestId"] = "different-request"
                case "mode": value["mode"] = "live"
                default: value["expiresAt"] = "2020-01-01T00:00:00Z"
                }
                value["scope"] = scope
                return (200, value)
            }
            ReaderToolsURLProtocol.install(probe)
            let tools = ReaderCloudTools()
            await tools.prepare("translation", session: fixture.session, cloud: fixture.cloud)
            XCTAssertNil(tools.consent, invalid)
            XCTAssertNotNil(tools.error, invalid)
            XCTAssertFalse(probe.requests.contains { $0.url!.path.hasSuffix("translate") }, invalid)
        }
    }
    func testRetryReusesExactRequestAndBillingIdentity() async throws {
        let fixture = try await fixture(), probe = ReaderToolsProbe()
        var submitted: [[String: Any]] = []
        probe.respond = { [self] request, body in
            if request.url!.path == "/api/auth/session" { return (200, metadata()) }
            if request.url!.path == "/api/billing/quotes" { return (200, quote(body)) }
            submitted.append(body)
            if submitted.count == 1 { return (503, ["error": "Temporary interruption"]) }
            return (200, ["id": fixture.passage.id, "original": fixture.passage.text, "translations": ["literal": ["text": "literal"], "interpretive": ["text": "interpretive"]]])
        }
        ReaderToolsURLProtocol.install(probe)
        let tools = ReaderCloudTools()
        await tools.prepare("translation", session: fixture.session, cloud: fixture.cloud)
        let consent = try XCTUnwrap(tools.consent)
        await tools.perform(consent, cloud: fixture.cloud)
        let retry = try XCTUnwrap(tools.retry)
        XCTAssertEqual(retry.body, consent.body)
        await tools.perform(retry, cloud: fixture.cloud)
        XCTAssertNil(tools.retry)
        XCTAssertEqual(submitted.count, 2)
        XCTAssertEqual(submitted[0]["id"] as? String, submitted[1]["id"] as? String)
        XCTAssertEqual(submitted[0]["billing"] as? [String: String], submitted[1]["billing"] as? [String: String])
        XCTAssertEqual(probe.requests.filter { $0.url!.path == "/api/billing/quotes" }.count, 1)
    }
    func testSelectedUnicodeQuoteUsesUTF16OffsetsAndNoPrivateNotes() async throws {
        let fixture = try await fixture(), probe = ReaderToolsProbe()
        fixture.session.selection = SelectedQuote(anchor: ReadingAnchor(chapterID: fixture.session.chapter.id, passageID: fixture.passage.id, characterOffset: 2), text: "😀 café")
        fixture.session.state.notes.append(ReaderNote(anchor: fixture.session.selection!.anchor, quote: "😀 café", body: "PRIVATE NOTE MUST STAY LOCAL"))
        probe.respond = { [self] request, body in
            if request.url!.path == "/api/auth/session" { return (200, metadata()) }
            return (200, self.quote(body, action: "conversation"))
        }
        ReaderToolsURLProtocol.install(probe)
        let tools = ReaderCloudTools(); tools.question = "What does this mean?"
        await tools.prepare("conversation", session: fixture.session, cloud: fixture.cloud)
        let consent = try XCTUnwrap(tools.consent)
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: consent.body) as? [String: Any])
        let quote = try XCTUnwrap(body["quote"] as? [String: Any])
        let part = try XCTUnwrap((quote["parts"] as? [[String: Any]])?.first)
        XCTAssertEqual(part["start"] as? Int, 2)
        XCTAssertEqual(part["end"] as? Int, 9)
        XCTAssertEqual(part["text"] as? String, "😀 café")
        XCTAssertEqual((fixture.passage.text as NSString).substring(with: NSRange(location: 2, length: 7)), "😀 café")
        XCTAssertNil(body["notes"])
        XCTAssertNil(body["drafts"])
        XCTAssertNil(body["preferenceWrites"])
        XCTAssertFalse(String(decoding: consent.body, as: UTF8.self).contains("PRIVATE NOTE"))
    }
    func testMarkdownSpeechUsesRenderedTextWithoutFormattingMarkers() {
        let source = "# A quiet page\n\n**Bold** and [a link](https://example.com).\n\n```swift\nlet n = 1\n```"
        let spoken = ReaderSpeech.spokenText(source, kind: .markdown)
        XCTAssertTrue(spoken.contains("A quiet page"))
        XCTAssertTrue(spoken.contains("Bold"))
        XCTAssertTrue(spoken.contains("a link"))
        XCTAssertTrue(spoken.contains("let n = 1"))
        XCTAssertFalse(spoken.contains("**"))
        XCTAssertFalse(spoken.contains("```"))
        XCTAssertFalse(spoken.contains("https://example.com"))
        XCTAssertEqual(ReaderSpeech.spokenText(source, kind: .txt), source)
    }
    func testFormattedSelectionPreservesDisplayAndSubmitsExactRawSource() async throws {
        let raw = "A **bold** thought &amp; 😀."
        let fixture = try await fixture(source: raw, markdown: true), probe = ReaderToolsProbe()
        let reading = TextReadingView(session: fixture.session, onNote: { _ in }, onSource: { _ in }, onWake: { _ in }, onReadingScroll: { })
        let coordinator = reading.makeCoordinator(), view = UITextView(frame: CGRect(x: 0, y: 0, width: 390, height: 700))
        coordinator.view = view; coordinator.updateContent(view)
        let visible = "A bold thought & 😀."
        let range = (view.text as NSString).range(of: visible)
        XCTAssertNotEqual(range.location, NSNotFound)
        let selected = try XCTUnwrap(coordinator.selectedQuote(in: view, range: range))
        XCTAssertEqual(selected.text, visible)
        XCTAssertEqual(selected.sourceText, raw)
        fixture.session.selection = selected
        probe.respond = { [self] request, _ in
            XCTAssertEqual(request.url!.path, "/api/auth/session")
            return (200, metadata(enabled: false))
        }
        ReaderToolsURLProtocol.install(probe)
        let tools = ReaderCloudTools(); tools.question = "Explain the selected sentence."
        await tools.prepare("conversation", session: fixture.session, cloud: fixture.cloud)
        let consent = try XCTUnwrap(tools.consent)
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: consent.body) as? [String: Any])
        let quote = try XCTUnwrap(body["quote"] as? [String: Any])
        let part = try XCTUnwrap((quote["parts"] as? [[String: Any]])?.first)
        XCTAssertEqual(part["text"] as? String, raw)
        let start = try XCTUnwrap(part["start"] as? Int), end = try XCTUnwrap(part["end"] as? Int)
        XCTAssertEqual((fixture.passage.text as NSString).substring(with: NSRange(location: start, length: end - start)), raw)
        XCTAssertNil(tools.error)
    }
    func testDismissAndScrollClearTemporarySelectionWithoutChangingDrafts() async throws {
        let fixture = try await fixture(source: "First thought.\n\nSecond thought.")
        let first = fixture.passage, second = try XCTUnwrap(fixture.session.chapter.passages.last)
        XCTAssertNotEqual(first.id, second.id)
        let quote = SelectedQuote(anchor: ReadingAnchor(chapterID: fixture.session.chapter.id, passageID: first.id), text: first.text)
        let draft = NoteDraft(anchor: quote.anchor, quote: quote.text, body: "Keep my unsaved thought")
        fixture.session.state.drafts[quote.anchor.key] = draft
        fixture.session.recordVisible(ReadingAnchor(chapterID: fixture.session.chapter.id, passageID: second.id), navigationID: fixture.session.navigationID)
        fixture.session.selection = quote
        XCTAssertEqual(ReaderCloudTools.currentPassage(fixture.session)?.id, first.id)
        fixture.session.clearTransientSelection() // Same action used by sheet onDismiss.
        XCTAssertEqual(ReaderCloudTools.currentPassage(fixture.session)?.id, second.id)
        fixture.session.selection = quote
        let reading = TextReadingView(session: fixture.session, onNote: { _ in }, onSource: { _ in }, onWake: { _ in }, onReadingScroll: { })
        reading.makeCoordinator().scrollViewWillBeginDragging(UIScrollView())
        XCTAssertNil(fixture.session.selection)
        XCTAssertEqual(ReaderCloudTools.currentPassage(fixture.session)?.id, second.id)
        XCTAssertEqual(fixture.session.state.drafts[quote.anchor.key], draft)
    }
    func testDefiniteScopeRejectionAllowsRefreshAndNewRequestWithoutLosingQuestion() async throws {
        let fixture = try await fixture(), probe = ReaderToolsProbe()
        probe.respond = { [self] request, _ in
            if request.url!.path == "/api/auth/session" { return (200, metadata(enabled: false)) }
            if request.httpMethod == "GET" { return (200, ["available": true, "scope": ["mode": "book", "revision": 3], "turns": []]) }
            return (412, ["error": "查阅范围已变化"])
        }
        ReaderToolsURLProtocol.install(probe)
        let tools = ReaderCloudTools(); tools.question = "Keep this question."
        await tools.prepare("conversation", session: fixture.session, cloud: fixture.cloud)
        let original = try XCTUnwrap(tools.consent)
        await tools.perform(original, cloud: fixture.cloud)
        XCTAssertNil(tools.retry)
        XCTAssertEqual(tools.question, "Keep this question.")
        await tools.loadConversation(fixture.session, cloud: fixture.cloud)
        await tools.prepare("conversation", session: fixture.session, cloud: fixture.cloud)
        let refreshed = try XCTUnwrap(tools.consent)
        XCTAssertNotEqual(original.id, refreshed.id)
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: refreshed.body) as? [String: Any])
        XCTAssertEqual(body["scopeRevision"] as? Int, 3)
        XCTAssertEqual(body["text"] as? String, "Keep this question.")
    }
    func testUnknownConflictKeepsExactRetryAndBlocksASecondRequest() async throws {
        let fixture = try await fixture(), probe = ReaderToolsProbe()
        probe.respond = { [self] request, _ in
            if request.url!.path == "/api/auth/session" { return (200, metadata(enabled: false)) }
            return (409, ["error": "This request may still be running"])
        }
        ReaderToolsURLProtocol.install(probe)
        let tools = ReaderCloudTools(); tools.question = "Keep the original request."
        await tools.prepare("conversation", session: fixture.session, cloud: fixture.cloud)
        let original = try XCTUnwrap(tools.consent)
        await tools.perform(original, cloud: fixture.cloud)
        XCTAssertEqual(tools.retry?.id, original.id)
        XCTAssertEqual(tools.retry?.body, original.body)
        let before = probe.requests.count
        await tools.prepare("conversation", session: fixture.session, cloud: fixture.cloud)
        XCTAssertNil(tools.consent)
        XCTAssertEqual(probe.requests.count, before)
        XCTAssertEqual(tools.question, "Keep the original request.")
    }
    func testTrustedTerminalLedgerReceiptUnlocksRejectedRequest() async throws {
        let fixture = try await fixture(), probe = ReaderToolsProbe()
        probe.respond = { [self] request, _ in
            if request.url!.path == "/api/auth/session" { return (200, metadata(enabled: false)) }
            return (409, ["error": "Quote no longer usable", "billingOperation": ["id": "isolated-operation", "status": "not_started"]])
        }
        ReaderToolsURLProtocol.install(probe)
        let tools = ReaderCloudTools(); tools.question = "Preserve my words."
        await tools.prepare("conversation", session: fixture.session, cloud: fixture.cloud)
        let original = try XCTUnwrap(tools.consent)
        await tools.perform(original, cloud: fixture.cloud)
        XCTAssertNil(tools.retry)
        XCTAssertEqual(tools.question, "Preserve my words.")
        await tools.prepare("conversation", session: fixture.session, cloud: fixture.cloud)
        XCTAssertNotNil(tools.consent)
        XCTAssertNotEqual(tools.consent?.id, original.id)
    }
    func testCompanionKeepsCapturedQuoteAfterNativeSelectionIsDismissed() async throws {
        let fixture = try await fixture(source: "Selected first thought.\n\nNow reading another thought."), probe = ReaderToolsProbe()
        let selected = SelectedQuote(anchor: ReadingAnchor(chapterID: fixture.session.chapter.id, passageID: fixture.passage.id), text: fixture.passage.text, sourceText: fixture.passage.text)
        fixture.session.selection = selected
        fixture.session.clearTransientSelection()
        let next = try XCTUnwrap(fixture.session.chapter.passages.last)
        fixture.session.recordVisible(ReadingAnchor(chapterID: fixture.session.chapter.id, passageID: next.id), navigationID: fixture.session.navigationID)
        XCTAssertNotEqual(next.id, selected.anchor.passageID)
        XCTAssertEqual(ReaderCloudTools.currentPassage(fixture.session)?.id, next.id)
        XCTAssertEqual(ReaderCloudTools.currentPassage(fixture.session, selection: selected)?.id, selected.anchor.passageID)
        probe.respond = { [self] request, _ in
            if request.url!.path == "/api/auth/session" { return (200, metadata(enabled: false)) }
            let components = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)
            XCTAssertEqual(components?.queryItems?.first { $0.name == "passageId" }?.value, selected.anchor.passageID)
            return (200, ["available": true, "scope": ["mode": "book", "revision": 0], "turns": []])
        }
        ReaderToolsURLProtocol.install(probe)
        let tools = ReaderCloudTools(); tools.question = "Explain my captured selection."
        await tools.loadConversation(fixture.session, cloud: fixture.cloud, selection: selected)
        await tools.prepare("conversation", session: fixture.session, cloud: fixture.cloud, selection: selected)
        let consent = try XCTUnwrap(tools.consent)
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: consent.body) as? [String: Any])
        XCTAssertEqual(body["passageId"] as? String, selected.anchor.passageID)
        XCTAssertTrue(ReaderPanel.companion(selected).isCompanion)
        XCTAssertTrue(ReaderPanel.conversation.isCompanion)
        XCTAssertFalse(ReaderPanel.records.isCompanion)
    }
}

private final class ReaderToolsProbe: @unchecked Sendable {
    var respond: ((URLRequest, [String: Any]) throws -> (Int, [String: Any]))?
    private let lock = NSLock()
    private var captured: [URLRequest] = []
    var requests: [URLRequest] { lock.lock(); defer { lock.unlock() }; return captured }
    func response(_ request: URLRequest) throws -> (Int, [String: Any]) {
        lock.lock(); captured.append(request); lock.unlock()
        var bytes = request.httpBody
        if bytes == nil, let stream = request.httpBodyStream {
            stream.open(); defer { stream.close() }
            var value = Data(), buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                guard count > 0 else { break }
                value.append(contentsOf: buffer.prefix(count))
            }
            bytes = value
        }
        let body = bytes.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
        return try XCTUnwrap(respond)(request, body)
    }
}
private final class ReaderToolsURLProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    private static var probe: ReaderToolsProbe?
    static func install(_ value: ReaderToolsProbe?) { lock.lock(); probe = value; lock.unlock() }
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "leafhour.test" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock(); let probe = Self.probe; Self.lock.unlock()
        do {
            let (status, value) = try XCTUnwrap(probe).response(request)
            let response = try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"]))
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: try JSONSerialization.data(withJSONObject: value))
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() { }
}
