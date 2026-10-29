import XCTest
import Foundation
import LeafhourCore
@testable import Leafhour

@MainActor
final class LibraryRecordsTests: XCTestCase {
    private let owner = "00000000-0000-4000-8000-000000000318"
    private func fixture() throws -> (LibraryModel, RecordsProbe) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let probe = RecordsProbe(owner: owner)
        RecordsURLProtocol.install(probe)
        addTeardownBlock { try? FileManager.default.removeItem(at: root); RecordsURLProtocol.install(nil) }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [RecordsURLProtocol.self]
        let credential = CloudCredential(account: CloudAccount(id: owner, email: nil), token: "isolated-records-fixture")
        let cloud = CloudLibraryClient(baseURL: URL(string: "https://records.leafhour.test")!, credential: credential, configuration: configuration)
        return (LibraryModel(root: root, cloud: cloud, credential: credential, monitorNetwork: false), probe)
    }
    private func entry(_ id: String = "one") throws -> CloudJSON {
        try CloudJSON.decode(JSONSerialization.data(withJSONObject: ["book": ["bookId": id, "title": "Saved Book"], "records": ["comments": [["id": "note-" + id, "origin": "user", "text": "My saved thought."]], "questions": []]]))
    }
    private func summary(_ seconds: Double) -> CloudJSON {
        .object(["allTime": .object(["durationSeconds": .number(seconds), "readingDays": .number(1)]), "books": .array([])])
    }

    func testNotebookFailureDoesNotBlockIndependentReadingSummary() async throws {
        let (model, probe) = try fixture()
        probe.notebookStatus = 503
        probe.summary = summary(120)
        await model.loadAccountRecords()
        XCTAssertEqual(model.summary["allTime"]["durationSeconds"].number, 120)
        XCTAssertEqual(probe.summaryRequests, 1)
        XCTAssertTrue(model.notebookEntries.isEmpty)
        XCTAssertEqual(model.summaryState, .ready)
        guard case .failed = model.notebookState else { return XCTFail("Notebook failure must remain distinct from an empty notebook") }
    }

    func testNoCacheFailureDoesNotClaimCachedRecordsExist() async throws {
        let (model, probe) = try fixture()
        probe.notebookStatus = 503; probe.summaryStatus = 503
        await model.loadAccountRecords()
        XCTAssertTrue(model.notebookEntries.isEmpty)
        XCTAssertEqual(model.summary, .null)
        XCTAssertFalse(model.syncStatus.contains("缓存"), "A failed read with no cache must never claim to display cached records")
        guard case .failed = model.notebookState, case .failed = model.summaryState else { return XCTFail("Both uncached failures need explicit failure states") }
    }

    func testOfflineNotebookRestoresItsSavedPaginationCursor() async throws {
        let (model, probe) = try fixture()
        let first = try entry()
        let library = try XCTUnwrap(model.library)
        try await library.cacheCloudView("notebook", data: CloudJSON.encode(["entries": .array([first]), "nextCursor": .string("next-page")]))
        probe.notebookStatus = 503; probe.summaryStatus = 503
        await model.loadAccountRecords()
        XCTAssertEqual(model.notebookEntries, [first])
        XCTAssertEqual(model.notebookCursor, "next-page")
        guard case .cached = model.notebookState else { return XCTFail("A real saved notebook must be identified as cached") }
    }

    func testSuccessfulNotebookCacheIncludesPaginationCursor() async throws {
        let (model, probe) = try fixture()
        probe.notebook = .object(["entries": .array([try entry()]), "nextCursor": .string("page-two")])
        await model.loadAccountRecords()
        let library = try XCTUnwrap(model.library)
        let bytes = try await library.cloudView("notebook")
        let cached = try CloudJSON.decode(XCTUnwrap(bytes))
        XCTAssertEqual(cached["nextCursor"].string, "page-two")
        XCTAssertEqual(cached["entries"].array.count, 1)
    }

    func testFailedNextPagePreservesLoadedRowsCursorAndFreshSummary() async throws {
        let (model, probe) = try fixture()
        let first = try entry()
        model.notebookEntries = [first]; model.notebookCursor = "page-two"
        model.summary = summary(240)
        let library = try XCTUnwrap(model.library)
        try await library.cacheCloudView("summary", data: CloudJSON.encode(["allTime": .object(["durationSeconds": .number(60)]), "books": .array([])]))
        probe.notebookStatus = 503
        await model.loadAccountRecords(more: true)
        XCTAssertEqual(model.notebookEntries, [first])
        XCTAssertEqual(model.notebookCursor, "page-two")
        XCTAssertEqual(model.summary["allTime"]["durationSeconds"].number, 240, "A pagination failure must not replace a current summary with an older disk snapshot")
    }

    func testMalformedNotebookIsAFailureRatherThanAnEmptySuccess() async throws {
        let (model, probe) = try fixture()
        probe.notebook = .object([:])
        await model.loadAccountRecords()
        guard case .failed = model.notebookState else { return XCTFail("A response missing entries must not become a successful empty notebook") }
        XCTAssertEqual(model.summaryState, .ready)
    }

    func testSavedSummariesWithoutCacheReportFailureAndCanRetryToAGenuineEmptyResult() async throws {
        let (model, probe) = try fixture()
        let summaries = SavedReadingSummariesModel()
        probe.workspaceStatus = 503
        await summaries.load(model)
        XCTAssertEqual(summaries.workspace, .null)
        guard case .failed = summaries.state else { return XCTFail("A missing offline snapshot must not claim that saved summaries are empty or cached") }
        probe.workspaceStatus = 200
        await summaries.load(model)
        XCTAssertEqual(summaries.state, .ready)
        XCTAssertTrue(summaries.workspace["relations"].array.isEmpty)
        XCTAssertTrue(summaries.workspace["candidates"].array.isEmpty)
    }

    func testSavedSummariesUseOnlyAnActualValidAccountCacheOnFailure() async throws {
        let (model, probe) = try fixture()
        let saved: CloudJSON = .object(["relations": .array([.object(["text": .string("An attributed saved summary"), "noteKeys": .array([.string("note-one")])])]), "candidates": .array([])])
        let library = try XCTUnwrap(model.library)
        try await library.cacheCloudView("workspace", data: JSONEncoder().encode(saved))
        probe.workspaceStatus = 503
        let summaries = SavedReadingSummariesModel()
        await summaries.load(model)
        XCTAssertEqual(summaries.workspace, saved)
        guard case .cached = summaries.state else { return XCTFail("An existing account snapshot should stay available as cached content") }
        await model.signOut()
        await summaries.load(model)
        XCTAssertEqual(summaries.workspace, .null)
        XCTAssertEqual(summaries.state, .idle)
    }

    func testSavedSummaryRefreshKeepsCurrentContentInsteadOfAnOlderDiskSnapshot() async throws {
        let (model, probe) = try fixture()
        probe.workspace = .object(["relations": .array([.object(["text": .string("Latest saved summary")])]), "candidates": .array([])])
        let summaries = SavedReadingSummariesModel()
        await summaries.load(model)
        XCTAssertEqual(summaries.state, .ready)
        let library = try XCTUnwrap(model.library)
        try await library.cacheCloudView("workspace", data: CloudJSON.encode(["relations": .array([]), "candidates": .array([])]))
        probe.workspaceStatus = 503
        await summaries.load(model)
        XCTAssertEqual(summaries.workspace, probe.workspace)
        guard case .cached = summaries.state else { return XCTFail("Current loaded summaries must remain visible during a failed refresh") }
    }

    func testNotebookListSkipsEmptyBooksAndFindsLoadedNotesWithoutChangingRawRecords() throws {
        let empty: CloudJSON = .object(["book": .object(["bookId": .string("empty"), "title": .string("Empty Book")]), "records": .object(["comments": .array([]), "questions": .array([])])])
        let saved = try entry("saved")
        let question: CloudJSON = .object(["book": .object(["bookId": .string("question"), "title": .string("Questions")]), "records": .object(["comments": .array([.object(["text": .string("  ")])]), "questions": .array([.object(["id": .string("q1"), "origin": .string("user"), "text": .string("Why is café used here?"), "status": .string("open")])])])])
        let original = [empty, saved, question]
        XCTAssertEqual(AccountRecordsPresentation.notebookBooks(original).map(\.id), ["saved", "question"])
        let matches = AccountRecordsPresentation.notebookBooks(original, query: "  CAFE  ")
        XCTAssertEqual(matches.map(\.id), ["question"])
        XCTAssertEqual(matches.first?.rows.first?.text, "Why is café used here?")
        XCTAssertEqual(AccountRecordsPresentation.notebookBooks(original, query: "Saved Book").map(\.id), ["saved"])
        XCTAssertEqual(original, [empty, saved, question], "Filtering must keep empty books and original records intact in the saved snapshot")
    }

    func testReadingListDefaultsToActualTimeDescendingAndCanIncludeUnstartedBooks() {
        let source: CloudJSON = .object(["books": .array([
            .object(["bookId": .string("zero"), "title": .string("Not started"), "durationSeconds": .number(0)]),
            .object(["bookId": .string("short"), "title": .string("Short reading"), "durationSeconds": .number(30)]),
            .object(["bookId": .string("long"), "title": .string("Long reading"), "durationSeconds": .number(3600)])
        ])])
        XCTAssertEqual(AccountRecordsPresentation.readingBooks(source).compactMap { $0["bookId"].string }, ["long", "short"])
        XCTAssertEqual(AccountRecordsPresentation.readingBooks(source, includeUnstarted: true).compactMap { $0["bookId"].string }, ["long", "short", "zero"])
        XCTAssertEqual(AccountRecordsPresentation.readingBooks(source, query: " LONG ").compactMap { $0["bookId"].string }, ["long"])
        XCTAssertEqual(source["books"].array.count, 3)
        XCTAssertEqual(source["books"].array.first?["durationSeconds"].number, 0)
    }

    func testNoteAttributionDoesNotCallTranslationQuotesOriginalTextOrAITheUsersWords() {
        let source: CloudJSON = .object(["book": .object(["bookId": .string("book"), "title": .string("Book")]), "records": .object(["comments": .array([
            .object(["id": .string("user"), "origin": .string("user"), "text": .string("My own thought"), "quote": .string("A translated sentence"), "quoteOrigin": .string("translation")]),
            .object(["id": .string("ai"), "origin": .string("assistant"), "text": .string("An AI suggestion")])
        ])])])
        let rows = AccountRecordsPresentation.notebookBooks([source]).first?.rows ?? []
        XCTAssertEqual(rows.first?.attribution, "我的笔记")
        XCTAssertEqual(rows.first?.quoteAttribution, "译文引用")
        XCTAssertEqual(rows.last?.attribution, "AI 内容")
    }

    func testFinishingBackgroundDownloadKeepsTheBookOpenedWhileItWasDownloading() async throws {
        let (model, probe) = try fixture()
        let source = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".txt")
        try Data("The local book I chose to read.".utf8).write(to: source)
        addTeardownBlock { try? FileManager.default.removeItem(at: source) }
        let library = try XCTUnwrap(model.library)
        let local = try await library.importFile(source)
        await model.reload()
        let started = expectation(description: "remote chapter is held in flight")
        probe.blockChapters(started)
        let download = Task { await model.download(CloudShelfBook(id: "slow-remote", title: "Downloading Book", author: "", contentVersion: "v1")) }
        await fulfillment(of: [started], timeout: 5)

        await model.open(local)
        XCTAssertEqual(model.reader?.book.id, local.id)
        probe.releaseChapters()
        await download.value

        XCTAssertTrue(model.books.contains { $0.cloud?.bookID == "slow-remote" }, "The background download must still finish saving its own copy")
        XCTAssertEqual(model.reader?.book.id, local.id, "Completing another book must not switch away from the reader's chosen book")
    }

    func testFinishingLocalImportDoesNotReplaceAnOpenReader() async throws {
        let (model, _) = try fixture()
        let firstSource = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".txt")
        let nextSource = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".txt")
        try Data("My current book stays open.".utf8).write(to: firstSource)
        try Data("Another book can finish importing in the background.".utf8).write(to: nextSource)
        addTeardownBlock { try? FileManager.default.removeItem(at: firstSource); try? FileManager.default.removeItem(at: nextSource) }
        let library = try XCTUnwrap(model.library)
        let first = try await library.importFile(firstSource)
        await model.reload()
        await model.open(first)

        model.importFile(nextSource)
        for _ in 0..<200 where model.busy { try await Task.sleep(for: .milliseconds(20)) }

        XCTAssertFalse(model.busy)
        XCTAssertTrue(model.books.contains { $0.originalFilename == nextSource.lastPathComponent })
        XCTAssertEqual(model.reader?.book.id, first.id, "A completed import must preserve the current reading session")
    }

    func testAuthRestoreToSignedOutClearsPreviousAccountRecordsAndCursor() async throws {
        let (model, probe) = try fixture()
        model.notebookEntries = [try entry()]
        model.notebookCursor = "old-account-page"
        model.notebookState = .ready
        model.summary = summary(120)
        model.summaryState = .ready
        probe.restoreSignedOut = true

        await model.reload()

        XCTAssertNil(model.account)
        XCTAssertTrue(model.notebookEntries.isEmpty)
        XCTAssertNil(model.notebookCursor)
        XCTAssertEqual(model.summary, .null)
        XCTAssertEqual(model.notebookState, .idle)
        XCTAssertEqual(model.summaryState, .idle)
    }

    func testSignOutClearsThePreviousAccountsPaginationCursor() async throws {
        let (model, _) = try fixture()
        model.notebookCursor = "previous-account-cursor"
        model.notebookState = .ready; model.summaryState = .ready
        model.notebookEntries = [try entry()]
        await model.signOut()
        XCTAssertNil(model.account)
        XCTAssertNil(model.notebookCursor)
        XCTAssertTrue(model.notebookEntries.isEmpty)
        XCTAssertEqual(model.notebookState, .idle)
        XCTAssertEqual(model.summaryState, .idle)
    }
}

