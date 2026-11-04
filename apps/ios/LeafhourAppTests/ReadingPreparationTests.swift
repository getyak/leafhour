import XCTest
import Foundation
import LeafhourCore
@testable import Leafhour

@MainActor
final class ReadingPreparationTests: XCTestCase {
    func testExplicitLanguageDirectionSurvivesPreparationAndCachesOnlyThatLanguage() async throws {
        let fixture = try await fixture(), probe = PreparationProbe(owner: owner)
        PreparationProtocol.install(probe)
        fixture.session.changeTranslationSettings(BookTranslationSettings(sourceLanguage: .en, targetLanguage: .ja))
        let reading = ReaderReadingContent()
        await reading.prepare(fixture.session, cloud: fixture.cloud, library: fixture.library, scope: .passage)
        let proposed = try XCTUnwrap(reading.proposed)
        XCTAssertEqual(proposed.plan.sourceLanguage, .en); XCTAssertEqual(proposed.plan.targetLanguage, .ja)
        reading.confirm(proposed, session: fixture.session, cloud: fixture.cloud, library: fixture.library)
        try await waitForCompletion(reading)
        XCTAssertNil(reading.error)
        let generated = try XCTUnwrap(probe.snapshot().first { $0.0.hasSuffix("/translate") }?.1)
        XCTAssertEqual(generated["sourceLanguage"] as? String, "en"); XCTAssertEqual(generated["targetLanguage"] as? String, "ja")
        let saved = try await fixture.library.readingTranslations(bookID: fixture.session.book.id, targetLanguage: .ja)
        XCTAssertEqual(saved["p1"]?.targetLanguage, .ja)
        let chinese = try await fixture.library.readingTranslations(bookID: fixture.session.book.id)
        XCTAssertNil(chinese["p1"]?.literal)
    }
    func testDeferredOpeningDefersTranslationPublicationAndPreparationUntilVerified() async throws {
        let fixture = try await fixture(), probe = PreparationProbe(owner: owner)
        PreparationProtocol.install(probe)
        let opening = try await fixture.library.readingOpening(fixture.session.book.id)
        var state = opening.state; state.preferences.viewMode = .translation
        let session = ReaderSession(book: opening.book, state: state, original: opening.original, directory: opening.directory,
                                    library: fixture.library, preparation: opening.preparation)
        let reading = ReaderReadingContent()
        await reading.refresh(session, cloud: fixture.cloud, library: fixture.library)
        await reading.prepare(session, cloud: fixture.cloud, library: fixture.library, scope: .passage)
        XCTAssertTrue(probe.snapshot().isEmpty, "Entry cannot publish a replacement package while its opening receipt is pending")
        XCTAssertNil(reading.proposed)
        XCTAssertTrue(session.packageVerificationPending)
        try await fixture.library.verifyReadingOpening(opening)
        session.completePackageVerification()
        await reading.prepare(session, cloud: fixture.cloud, library: fixture.library, scope: .passage)
        XCTAssertNotNil(reading.proposed, "The same explicit action is available once the package pass succeeds")
    }

