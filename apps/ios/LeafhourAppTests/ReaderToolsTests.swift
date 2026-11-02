import XCTest
import Foundation
import UIKit
import SwiftUI
import Vision
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
    private func fixture(source: String = "A 😀 café and a quiet page.", markdown: Bool = false, cloudBook: Bool = true) async throws -> Fixture {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent(markdown ? "reader.md" : "reader.txt")
        try Data(source.utf8).write(to: file)
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .device)
        var book = try await library.importFile(file)
        if cloudBook { book.cloud = CloudBookIdentity(ownerID: owner, bookID: "cloud-book", contentVersion: "source-v1", sourceFormat: markdown ? "md" : "txt") }
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
    func testOpeningToolsKeepsPauseReachableAndManualPauseSurvivesClosingTools() async throws {
        let fixture = try await fixture(cloudBook: false)
        let session = fixture.session
        session.moved(ReadingAnchor(chapterID: session.chapter.id, passageID: fixture.passage.id))
        session.setReadingVisible(true); session.startReadingTime()
        XCTAssertNil(session.readingTimeError)
        session.setReadingVisible(false)
        XCTAssertEqual(session.readingTimePhase, .paused)
        XCTAssertTrue(session.readingTimeWantsRunning)
        let controls = ReaderTimeControls(session: session)
        let host = UIHostingController(rootView: NavigationStack { Form { controls }.navigationTitle("阅读工具") })
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        window.rootViewController = host; window.makeKeyAndVisible(); host.view.frame = window.bounds
        defer { window.isHidden = true; window.rootViewController = nil }
        try await Task.sleep(for: .milliseconds(180)); host.view.layoutIfNeeded()
        func renderedText(_ name: String) throws -> String {
            let image = UIGraphicsImageRenderer(size: window.bounds.size).image { _ in
                XCTAssertTrue(host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true))
            }
            let attachment = XCTAttachment(image: image); attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate; request.recognitionLanguages = ["zh-Hans", "en-US"]; request.usesLanguageCorrection = false
            try VNImageRequestHandler(cgImage: XCTUnwrap(image.cgImage)).perform([request])
            return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n").replacingOccurrences(of: " ", with: "")
        }
        let automaticPause = try renderedText("Reading tools · automatic pause retains Pause action")
        XCTAssertTrue(automaticPause.contains("暂停计时"), automaticPause)
        XCTAssertFalse(automaticPause.contains("继续计时"), automaticPause)
        // Exercise the same action used by the rendered production button.
        controls.toggleRecording()
        XCTAssertFalse(session.readingTimeWantsRunning)
        session.setReadingVisible(true)
        XCTAssertEqual(session.readingTimePhase, .paused, "Closing a tool must not undo a manual pause")
        try await Task.sleep(for: .milliseconds(100)); host.view.layoutIfNeeded()
        let manualPause = try renderedText("Reading tools · manual pause offers Continue")
        XCTAssertTrue(manualPause.contains("继续计时"), manualPause)
        session.finishReadingTime(); _ = await session.flushReadingTime()
    }
    func testReadingTimeToolsRenderAtSystemSizesWithoutStartingOrStampingActivity() async throws {
        let fixture = try await fixture()
        let originalActivity = fixture.session.state.lastActivityAt
        for typeSize in [DynamicTypeSize.large, .accessibility5] {
            let content = NavigationStack {
                Form { ReaderTimeControls(session: fixture.session) }.navigationTitle("阅读时间")
            }.environment(\.dynamicTypeSize, typeSize)
            let host = UIHostingController(rootView: content)
            let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
            window.rootViewController = host; window.makeKeyAndVisible()
            host.view.frame = window.bounds; host.view.layoutIfNeeded()
            try await Task.sleep(for: .milliseconds(150))
            host.view.layoutIfNeeded()
            let image = UIGraphicsImageRenderer(size: window.bounds.size).image { _ in
                XCTAssertTrue(host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true))
            }
            let attachment = XCTAttachment(image: image)
            attachment.name = "Reading time tools · " + String(describing: typeSize)
            attachment.lifetime = .keepAlways; add(attachment)
            XCTAssertEqual(fixture.session.readingTimePhase, .idle)
            XCTAssertEqual(fixture.session.readingTimeDurationSeconds, 0)
            XCTAssertEqual(fixture.session.state.lastActivityAt, originalActivity)
            window.isHidden = true; window.rootViewController = nil
        }
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
            if request.url!.path == "/api/billing/quotes" { return (200, self.quote(body, action: "conversation")) }
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url!.path, "/api/library/books/cloud-book/chat")
            return (200, ["id": body["id"] ?? "", "text": body["text"] ?? "", "status": "completed", "answer": ["summary": "Selected source answer"]])
        }
        ReaderToolsURLProtocol.install(probe)
        let tools = ReaderCloudTools(); tools.question = "What does this mean?"
        await tools.prepare("conversation", session: fixture.session, cloud: fixture.cloud)
        XCTAssertNil(tools.consent); XCTAssertNil(tools.retry); XCTAssertNil(tools.error)
        let posts = probe.posts(to: "/api/library/books/cloud-book/chat")
        XCTAssertEqual(posts.count, 1)
        let submitted = try XCTUnwrap(posts.first)
        let body = submitted.json
        XCTAssertEqual(tools.turns.last?.id, body["id"] as? String)
        XCTAssertEqual((body["billing"] as? [String: String])?["quoteId"], "quote-test")
        let quote = try XCTUnwrap(body["quote"] as? [String: Any])
        let part = try XCTUnwrap((quote["parts"] as? [[String: Any]])?.first)
        XCTAssertEqual(part["start"] as? Int, 2)
        XCTAssertEqual(part["end"] as? Int, 9)
        XCTAssertEqual(part["text"] as? String, "😀 café")
        XCTAssertEqual((fixture.passage.text as NSString).substring(with: NSRange(location: 2, length: 7)), "😀 café")
        XCTAssertNil(body["notes"])
        XCTAssertNil(body["drafts"])
        XCTAssertNil(body["preferenceWrites"])
        XCTAssertFalse(String(decoding: submitted.data, as: UTF8.self).contains("PRIVATE NOTE"))
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
        probe.respond = { [self] request, body in
            if request.url!.path == "/api/auth/session" { return (200, metadata(enabled: false)) }
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url!.path, "/api/library/books/cloud-book/chat")
            return (200, ["id": body["id"] ?? "", "text": body["text"] ?? "", "status": "completed", "answer": ["summary": "Source answer"]])
        }
        ReaderToolsURLProtocol.install(probe)
        let tools = ReaderCloudTools(); tools.question = "Explain the selected sentence."
        await tools.prepare("conversation", session: fixture.session, cloud: fixture.cloud)
        XCTAssertNil(tools.consent); XCTAssertNil(tools.retry)
        let posts = probe.posts(to: "/api/library/books/cloud-book/chat")
        XCTAssertEqual(posts.count, 1)
        let body = try XCTUnwrap(posts.first).json
        XCTAssertEqual(tools.turns.last?.id, body["id"] as? String)
        let quote = try XCTUnwrap(body["quote"] as? [String: Any])
        let part = try XCTUnwrap((quote["parts"] as? [[String: Any]])?.first)
        XCTAssertEqual(part["text"] as? String, raw)
        let start = try XCTUnwrap(part["start"] as? Int), end = try XCTUnwrap(part["end"] as? Int)
        XCTAssertEqual((fixture.passage.text as NSString).substring(with: NSRange(location: start, length: end - start)), raw)
        XCTAssertNil(tools.error)
    }
    func testLongMixedQuoteKeepsRawScalarOffsetThroughPlainAndMarkdownReflow() async throws {
        let raw = String(repeating: "a字😀e\u{301} ", count: 220) + "**bold** &amp; tail😀 end"
        let rawRange = (raw as NSString).range(of: "tail😀")
        let expectedScalar = (raw as NSString).substring(to: rawRange.location).unicodeScalars.count
        for markdown in [false, true] {
            let fixture = try await fixture(source: raw, markdown: markdown)
            let reading = TextReadingView(session: fixture.session, onNote: { _ in }, onSource: { _ in }, onWake: { _ in }, onReadingScroll: { })
            let coordinator = reading.makeCoordinator(), view = UITextView(frame: CGRect(x: 0, y: 0, width: 390, height: 700))
            coordinator.view = view; coordinator.updateContent(view)
            for fontSize in [22.0, 26.0] {
                var preferences = fixture.session.state.preferences; preferences.fontSize = fontSize
                fixture.session.changePreferences(preferences); coordinator.updateContent(view)
                let range = (view.text as NSString).range(of: "tail😀")
                XCTAssertNotEqual(range.location, NSNotFound)
                let selected = try XCTUnwrap(coordinator.selectedQuote(in: view, range: range))
                XCTAssertEqual(selected.text, "tail😀")
                XCTAssertEqual(selected.sourceText, "tail😀")
                XCTAssertEqual(selected.anchor.characterOffset, expectedScalar)
                XCTAssertEqual(selected.anchor.passageID, fixture.passage.id)
                let span = try XCTUnwrap(coordinator.spans.first)
                XCTAssertEqual(span.sourceOffsets.utf16Offset(forScalarOffset: expectedScalar), rawRange.location)
            }
            coordinator.invalidate()
            XCTAssertTrue(coordinator.spans.isEmpty)
            XCTAssertNil(coordinator.markdown)
            _ = await fixture.session.flush()
        }
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
        XCTAssertNil(tools.consent); XCTAssertNil(tools.retry)
        XCTAssertEqual(tools.question, "Keep this question.")
        let original = try XCTUnwrap(probe.posts(to: "/api/library/books/cloud-book/chat").first)
        await tools.loadConversation(fixture.session, cloud: fixture.cloud)
        await tools.prepare("conversation", session: fixture.session, cloud: fixture.cloud)
        let posts = probe.posts(to: "/api/library/books/cloud-book/chat")
        XCTAssertEqual(posts.count, 2)
        let refreshed = try XCTUnwrap(posts.last)
        XCTAssertNotEqual(original.json["id"] as? String, refreshed.json["id"] as? String)
        XCTAssertEqual(refreshed.json["scopeRevision"] as? Int, 3)
        XCTAssertEqual(refreshed.json["text"] as? String, "Keep this question.")
        XCTAssertNil(tools.consent); XCTAssertNil(tools.retry)
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
        let original = try XCTUnwrap(probe.posts(to: "/api/library/books/cloud-book/chat").first)
        let retry = try XCTUnwrap(tools.retry)
        XCTAssertEqual(retry.id, original.json["id"] as? String)
        XCTAssertEqual(retry.body, original.data)
        let before = probe.requests.count
        await tools.prepare("conversation", session: fixture.session, cloud: fixture.cloud)
        XCTAssertNil(tools.consent)
        XCTAssertEqual(probe.requests.count, before)
        XCTAssertEqual(tools.question, "Keep the original request.")
        await tools.perform(retry, cloud: fixture.cloud)
        let posts = probe.posts(to: "/api/library/books/cloud-book/chat")
        XCTAssertEqual(posts.count, 2)
        XCTAssertEqual(posts.first?.data, posts.last?.data)
        XCTAssertEqual(tools.retry?.id, retry.id)
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
        let original = try XCTUnwrap(probe.posts(to: "/api/library/books/cloud-book/chat").first)
        XCTAssertNil(tools.consent); XCTAssertNil(tools.retry)
        XCTAssertEqual(tools.generationTerminalStatus, "not_started")
        XCTAssertEqual(tools.question, "Preserve my words.")
        await tools.prepare("conversation", session: fixture.session, cloud: fixture.cloud)
        let posts = probe.posts(to: "/api/library/books/cloud-book/chat")
        XCTAssertEqual(posts.count, 2)
        XCTAssertNotEqual(posts.last?.json["id"] as? String, original.json["id"] as? String)
        XCTAssertEqual(posts.last?.json["text"] as? String, "Preserve my words.")
        XCTAssertNil(tools.consent); XCTAssertNil(tools.retry)
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
        probe.respond = { [self] request, body in
            if request.url!.path == "/api/auth/session" { return (200, metadata(enabled: false)) }
            if request.httpMethod == "POST" {
                XCTAssertEqual(body["passageId"] as? String, selected.anchor.passageID)
                return (200, ["id": body["id"] ?? "", "text": body["text"] ?? "", "status": "completed", "answer": ["summary": "Captured source answer"]])
            }
            let components = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)
            XCTAssertEqual(components?.queryItems?.first { $0.name == "passageId" }?.value, selected.anchor.passageID)
            return (200, ["available": true, "scope": ["mode": "book", "revision": 0], "turns": []])
        }
        ReaderToolsURLProtocol.install(probe)
        let tools = ReaderCloudTools(); tools.question = "Explain my captured selection."
        await tools.loadConversation(fixture.session, cloud: fixture.cloud, selection: selected)
        await tools.prepare("conversation", session: fixture.session, cloud: fixture.cloud, selection: selected)
        XCTAssertNil(tools.consent); XCTAssertNil(tools.retry); XCTAssertNil(tools.error)
        let posts = probe.posts(to: "/api/library/books/cloud-book/chat")
        XCTAssertEqual(posts.count, 1)
        let body = try XCTUnwrap(posts.first).json
        XCTAssertEqual(body["passageId"] as? String, selected.anchor.passageID)
        XCTAssertTrue(ReaderPanel.companion(selected).isCompanion)
        XCTAssertTrue(ReaderPanel.conversation.isCompanion)
        XCTAssertFalse(ReaderPanel.records.isCompanion)
    }
    func testGlobalChatLoadsRealContextWithoutDownloadingAndRetainsHistoryOnRefreshFailure() async throws {
        let fixture = try await fixture(), tools = ReaderCloudTools()
        let book = CloudShelfBook(id: "cloud-book", title: "A book", author: "", contentVersion: "source-v1")
        let probe = ReaderToolsProbe()
        probe.respond = { request, _ in
            XCTAssertEqual(request.url?.path, "/api/library/books/cloud-book/chat")
            XCTAssertNil(request.url?.query)
            return (200, ["bookId": "cloud-book", "contentVersion": "source-v1", "available": true,
                "context": ["passageId": "source-p1", "original": "Actual source", "chapterTitle": "Chapter"],
                "turns": [["id": "old-turn", "text": "My question", "status": "completed", "answer": ["summary": "Saved answer"]]]])
        }
        ReaderToolsURLProtocol.install(probe)
        await tools.loadConversation(book: book, ownerID: owner, cloud: fixture.cloud)
        XCTAssertEqual(tools.chatContext?.original, "Actual source")
        XCTAssertEqual(tools.turns.first?.answer, "Saved answer")
        XCTAssertEqual(probe.requests.count, 1)
        tools.question = "An unfinished question"
        let failed = ReaderToolsProbe(); failed.respond = { _, _ in throw URLError(.notConnectedToInternet) }
        ReaderToolsURLProtocol.install(failed)
        await tools.loadConversation(book: book, ownerID: owner, cloud: fixture.cloud)
        XCTAssertEqual(tools.turns.first?.answer, "Saved answer")
        XCTAssertEqual(tools.question, "An unfinished question")
        XCTAssertEqual(tools.chatContext?.original, "Actual source")
        XCTAssertNotNil(tools.error)
    }

    func testConversationDraftAndUncertainRequestRestoreWithTheSameIdentity() async throws {
        let fixture = try await fixture()
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = try OfflineLibrary(root: root, scope: .account(XCTUnwrap(UUID(uuidString: owner))))
        let identity = CloudBookIdentity(ownerID: owner, bookID: "cloud-book", contentVersion: "source-v1", sourceFormat: "txt")
        let tools = ReaderCloudTools()
        await tools.restoreConversationDraft(identity: identity, library: library)
        tools.question = "Keep this draft after relaunch"
        let probe = ReaderToolsProbe(); probe.respond = { [self] request, _ in
            if request.url?.path == "/api/auth/session" { return (200, metadata(enabled: false)) }
            throw URLError(.networkConnectionLost)
        }
        ReaderToolsURLProtocol.install(probe)
        await tools.prepare("conversation", session: fixture.session, cloud: fixture.cloud)
        XCTAssertNil(tools.consent)
        let intent = try XCTUnwrap(tools.retry)
        let initialPosts = probe.posts(to: "/api/library/books/cloud-book/chat")
        XCTAssertEqual(initialPosts.count, 1)
        XCTAssertEqual(initialPosts.first?.data, intent.body)
        XCTAssertEqual(initialPosts.first?.json["id"] as? String, intent.id)
        let saved = await tools.flushConversationDraft(); XCTAssertTrue(saved)
        let restored = ReaderCloudTools()
        await restored.restoreConversationDraft(identity: identity, library: library)
        XCTAssertEqual(restored.question, "Keep this draft after relaunch")
        let retry = try XCTUnwrap(restored.retry)
        XCTAssertEqual(retry.id, intent.id); XCTAssertEqual(retry.body, intent.body)
        let completed = ReaderToolsProbe(); completed.respond = { _, body in
            XCTAssertEqual(body["id"] as? String, intent.id)
            return (200, ["id": intent.id, "text": "Keep this draft after relaunch", "status": "completed", "answer": ["summary": "Recovered answer"]])
        }
        ReaderToolsURLProtocol.install(completed)
        // A newer edit must survive the earlier request's successful answer.
        restored.question = "A newer draft"
        await restored.perform(retry, cloud: fixture.cloud)
        XCTAssertEqual(restored.question, "A newer draft")
        XCTAssertEqual(restored.turns.last?.answer, "Recovered answer")
        XCTAssertNil(restored.retry)
        let flushed = await restored.flushConversationDraft(); XCTAssertTrue(flushed)
        let otherBook = ReaderCloudTools()
        await otherBook.restoreConversationDraft(identity: CloudBookIdentity(ownerID: owner, bookID: "other-book", contentVersion: "source-v1", sourceFormat: "txt"), library: library)
        XCTAssertTrue(otherBook.question.isEmpty)
    }

    func testGlobalChatDraftKeepsItsOriginalContextUntilExplicitlyChanged() async throws {
        let fixture = try await fixture(), tools = ReaderCloudTools()
        let book = CloudShelfBook(id: "cloud-book", title: "Book", author: "", contentVersion: "source-v1")
        func install(_ passage: String) {
            let probe = ReaderToolsProbe(); probe.respond = { _, _ in
                (200, ["bookId": "cloud-book", "contentVersion": "source-v1", "available": true,
                    "context": ["passageId": passage, "original": passage, "chapterTitle": "Chapter"], "turns": []])
            }; ReaderToolsURLProtocol.install(probe)
        }
        install("first"); await tools.loadConversation(book: book, ownerID: owner, cloud: fixture.cloud)
        tools.question = "About the first passage"
        install("second"); await tools.loadConversation(book: book, ownerID: owner, cloud: fixture.cloud)
        XCTAssertEqual(tools.chatContext?.passageID, "first")
        XCTAssertTrue(tools.canUpdateChatContext)
        tools.updateChatContext()
        XCTAssertEqual(tools.chatContext?.passageID, "second")
        XCTAssertEqual(tools.question, "About the first passage")
    }

    func testAQuestionTypedBeforeContextLoadsPersistsTheFirstVisibleSource() async throws {
        let fixture = try await fixture(), tools = ReaderCloudTools()
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = try OfflineLibrary(root: root, scope: .account(XCTUnwrap(UUID(uuidString: owner))))
        let identity = CloudBookIdentity(ownerID: owner, bookID: "cloud-book", contentVersion: "source-v1", sourceFormat: "")
        await tools.restoreConversationDraft(identity: identity, library: library)
        tools.question = "Written before the first context arrived"
        let probe = ReaderToolsProbe(); probe.respond = { _, _ in
            (200, ["bookId": "cloud-book", "contentVersion": "source-v1", "available": true,
                "context": ["passageId": "p1", "original": "First visible source", "chapterTitle": "Chapter"], "turns": []])
        }; ReaderToolsURLProtocol.install(probe)
        await tools.loadConversation(book: CloudShelfBook(id: "cloud-book", title: "Book", author: "", contentVersion: "source-v1"), ownerID: owner, cloud: fixture.cloud)
        let flushed = await tools.flushConversationDraft(); XCTAssertTrue(flushed)
        let restored = ReaderCloudTools()
        await restored.restoreConversationDraft(identity: identity, library: library)
        XCTAssertEqual(restored.question, "Written before the first context arrived")
        XCTAssertEqual(restored.chatContext?.original, "First visible source")
    }

    func testChangingTheEndOfAnOriginalSelectionAllowsAnExplicitContextSwitch() async throws {
        let fixture = try await fixture(), tools = ReaderCloudTools()
        let probe = ReaderToolsProbe(); probe.respond = { _, _ in (200, ["available": true, "turns": []]) }
        ReaderToolsURLProtocol.install(probe)
        let anchor = ReadingAnchor(chapterID: fixture.session.chapter.id, passageID: fixture.passage.id)
        let short = SelectedQuote(anchor: anchor, text: "A")
        let longer = SelectedQuote(anchor: anchor, text: "A 😀")
        XCTAssertEqual(short.id, longer.id, "Existing note identity remains stable")
        await tools.loadConversation(fixture.session, cloud: fixture.cloud, selection: short)
        tools.question = "Keep the original range"
        await tools.loadConversation(fixture.session, cloud: fixture.cloud, selection: longer)
        XCTAssertTrue(tools.canUpdateChatContext)
        XCTAssertEqual(tools.chatContext?.selection?.text, "A")
        tools.updateChatContext()
        XCTAssertEqual(tools.chatContext?.selection?.text, "A 😀")
        XCTAssertEqual(tools.chatContext?.sourceLabel, "选中的原文")
    }

    func testAccountChatLoadsWithoutABookAndRetainsHistoryWhenRefreshFails() async throws {
        let fixture = try await fixture(), tools = ReaderCloudTools(), probe = ReaderToolsProbe()
        probe.respond = { request, _ in
            XCTAssertEqual(request.url?.path, "/api/library/chat")
            XCTAssertEqual(request.httpMethod, "GET")
            return (200, ["bookId": ReaderCloudTools.libraryChatID, "contentVersion": ReaderCloudTools.libraryChatVersion,
                "scope": ["mode": "library", "revision": 0], "available": true, "context": NSNull(),
                "turns": [["id": "account-answer", "text": "Hello", "status": "completed", "answer": ["summary": "Saved reply"]]]])
        }
        ReaderToolsURLProtocol.install(probe)
        await tools.loadLibraryConversation(ownerID: owner, cloud: fixture.cloud)
        XCTAssertTrue(tools.conversationAvailable); XCTAssertEqual(tools.scope, "library")
        XCTAssertNil(tools.chatContext); XCTAssertEqual(probe.requests.count, 1)
        tools.question = "An unfinished thought"
        let failed = ReaderToolsProbe(); failed.respond = { _, _ in throw URLError(.notConnectedToInternet) }
        ReaderToolsURLProtocol.install(failed)
        await tools.loadLibraryConversation(ownerID: owner, cloud: fixture.cloud)
        XCTAssertEqual(tools.turns.first?.answer, "Saved reply")
        XCTAssertEqual(tools.question, "An unfinished thought"); XCTAssertNotNil(tools.error)
    }

    func testAccountChatDraftAndUncertainRequestKeepTheirOwnIdentityAfterRestart() async throws {
        let fixture = try await fixture(), tools = ReaderCloudTools()
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = try OfflineLibrary(root: root, scope: .account(XCTUnwrap(UUID(uuidString: owner))))
        let identity = ReaderCloudTools.libraryChatIdentity(ownerID: owner)
        await tools.restoreConversationDraft(identity: identity, library: library)
        tools.question = "No book is needed for this question"; tools.scope = "library"
        let probe = ReaderToolsProbe(); probe.respond = { [self] request, _ in
            if request.url?.path == "/api/auth/session" { return (200, metadata(enabled: false)) }
            XCTAssertEqual(request.url?.path, "/api/library/chat")
            throw URLError(.networkConnectionLost)
        }
        ReaderToolsURLProtocol.install(probe)
        await tools.prepareLibraryConversation(ownerID: owner, cloud: fixture.cloud)
        XCTAssertNil(tools.consent)
        let intent = try XCTUnwrap(tools.retry)
        XCTAssertEqual(intent.path, "/api/library/chat"); XCTAssertFalse(intent.explanation.contains("原文："))
        let posts = probe.posts(to: "/api/library/chat")
        XCTAssertEqual(posts.count, 1)
        XCTAssertEqual(posts.first?.data, intent.body)
        XCTAssertEqual(posts.first?.json["id"] as? String, intent.id)
        let flushed = await tools.flushConversationDraft(); XCTAssertTrue(flushed)
        let restored = ReaderCloudTools()
        await restored.restoreConversationDraft(identity: identity, library: library)
        XCTAssertEqual(restored.question, "No book is needed for this question")
        XCTAssertEqual(restored.retry?.id, intent.id); XCTAssertEqual(restored.retry?.body, intent.body)
        XCTAssertNil(restored.chatContext)
        let bookDraft = try await library.conversationDraft(bookID: "cloud-book", ownerID: owner)
        XCTAssertNil(bookDraft)
    }

    func testAccountConversationStillValidatesItsPaidQuoteBeforeSending() async throws {
        let fixture = try await fixture(), tools = ReaderCloudTools(), probe = ReaderToolsProbe()
        tools.question = "Talk to me"; tools.scope = "library"
        probe.respond = { [self] request, body in
            if request.url?.path == "/api/auth/session" { return (200, metadata()) }
            if request.url?.path == "/api/billing/quotes" {
                XCTAssertEqual(body["bookId"] as? String, ReaderCloudTools.libraryChatID)
                let input = try XCTUnwrap(body["input"] as? [String: Any])
                return (200, ["id": "account-quote", "ownerId": owner, "action": "conversation", "units": 4_000_000, "mode": "test",
                    "scope": ["bookId": ReaderCloudTools.libraryChatID, "contentVersion": ReaderCloudTools.libraryChatVersion,
                        "passageId": ReaderCloudTools.libraryChatPassage, "requestId": try XCTUnwrap(input["id"] as? String)]])
            }
            XCTAssertEqual(request.url?.path, "/api/library/chat"); XCTAssertEqual(request.httpMethod, "POST")
            return (200, ["id": body["id"] ?? "", "text": body["text"] ?? "", "status": "completed", "answer": ["summary": "Paid reply"]])
        }
        ReaderToolsURLProtocol.install(probe)
        await tools.prepareLibraryConversation(ownerID: owner, cloud: fixture.cloud)
        XCTAssertNil(tools.consent); XCTAssertNil(tools.retry); XCTAssertNil(tools.error)
        let quotes = probe.posts(to: "/api/billing/quotes"), posts = probe.posts(to: "/api/library/chat")
        XCTAssertEqual(quotes.count, 1); XCTAssertEqual(posts.count, 1)
        let body = try XCTUnwrap(posts.first).json
        let input = try XCTUnwrap(quotes.first?.json["input"] as? [String: Any])
        XCTAssertEqual(body["id"] as? String, input["id"] as? String)
        XCTAssertEqual((body["billing"] as? [String: String])?["quoteId"], "account-quote")
        XCTAssertFalse(try XCTUnwrap((body["billing"] as? [String: String])?["idempotencyKey"]).isEmpty)
        XCTAssertEqual(tools.turns.last?.id, body["id"] as? String)
        XCTAssertEqual(tools.turns.last?.answer, "Paid reply"); XCTAssertTrue(tools.question.isEmpty)
        XCTAssertEqual(probe.requests.map { $0.url!.path }, ["/api/auth/session", "/api/billing/quotes", "/api/library/chat"])
    }

    func testDirectPaidConversationRetryReusesWireBodyWithoutAnotherQuote() async throws {
        let fixture = try await fixture(), tools = ReaderCloudTools(), probe = ReaderToolsProbe()
        tools.question = "Keep one paid request."
        var attempts = 0
        probe.respond = { [self] request, body in
            if request.url?.path == "/api/auth/session" { return (200, metadata()) }
            if request.url?.path == "/api/billing/quotes" { return (200, quote(body, action: "conversation")) }
            XCTAssertEqual(request.url?.path, "/api/library/books/cloud-book/chat")
            attempts += 1
            if attempts == 1 { return (503, ["error": "Temporary interruption"]) }
            return (200, ["id": body["id"] ?? "", "text": body["text"] ?? "", "status": "completed", "answer": ["summary": "One paid answer"]])
        }
        ReaderToolsURLProtocol.install(probe)
        await tools.prepare("conversation", session: fixture.session, cloud: fixture.cloud)
        XCTAssertNil(tools.consent)
        let retry = try XCTUnwrap(tools.retry)
        let original = try XCTUnwrap(probe.posts(to: "/api/library/books/cloud-book/chat").first)
        XCTAssertEqual(retry.id, original.json["id"] as? String)
        XCTAssertEqual(retry.body, original.data)
        XCTAssertEqual(tools.question, "Keep one paid request.")
        await tools.perform(retry, cloud: fixture.cloud)
        let posts = probe.posts(to: "/api/library/books/cloud-book/chat")
        XCTAssertEqual(posts.count, 2)
        XCTAssertEqual(posts.first?.data, posts.last?.data)
        XCTAssertEqual(posts.first?.json["billing"] as? [String: String], posts.last?.json["billing"] as? [String: String])
        XCTAssertEqual(probe.posts(to: "/api/billing/quotes").count, 1)
        XCTAssertNil(tools.retry); XCTAssertNil(tools.error)
        XCTAssertEqual(tools.turns.last?.id, retry.id)
        XCTAssertEqual(tools.turns.last?.answer, "One paid answer"); XCTAssertTrue(tools.question.isEmpty)
    }

    func testInvalidPaidConversationQuoteNeverSubmitsAndPreservesQuestion() async throws {
        let fixture = try await fixture(), tools = ReaderCloudTools(), probe = ReaderToolsProbe()
        tools.question = "Keep my question."
        probe.respond = { [self] request, body in
            if request.url?.path == "/api/auth/session" { return (200, metadata()) }
            XCTAssertEqual(request.url?.path, "/api/billing/quotes")
            var value = quote(body, action: "conversation")
            value["ownerId"] = "another-owner"
            return (200, value)
        }
        ReaderToolsURLProtocol.install(probe)
        await tools.prepare("conversation", session: fixture.session, cloud: fixture.cloud)
        XCTAssertEqual(probe.posts(to: "/api/billing/quotes").count, 1)
        XCTAssertTrue(probe.posts(to: "/api/library/books/cloud-book/chat").isEmpty)
        XCTAssertNil(tools.consent); XCTAssertNil(tools.retry); XCTAssertNotNil(tools.error)
        XCTAssertEqual(tools.question, "Keep my question."); XCTAssertTrue(tools.turns.isEmpty)
    }

    func testLongOrdinaryQuestionSubmitsDirectlyWithoutTruncation() async throws {
        let fixture = try await fixture(), tools = ReaderCloudTools(), probe = ReaderToolsProbe()
        let text = String(repeating: "中文 question 😀\n", count: 350)
        XCTAssertGreaterThan(text.count, 2000)
        tools.question = text
        probe.respond = { [self] request, body in
            if request.url?.path == "/api/auth/session" { return (200, metadata(enabled: false)) }
            XCTAssertEqual(request.url?.path, "/api/library/books/cloud-book/chat"); XCTAssertEqual(request.httpMethod, "POST")
            return (200, ["id": body["id"] ?? "", "text": body["text"] ?? "", "status": "completed", "answer": ["summary": "Long question received"]])
        }
        ReaderToolsURLProtocol.install(probe)
        await tools.prepare("conversation", session: fixture.session, cloud: fixture.cloud)
        let posts = probe.posts(to: "/api/library/books/cloud-book/chat")
        XCTAssertEqual(posts.count, 1)
        let body = try XCTUnwrap(posts.first).json
        XCTAssertEqual(body["text"] as? String, text.trimmingCharacters(in: .whitespacesAndNewlines))
        XCTAssertNil(tools.consent); XCTAssertNil(tools.retry); XCTAssertNil(tools.error)
        XCTAssertEqual(tools.turns.last?.id, body["id"] as? String)
        XCTAssertTrue(tools.question.isEmpty)
    }
}