private final class RecordsProbe: @unchecked Sendable {
    let owner: String
    var notebookStatus = 200
    var summaryStatus = 200
    var workspaceStatus = 200
    var restoreSignedOut = false
    var workspace: CloudJSON = .object(["relations": .array([]), "candidates": .array([])])
    var notebook: CloudJSON = .object(["entries": .array([]), "nextCursor": .null])
    var summary: CloudJSON = .object(["allTime": .object(["durationSeconds": .number(0)]), "books": .array([])])
    private let lock = NSLock()
    private var captured: [String] = []
    private var chaptersBlocked = false
    private var chapterStarted: XCTestExpectation?
    private var heldChapters: [() -> Void] = []
    func blockChapters(_ started: XCTestExpectation) { lock.lock(); chaptersBlocked = true; chapterStarted = started; lock.unlock() }
    func holdIfBlocked(_ request: URLRequest, deliver: @escaping () -> Void) -> Bool {
        lock.lock()
        guard chaptersBlocked, request.url!.path.contains("/chapters/") else { lock.unlock(); return false }
        heldChapters.append(deliver)
        let started = chapterStarted; chapterStarted = nil
        lock.unlock()
        started?.fulfill()
        return true
    }
    func releaseChapters() {
        lock.lock(); chaptersBlocked = false; let pending = heldChapters; heldChapters = []; lock.unlock()
        pending.forEach { $0() }
    }
    var summaryRequests: Int { lock.lock(); defer { lock.unlock() }; return captured.filter { $0 == "/api/library/reading-summary" }.count }
    init(owner: String) { self.owner = owner }
    func response(_ request: URLRequest) -> (Int, CloudJSON) {
        let path = request.url!.path
        lock.lock(); captured.append(path); lock.unlock()
        if path.hasSuffix("/reading-manifest") {
            return (200, .object(["bookId": .string("slow-remote"), "contentVersion": .string("v1"), "title": .string("Downloading Book"), "chapters": .array([.object(["id": .string("c1"), "title": .string("One")])])]))
        }
        if path.contains("/chapters/") {
            return (200, .object(["bookId": .string("slow-remote"), "contentVersion": .string("v1"), "chapterId": .string("c1"), "sections": .array([.object(["chapterId": .string("c1"), "paragraphs": .array([.object(["id": .string("p1"), "original": .string("An isolated downloaded passage.")])])])])]))
        }
        if path.hasSuffix("/records") { return (200, .object(["bookId": .string("slow-remote"), "contentVersion": .string("v1"), "comments": .array([]), "questions": .array([])])) }
        if path == "/api/library/notebook" { return (notebookStatus, notebookStatus == 200 ? notebook : .object(["error": .string("Notebook unavailable")])) }
        if path == "/api/library/notebook-workspace" { return (workspaceStatus, workspaceStatus == 200 ? workspace : .object(["error": .string("Workspace unavailable")])) }
        if path == "/api/library/reading-summary" { return (summaryStatus, summaryStatus == 200 ? summary : .object(["error": .string("Summary unavailable")])) }
        if path == "/api/auth/session" { return (200, .object(["user": restoreSignedOut || request.value(forHTTPHeaderField: "Cookie") == nil ? .null : .object(["id": .string(owner)])])) }
        if path == "/api/library" { return (200, .object(["user": .object(["id": .string(owner)]), "books": .array([])])) }
        return (200, .object([:]))
    }
}

private final class RecordsURLProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    private static var probe: RecordsProbe?
    private let deliveryLock = NSLock()
    private var stopped = false
    static func install(_ value: RecordsProbe?) { lock.lock(); probe = value; lock.unlock() }
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "records.leafhour.test" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock(); let probe = Self.probe; Self.lock.unlock()
        guard let probe else { client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse)); return }
        let (status, json) = probe.response(request)
        do {
            let data = try JSONEncoder().encode(json)
            let deliver = { [self] in
                deliveryLock.lock(); let cancelled = stopped; deliveryLock.unlock()
                guard !cancelled else { return }
                client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
                client?.urlProtocol(self, didLoad: data)
                client?.urlProtocolDidFinishLoading(self)
            }
            if !probe.holdIfBlocked(request, deliver: deliver) { deliver() }
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() { deliveryLock.lock(); stopped = true; deliveryLock.unlock() }
}