    private let owner = "00000000-0000-4000-8000-000000000344"
    private struct Fixture { let session: ReaderSession; let library: OfflineLibrary; let cloud: CloudLibraryClient }
    private func fixture(pageParagraphs: Bool = false) async throws -> Fixture {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let library = try OfflineLibrary(root: root, scope: .account(UUID(uuidString: owner)!))
        var chapters = try JSONDecoder().decode([BookChapter].self, from: Data(#"[{"id":"c1","title":"One","sourcePath":"1","passages":[{"id":"p1","text":"Original one.","heading":false}]},{"id":"c2","title":"Two","sourcePath":"2","passages":[{"id":"p2","text":"Original two.","heading":false}]},{"id":"c3","title":"Three","sourcePath":"3","passages":[{"id":"p3","text":"Original three.","heading":false}]}]"#.utf8))
        if pageParagraphs {
            let additional = try JSONDecoder().decode([Passage].self, from: Data(#"[{"id":"p1b","text":"Second paragraph in first chapter.","heading":false},{"id":"p1c","text":"Third paragraph in first chapter.","heading":false}]"#.utf8))
            chapters[0].passages.append(contentsOf: additional)
        }
        let identity = CloudBookIdentity(ownerID: owner, bookID: "reading-book", contentVersion: "v1", sourceFormat: "text")
        let content: [String:Any] = ["bookId":"reading-book","contentVersion":"v1","source":["format":"text"],"sections": chapters.map { chapter in ["chapterId":chapter.id,"paragraphs":chapter.passages.map { ["id":$0.id,"original":$0.text,"translations":[:]] }] }]
        let book = try await library.importCloud(CloudReadingCopy(identity: identity, title: "Synthetic book", author: "", chapters: chapters, content: JSONSerialization.data(withJSONObject: content)))
        var state = try await library.state(book.id); state.preferences.viewMode = .translation
        state.translationSettings = BookTranslationSettings(sourceLanguage: .en, targetLanguage: .zh)
        try await library.saveState(state, bookID: book.id)
        let session = ReaderSession(book: book, state: state, original: try await library.originalURL(book.id), directory: try await library.bookDirectory(book.id), library: library)
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [PreparationProtocol.self]
        let cloud = CloudLibraryClient(baseURL: URL(string:"https://reading.test")!, credential: CloudCredential(account: CloudAccount(id:owner,email:nil),token:"isolated-fixture"),configuration:configuration)
        return Fixture(session:session,library:library,cloud:cloud)
    }
    private func waitForCompletion(_ reading: ReaderReadingContent) async throws {
        for _ in 0..<300 { if !reading.running { return }; try await Task.sleep(for:.milliseconds(10)) }
        XCTFail("Bounded synthetic translation did not settle")
    }
    override func tearDown() { PreparationProtocol.install(nil); super.tearDown() }

    func testUncertainRequestSurvivesRelaunchUsesSameKeyAndNeverExpandsToThirdChapter() async throws {
        let fixture = try await fixture(), probe = PreparationProbe(owner:owner)
        probe.failFirst = true; PreparationProtocol.install(probe)
        let first = ReaderReadingContent()
        await first.prepare(fixture.session,cloud:fixture.cloud,library:fixture.library)
        first.confirm(try XCTUnwrap(first.proposed),session:fixture.session,cloud:fixture.cloud,library:fixture.library)
        try await waitForCompletion(first)
        XCTAssertNotNil(first.error)
        let savedData = try await fixture.library.pendingReadingTranslation(bookID:fixture.session.book.id)
        let saved = try XCTUnwrap(savedData)
        let pending = try JSONDecoder().decode(ReaderTranslationRun.self,from:saved)
        XCTAssertNotNil(pending.pending)
        let second = ReaderReadingContent()
        await second.prepare(fixture.session,cloud:fixture.cloud,library:fixture.library)
        second.confirm(try XCTUnwrap(second.proposed),session:fixture.session,cloud:fixture.cloud,library:fixture.library)
        try await waitForCompletion(second)
        XCTAssertNil(second.error)
        let generated = probe.snapshot().filter { $0.0.hasSuffix("/translate") }
        XCTAssertEqual(generated.count,3)
        XCTAssertEqual(generated[0].1 as NSDictionary,generated[1].1 as NSDictionary,"The exact uncertain request, quote and idempotency key must be reused")
        XCTAssertEqual(generated.compactMap { $0.1["passageId"] as? String },["p1","p1","p2"])
        XCTAssertEqual(probe.snapshot().filter { $0.0 == "/api/billing/quotes" }.count,2)
        let cached = try await fixture.library.readingTranslations(bookID:fixture.session.book.id)
        XCTAssertEqual(cached["p1"]?.literal,"Literal p1"); XCTAssertEqual(cached["p2"]?.interpretive,"Interpretive p2")
        XCTAssertNil(cached["p3"]?.literal)
        let remaining = try await fixture.library.pendingReadingTranslation(bookID:fixture.session.book.id)
        XCTAssertNil(remaining)
    }

    func testExplicitChapterStreamsOneChapterAndPersistsItsFirstParagraph() async throws {
        let fixture = try await fixture(), probe = PreparationProbe(owner: owner)
        PreparationProtocol.install(probe)
        let reading = ReaderReadingContent()
        await reading.prepare(fixture.session, cloud: fixture.cloud, library: fixture.library, scope: .chapter)
        XCTAssertEqual(reading.proposed?.plan.chapterIDs, ["c1"])
        reading.confirm(try XCTUnwrap(reading.proposed), session: fixture.session, cloud: fixture.cloud, library: fixture.library)
        try await waitForCompletion(reading)
        XCTAssertNil(reading.error)
        XCTAssertEqual(probe.snapshot().filter { $0.0.hasSuffix("/translate") }.compactMap { $0.1["passageId"] as? String }, ["p1"])
        XCTAssertEqual(reading.completedCount, 1)
        XCTAssertEqual(reading.totalCount, 1)
        XCTAssertEqual(fixture.session.translations["p1"]?.literal, "Literal p1")
        let saved = try await fixture.library.readingTranslations(bookID: fixture.session.book.id)
        XCTAssertEqual(saved["p1"]?.interpretive, "Interpretive p1")
        XCTAssertNil(saved["p2"]?.literal)
        XCTAssertNil(saved["p2"]?.interpretive)
    }
    func testRecoveryRejectsAnEnvelopeWhoseScopeLabelUnderstatesItsActualRange() async throws {
        let fixture = try await fixture()
        let run = ReaderTranslationRun(plan: try ReadingTranslationPlan.make(book: fixture.session.book, chapterIndex: 0, translations: [:]))
        for scope in ["passage", "chapter"] {
            var value = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(run)) as? [String: Any])
            var plan = try XCTUnwrap(value["plan"] as? [String: Any]); plan["scope"] = scope; value["plan"] = plan
            let invalid = try JSONDecoder().decode(ReaderTranslationRun.self, from: JSONSerialization.data(withJSONObject: value))
            XCTAssertThrowsError(try ReaderReadingContent.validate(invalid, session: fixture.session))
        }
    }
    func testAuthenticationFailureWhileRecoveringKeepsTheOriginalIdempotencyKey() async throws {
        let fixture = try await fixture(), probe = PreparationProbe(owner:owner)
        probe.generationStatuses = [503,401]; PreparationProtocol.install(probe)
        for _ in 0..<2 {
            let reading=ReaderReadingContent();await reading.prepare(fixture.session,cloud:fixture.cloud,library:fixture.library)
            reading.confirm(try XCTUnwrap(reading.proposed),session:fixture.session,cloud:fixture.cloud,library:fixture.library)
            try await waitForCompletion(reading)
            let savedData=try await fixture.library.pendingReadingTranslation(bookID:fixture.session.book.id)
            let saved=try JSONDecoder().decode(ReaderTranslationRun.self,from:XCTUnwrap(savedData))
            XCTAssertNotNil(saved.pending,"An auth failure cannot retire a previously uncertain request")
        }
        let loginConfiguration=URLSessionConfiguration.ephemeral;loginConfiguration.protocolClasses=[PreparationProtocol.self]
        let loggedInAgain=CloudLibraryClient(baseURL:URL(string:"https://reading.test")!,credential:CloudCredential(account:CloudAccount(id:owner,email:nil),token:"isolated-new-login"),configuration:loginConfiguration)
        let resumed=ReaderReadingContent();await resumed.prepare(fixture.session,cloud:loggedInAgain,library:fixture.library)
        resumed.confirm(try XCTUnwrap(resumed.proposed),session:fixture.session,cloud:loggedInAgain,library:fixture.library)
        try await waitForCompletion(resumed)
        XCTAssertNil(resumed.error)
        let requests=probe.snapshot().filter { $0.0.hasSuffix("/translate") }
        XCTAssertEqual(requests.count,4)
        XCTAssertEqual(requests[0].1 as NSDictionary,requests[1].1 as NSDictionary)
        XCTAssertEqual(requests[0].1 as NSDictionary,requests[2].1 as NSDictionary)
        XCTAssertEqual(probe.snapshot().filter { $0.0 == "/api/billing/quotes" }.count,2)
    }
    func testTerminalBillingReceiptAllowsAnUnsubmittedRequestToBeRetired() async throws {
        let fixture=try await fixture(),probe=PreparationProbe(owner:owner)
        probe.generationStatuses=[400];probe.terminalStatus="not_started";PreparationProtocol.install(probe)
        let reading=ReaderReadingContent();await reading.prepare(fixture.session,cloud:fixture.cloud,library:fixture.library)
        reading.confirm(try XCTUnwrap(reading.proposed),session:fixture.session,cloud:fixture.cloud,library:fixture.library)
        try await waitForCompletion(reading)
        let savedData=try await fixture.library.pendingReadingTranslation(bookID:fixture.session.book.id)
        let saved=try JSONDecoder().decode(ReaderTranslationRun.self,from:XCTUnwrap(savedData))
        XCTAssertNil(saved.pending);XCTAssertEqual(saved.next,0)
        XCTAssertEqual(probe.snapshot().filter { $0.0.hasSuffix("/translate") }.count,1)
    }
    func testBackgroundStopsFollowingPassagesAndRetainsSubmittedRequest() async throws {
        let fixture = try await fixture(), probe = PreparationProbe(owner:owner)
        probe.delay = 0.5; PreparationProtocol.install(probe)
        let reading = ReaderReadingContent()
        await reading.prepare(fixture.session,cloud:fixture.cloud,library:fixture.library)
        reading.confirm(try XCTUnwrap(reading.proposed),session:fixture.session,cloud:fixture.cloud,library:fixture.library)
        for _ in 0..<200 {
            if probe.snapshot().contains(where:{ $0.0.hasSuffix("/translate") }) { break }
            try await Task.sleep(for:.milliseconds(10))
        }
        reading.setForeground(false)
        try await waitForCompletion(reading)
        XCTAssertEqual(probe.snapshot().filter { $0.0.hasSuffix("/translate") }.count,1)
        let pendingData = try await fixture.library.pendingReadingTranslation(bookID:fixture.session.book.id)
        let data = try XCTUnwrap(pendingData)
        XCTAssertNotNil(try JSONDecoder().decode(ReaderTranslationRun.self,from:data).pending)
    }
    func testStoppedUnsubmittedOldRangeCanBeReplacedByCurrentChapters() async throws {
        let fixture = try await fixture(), reading = ReaderReadingContent()
        let old = ReaderTranslationRun(plan: try ReadingTranslationPlan.make(book:fixture.session.book,chapterIndex:0,translations:[:]))
        try await fixture.library.savePendingReadingTranslation(JSONEncoder().encode(old),bookID:fixture.session.book.id)
        fixture.session.go(to:2)
        await reading.prepare(fixture.session,cloud:fixture.cloud,library:fixture.library)
        XCTAssertEqual(reading.proposed?.plan.chapterIDs,["c3"])
        XCTAssertEqual(reading.proposed?.plan.passageIDs,["p3"])
    }

    func testPagePreparationRequiresCurrentSnapshotAndNeverFallsBackToChapter() async throws {
        let fixture = try await fixture(pageParagraphs: true), reading = ReaderReadingContent()
        await reading.prepare(fixture.session, cloud: fixture.cloud, library: fixture.library, scope: .page)
        XCTAssertNil(reading.proposed); XCTAssertNotNil(reading.error)
        let layout = ReaderVisiblePageLayout()
        let page = try XCTUnwrap(ReaderVisiblePage(session: fixture.session, chapterID: "c1", passageIDs: ["p1b"], layout: layout))
        await reading.prepare(fixture.session, cloud: fixture.cloud, library: fixture.library, scope: .page, page: page)
        XCTAssertEqual(reading.proposed?.plan.passageIDs, ["p1b"])
        layout.invalidate()
        await reading.prepare(fixture.session, cloud: fixture.cloud, library: fixture.library, scope: .page, page: page)
        XCTAssertNil(reading.proposed, "An earlier proposal must not remain confirmable after invalid geometry")
        XCTAssertNotNil(reading.error)
    }

    func testChangedPageReplacesRemainingUnsubmittedPageWorkWithoutExpandingIt() async throws {
        let fixture = try await fixture(pageParagraphs: true), reading = ReaderReadingContent()
        let oldPlan = try ReadingTranslationPlan.make(book: fixture.session.book, chapterIndex: 0, translations: [:], scope: .page, visiblePassageIDs: ["p1", "p1b"])
        var old = ReaderTranslationRun(plan: oldPlan); old.next = 1
        try await fixture.library.savePendingReadingTranslation(JSONEncoder().encode(old), bookID: fixture.session.book.id)
        let page = try XCTUnwrap(ReaderVisiblePage(session: fixture.session, chapterID: "c1", passageIDs: ["p1c"], layout: ReaderVisiblePageLayout()))
        await reading.prepare(fixture.session, cloud: fixture.cloud, library: fixture.library, scope: .page, page: page)
        XCTAssertEqual(reading.proposed?.plan.passageIDs, ["p1c"])
        XCTAssertEqual(reading.proposed?.next, 0)
    }

    func testPageRecoveryRejectsWidenedOrUnorderedPersistedIDs() async throws {
        let fixture = try await fixture(pageParagraphs: true)
        let plan = try ReadingTranslationPlan.make(book: fixture.session.book, chapterIndex: 0, translations: [:], scope: .page, visiblePassageIDs: ["p1", "p1b"])
        let valid = ReaderTranslationRun(plan: plan)
        XCTAssertNoThrow(try ReaderReadingContent.validate(valid, session: fixture.session))
        for ids in [["p1", "p1c"], ["p1b", "p1"]] {
            var value = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(valid)) as? [String: Any])
            var envelope = try XCTUnwrap(value["plan"] as? [String: Any]); envelope["passageIDs"] = ids; value["plan"] = envelope
            let invalid = try JSONDecoder().decode(ReaderTranslationRun.self, from: JSONSerialization.data(withJSONObject: value))
            XCTAssertThrowsError(try ReaderReadingContent.validate(invalid, session: fixture.session))
        }
    }