private final class ReaderToolsProbe: @unchecked Sendable {
    var respond: ((URLRequest, [String: Any]) throws -> (Int, [String: Any]))?
    private let lock = NSLock()
    struct Submission {
        let request: URLRequest
        let data: Data
        var json: [String: Any] { (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:] }
    }
    private var captured: [URLRequest] = []
    private var submissions: [Submission] = []
    var requests: [URLRequest] { lock.lock(); defer { lock.unlock() }; return captured }
    func posts(to path: String) -> [Submission] {
        lock.lock(); defer { lock.unlock() }
        return submissions.filter { $0.request.httpMethod == "POST" && $0.request.url?.path == path }
    }
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
        if let bytes { lock.lock(); submissions.append(Submission(request: request, data: bytes)); lock.unlock() }
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

extension ReaderToolsTests {
    func testVoiceDraftRetainsOriginalAndTranscriptAcrossConversationRecreation() async throws {
        let fixture = try await fixture()
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let library = try OfflineLibrary(root: root, scope: .account(try XCTUnwrap(UUID(uuidString: owner))))
        let source = root.appendingPathComponent("synthetic-voice.caf")
        let bytes = Data("caff-synthetic-retained-voice".utf8)
        try bytes.write(to: source)
        let tools = ReaderCloudTools(), identity = ReaderCloudTools.libraryChatIdentity(ownerID: owner)
        await tools.restoreConversationDraft(identity: identity, library: library)
        try await tools.attachVoice(ChatRecordedVoice(id: UUID(), url: source, durationMs: 1200, transcript: "保留这段转写文字。"))
        let receipt = try XCTUnwrap(tools.pendingVoice)
        XCTAssertEqual(tools.question, "保留这段转写文字。")
        let recreated = ReaderCloudTools()
        await recreated.restoreConversationDraft(identity: identity, library: library)
        XCTAssertEqual(recreated.pendingVoice, receipt)
        XCTAssertEqual(recreated.question, tools.question)
        let url = try await recreated.voiceURL(receipt, cloud: fixture.cloud)
        XCTAssertEqual(try Data(contentsOf: url), bytes)
        XCTAssertNil(recreated.consent)
    }
}