    func testDifferentPageRecoversOnlyTheUncertainSubmissionAndKeepsOriginalRemainingScope() async throws {
        let fixture = try await fixture(), probe = PreparationProbe(owner: owner)
        probe.failFirst = true; PreparationProtocol.install(probe)
        let first = ReaderReadingContent()
        await first.prepare(fixture.session, cloud: fixture.cloud, library: fixture.library)
        first.confirm(try XCTUnwrap(first.proposed), session: fixture.session, cloud: fixture.cloud, library: fixture.library)
        try await waitForCompletion(first)
        fixture.session.go(to: 1)
        let page = try XCTUnwrap(ReaderVisiblePage(session: fixture.session, chapterID: "c2", passageIDs: ["p2"], layout: ReaderVisiblePageLayout()))
        let second = ReaderReadingContent()
        await second.prepare(fixture.session, cloud: fixture.cloud, library: fixture.library, scope: .page, page: page)
        let recovery = try XCTUnwrap(second.proposed)
        XCTAssertEqual(recovery.plan.passageIDs, ["p1", "p2"], "Uncertainty keeps the original immutable scope")
        XCTAssertEqual(recovery.recoverPendingOnly, true)
        XCTAssertEqual(recovery.remainingParagraphCount, 1)
        second.confirm(recovery, session: fixture.session, cloud: fixture.cloud, library: fixture.library)
        try await waitForCompletion(second)
        let generated = probe.snapshot().filter { $0.0.hasSuffix("/translate") }
        XCTAssertEqual(generated.compactMap { $0.1["passageId"] as? String }, ["p1", "p1"])
        XCTAssertEqual(generated[0].1 as NSDictionary, generated[1].1 as NSDictionary)
        let data = try await fixture.library.pendingReadingTranslation(bookID: fixture.session.book.id)
        let remaining = try JSONDecoder().decode(ReaderTranslationRun.self, from: XCTUnwrap(data))
        XCTAssertEqual(remaining.plan.passageIDs, ["p1", "p2"])
        XCTAssertEqual(remaining.next, 1); XCTAssertNil(remaining.pending)
    }

    func testPageInvalidatedWhileQuoteWaitsDoesNotRetainAnUnsubmittedIntent() async throws {
        try await assertUnsubmittedPageRetired(cancelWhileWaiting: false)
    }

    func testStoppedWhileQuoteWaitsDoesNotCreateAnUncertainRecovery() async throws {
        try await assertUnsubmittedPageRetired(cancelWhileWaiting: true)
    }

    func testPageRevokedAtSubmissionBoundaryClearsFreshDurableIntentWhenCancelled() async throws {
        try await assertUnsubmittedPageRetired(cancelWhileWaiting: false, cancelAtSubmissionBoundary: true)
    }

    private func assertUnsubmittedPageRetired(cancelWhileWaiting: Bool, cancelAtSubmissionBoundary: Bool = false) async throws {
        let fixture = try await fixture(pageParagraphs: true), probe = PreparationProbe(owner: owner)
        probe.holdQuoteResponses(); PreparationProtocol.install(probe)
        defer { probe.releaseQuoteResponses() }
        let layout = ReaderVisiblePageLayout()
        let page = try XCTUnwrap(ReaderVisiblePage(session: fixture.session, chapterID: "c1", passageIDs: ["p1"], layout: layout))
        let reading = ReaderReadingContent()
        var revokeAtBoundary = false
        var cancellationBoundaryReached = false
        if cancelAtSubmissionBoundary {
            layout.bind {
                guard revokeAtBoundary else { return true }
                // Native geometry is checked again after the durable intent
                // write. Revoke the viewport and stop at that exact boundary.
                cancellationBoundaryReached = true
                reading.setForeground(false)
                return false
            }
        }
        await reading.prepare(fixture.session, cloud: fixture.cloud, library: fixture.library, scope: .page, page: page)
        reading.confirm(try XCTUnwrap(reading.proposed), session: fixture.session, cloud: fixture.cloud, library: fixture.library)
        for _ in 0..<300 {
            if probe.snapshot().contains(where: { $0.0 == "/api/billing/quotes" }) { break }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertTrue(probe.snapshot().contains(where: { $0.0 == "/api/billing/quotes" }))
        XCTAssertFalse(probe.snapshot().contains(where: { $0.0.hasSuffix("/translate") }))
        if cancelAtSubmissionBoundary { revokeAtBoundary = true }
        else { layout.invalidate() }
        if cancelWhileWaiting { reading.setForeground(false) }
        probe.releaseQuoteResponses()
        try await waitForCompletion(reading)
        if cancelAtSubmissionBoundary { XCTAssertTrue(cancellationBoundaryReached, "The fixture must reach the post-quote geometry check") }
        if cancelWhileWaiting || cancelAtSubmissionBoundary {
            XCTAssertNil(reading.error, "Retiring a known-unsubmitted intent must complete despite cancellation; status=\(reading.status ?? "nil")")
        }
        XCTAssertFalse(probe.snapshot().contains(where: { $0.0.hasSuffix("/translate") }), "An invalidated, never-submitted page must not reach generation")
        let savedData = try await fixture.library.pendingReadingTranslation(bookID: fixture.session.book.id)
        let saved = try savedData.map { try JSONDecoder().decode(ReaderTranslationRun.self, from: $0) }
        XCTAssertNil(saved?.pending, "A quote is not an uncertain generation; no translate POST was attempted")
        let nextPage = try XCTUnwrap(ReaderVisiblePage(session: fixture.session, chapterID: "c1", passageIDs: ["p1b"], layout: ReaderVisiblePageLayout()))
        let next = ReaderReadingContent()
        await next.prepare(fixture.session, cloud: fixture.cloud, library: fixture.library, scope: .page, page: nextPage)
        XCTAssertEqual(next.proposed?.plan.passageIDs, ["p1b"])
        XCTAssertNil(next.proposed?.pending)
        XCTAssertNotEqual(next.proposed?.recoverPendingOnly, true)
    }
}

private final class PreparationProbe: @unchecked Sendable {
    let owner: String
    var failFirst = false
    var generationStatuses: [Int] = []
    var terminalStatus: String?
    var delay: TimeInterval = 0
    private let lock = NSLock()
    private var requests: [(String,[String:Any])] = []
    private var generationCount = 0
    private var quotesHeld = false
    private var quoteDeliveries: [() -> Void] = []
    init(owner:String) { self.owner=owner }
    func snapshot() -> [(String,[String:Any])] { lock.lock(); defer { lock.unlock() }; return requests }
    func holdQuoteResponses() { lock.lock(); quotesHeld = true; lock.unlock() }
    func holdQuoteDelivery(_ delivery: @escaping () -> Void) -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard quotesHeld else { return false }
        quoteDeliveries.append(delivery); return true
    }
    func releaseQuoteResponses() {
        lock.lock(); quotesHeld = false; let deliveries = quoteDeliveries; quoteDeliveries = []; lock.unlock()
        deliveries.forEach { $0() }
    }
    func reply(_ request:URLRequest, body:[String:Any]) -> (Int,[String:Any],TimeInterval) {
        lock.lock(); defer { lock.unlock() }
        let path=request.url!.path; requests.append((path,body))
        if path == "/api/auth/session" { return (200,["user":["id":owner],"billing":["enabled":true,"mode":"test","unitsPerPoint":1_000_000,"prices":["translation":1_000_000]]],0) }
        if path == "/api/billing/quotes" {
            let input=body["input"] as? [String:Any] ?? [:]
            return (200,["id":"quote-"+(input["id"] as? String ?? ""),"ownerId":owner,"action":"translation","mode":"test","units":1_000_000,"expiresAt":ISO8601DateFormatter().string(from:Date().addingTimeInterval(300)),"scope":["bookId":"reading-book","contentVersion":"v1","requestId":input["id"] ?? "","passageId":input["passageId"] ?? "","sourceLanguage":input["sourceLanguage"] ?? "en","targetLanguage":input["targetLanguage"] ?? "zh"]],0)
        }
        if path.hasSuffix("/translate") {
            generationCount += 1
            let status = generationStatuses.indices.contains(generationCount-1) ? generationStatuses[generationCount-1] : failFirst && generationCount == 1 ? 503 : 200
            if status != 200 {
                var value: [String:Any] = ["error":"Synthetic rejected recovery"]
                if let terminalStatus { value["billingOperation"]=["status":terminalStatus] }
                return (status,value,0)
            }
            let id=body["passageId"] as? String ?? "", source=id=="p1" ? "Original one." : id=="p2" ? "Original two." : "Original three."
            let target = body["targetLanguage"] as? String ?? "zh"
            return (200,["id":id,"original":source,"translations":["literal":["text":"Literal "+id,"status":"draft","targetLanguage":target],"interpretive":["text":"Interpretive "+id,"status":"draft","targetLanguage":target]]],delay)
        }
        return (404,["error":"Unconfigured synthetic endpoint"],0)
    }
}
private final class PreparationProtocol: URLProtocol, @unchecked Sendable {
    private static let lock=NSLock()
    private static var probe:PreparationProbe?
    private var work:DispatchWorkItem?
    static func install(_ probe:PreparationProbe?) { lock.lock(); Self.probe=probe; lock.unlock() }
    override class func canInit(with request:URLRequest)->Bool { true }
    override class func canonicalRequest(for request:URLRequest)->URLRequest { request }
    override func startLoading() {
        Self.lock.lock(); let probe=Self.probe; Self.lock.unlock()
        guard let probe else { client?.urlProtocol(self,didFailWithError:URLError(.notConnectedToInternet)); return }
        let bytes=request.httpBody ?? request.httpBodyStream.map { stream -> Data in
            stream.open(); defer { stream.close() }; var data=Data(),buffer=[UInt8](repeating:0,count:4096)
            while stream.hasBytesAvailable { let count=stream.read(&buffer,maxLength:buffer.count); if count<=0 { break }; data.append(buffer,count:count) }; return data
        } ?? Data()
        let body=(try? JSONSerialization.jsonObject(with:bytes)) as? [String:Any] ?? [:]
        let (status,value,delay)=probe.reply(request,body:body)
        let work=DispatchWorkItem { [weak self] in
            guard let self, let response=HTTPURLResponse(url:self.request.url!,statusCode:status,httpVersion:nil,headerFields:["Content-Type":"application/json"]), let data=try? JSONSerialization.data(withJSONObject:value) else { return }
            self.client?.urlProtocol(self,didReceive:response,cacheStoragePolicy:.notAllowed)
            self.client?.urlProtocol(self,didLoad:data); self.client?.urlProtocolDidFinishLoading(self)
        }; self.work=work
        if request.url?.path == "/api/billing/quotes", probe.holdQuoteDelivery({ DispatchQueue.global().async(execute: work) }) { return }
        DispatchQueue.global().asyncAfter(deadline:.now()+delay,execute:work)
    }
    override func stopLoading() { work?.cancel() }
}
