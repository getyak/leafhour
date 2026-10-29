import XCTest
import Observation
@testable import LeafhourCore

final class ReaderSessionTests: XCTestCase {
    @MainActor
    func testFailedNoteSaveRetainsEditableDraftInsteadOfAnUnconfirmedNote() async throws {
        let fixture = try await fixture()
        let started = expectation(description: "note write started")
        let store = GatedStateStore(library: fixture.library, starts: [started])
        var state = fixture.state
        state.drafts[fixture.quote.anchor.key] = NoteDraft(anchor: fixture.quote.anchor, quote: fixture.quote.text, body: "My thought")
        try await fixture.library.saveState(state, bookID: fixture.book.id)
        let session = fixture.session(state: state, store: store)
        let save = Task { await session.saveNote(fixture.quote, text: "My thought") }
        await fulfillment(of: [started], timeout: 3)
        await store.release(1, failing: true)
        let result = await save.value
        XCTAssertFalse(result)
        await session.flush()
        XCTAssertNotNil(session.saveError)
        XCTAssertTrue(session.state.notes.isEmpty, "A failed submission must remain editable rather than becoming an unconfirmed note")
        XCTAssertEqual(session.state.drafts[fixture.quote.anchor.key]?.body, "My thought")
        let disk = try await fixture.library.state(fixture.book.id)
        XCTAssertTrue(disk.notes.isEmpty)
        XCTAssertEqual(disk.drafts[fixture.quote.anchor.key]?.body, "My thought")
    }

    @MainActor
    func testFlushWaitsForEditsQueuedWhileAnEarlierWriteIsSuspended() async throws {
        let fixture = try await fixture()
        let first = expectation(description: "first write started")
        let second = expectation(description: "later edit write started")
        let store = GatedStateStore(library: fixture.library, starts: [first, second])
        let session = fixture.session(state: fixture.state, store: store)
        session.draft(fixture.quote, text: "First edit")
        await fulfillment(of: [first], timeout: 3)
        let waiting = expectation(description: "flush entered")
        let returned = expectation(description: "flush must not finish before the later edit")
        returned.isInverted = true
        let observation = FlushObservation()
        let flush = Task { waiting.fulfill(); await session.flush(); if observation.enabled { returned.fulfill() } }
        await fulfillment(of: [waiting], timeout: 3)
        session.draft(fixture.quote, text: "Later edit")
        await store.release(1)
        await fulfillment(of: [second], timeout: 3)
        await fulfillment(of: [returned], timeout: 0.1)
        observation.enabled = false
        await store.release(2)
        await flush.value
        let disk = try await fixture.library.state(fixture.book.id)
        XCTAssertEqual(disk.drafts[fixture.quote.anchor.key]?.body, "Later edit")
        XCTAssertFalse(session.saving)
    }

    @MainActor
    func testRetryRetainsLaterEditsAndUsesOneSubmissionIdentity() async throws {
        let fixture = try await fixture()
        let started = expectation(description: "failing submission started")
        let store = GatedStateStore(library: fixture.library, starts: [started])
        let session = fixture.session(state: fixture.state, store: store)
        let id = UUID()
        let failed = Task { await session.saveNote(fixture.quote, text: "First thought", id: id) }
        await fulfillment(of: [started], timeout: 3)
        await store.release(1, failing: true)
        let failedResult = await failed.value
        XCTAssertFalse(failedResult)
        session.draft(fixture.quote, text: "Changed after the error")
        await session.flush()
        var disk = try await fixture.library.state(fixture.book.id)
        XCTAssertTrue(disk.notes.isEmpty, "Draft autosave must not incidentally commit the failed note")
        XCTAssertEqual(disk.drafts[fixture.quote.anchor.key]?.body, "Changed after the error")
        session.save() // The root retry only writes the restored current state.
        await session.flush()
        disk = try await fixture.library.state(fixture.book.id)
        XCTAssertTrue(disk.notes.isEmpty)
        let saved = await session.saveNote(fixture.quote, text: "Changed after the error", id: id)
        XCTAssertTrue(saved)
        let repeated = await session.saveNote(fixture.quote, text: "Changed after the error", id: id)
        XCTAssertTrue(repeated)
        disk = try await fixture.library.state(fixture.book.id)
        XCTAssertEqual(disk.notes.count, 1)
        XCTAssertEqual(disk.notes.first?.id, id)
        XCTAssertEqual(disk.notes.first?.body, "Changed after the error")
        XCTAssertNil(disk.drafts[fixture.quote.anchor.key])
        XCTAssertNil(session.saveError)
        XCTAssertNil(session.saveMessage)
    }

    @MainActor
    func testOnlyOneNoteSubmissionCanBeInFlight() async throws {
        let fixture = try await fixture()
        let started = expectation(description: "suspended note write")
        let store = GatedStateStore(library: fixture.library, starts: [started])
        let session = fixture.session(state: fixture.state, store: store)
        let id = UUID()
        let first = Task { await session.saveNote(fixture.quote, text: "My thought", id: id) }
        await fulfillment(of: [started], timeout: 3)
        let duplicate = await session.saveNote(fixture.quote, text: "My thought", id: id)
        XCTAssertFalse(duplicate)
        await store.release(1)
        let firstSaved = await first.value
        XCTAssertTrue(firstSaved)
        let disk = try await fixture.library.state(fixture.book.id)
        XCTAssertEqual(disk.notes.map(\.id), [id])
    }

    @MainActor
    func testLaterWriteFailureDoesNotRollBackAnAlreadyPersistedNote() async throws {
        let fixture = try await fixture()
        let first = expectation(description: "note submission write")
        let second = expectation(description: "later reading position write")
        let store = GatedStateStore(library: fixture.library, starts: [first, second])
        let session = fixture.session(state: fixture.state, store: store)
        let id = UUID()
        let saving = Task { await session.saveNote(fixture.quote, text: "Confirmed thought", id: id) }
        await fulfillment(of: [first], timeout: 3)
        var later = fixture.quote.anchor; later.characterOffset = 1
        session.moved(later)
        await store.release(1)
        await fulfillment(of: [second], timeout: 3)
        await store.release(2, failing: true)
        let allSaved = await saving.value
        XCTAssertFalse(allSaved)
        XCTAssertNotNil(session.saveError)
        XCTAssertTrue(session.isNotePersisted(id: id, body: "Confirmed thought"))
        XCTAssertEqual(session.state.notes.map(\.id), [id])
        var disk = try await fixture.library.state(fixture.book.id)
        XCTAssertEqual(disk.notes.map(\.id), [id])
        session.save()
        await session.flush()
        disk = try await fixture.library.state(fixture.book.id)
        XCTAssertEqual(disk.notes.map(\.id), [id])
        XCTAssertEqual(disk.anchor, later)
    }

    @MainActor
    func testNewRevisionInvalidatesAnEarlierSuccessfulReceipt() async throws {
        let fixture = try await fixture()
        let session = fixture.session(state: fixture.state, store: fixture.library)
        session.save()
        let earlier = await session.flush()
        XCTAssertTrue(session.isCurrent(earlier))
        session.draft(fixture.quote, text: "Later edit")
        XCTAssertFalse(session.isCurrent(earlier))
        let latest = await session.flush()
        XCTAssertTrue(session.isCurrent(latest))
        XCTAssertGreaterThan(latest.revision, earlier.revision)
    }

    @MainActor
    func testSeparateSubmissionsCanIntentionallySaveTheSameQuoteAndBody() async throws {
        let fixture = try await fixture()
        let session = fixture.session(state: fixture.state, store: fixture.library)
        let first = UUID(), second = UUID()
        let firstSaved = await session.saveNote(fixture.quote, text: "Same thought", id: first)
        let secondSaved = await session.saveNote(fixture.quote, text: "Same thought", id: second)
        XCTAssertTrue(firstSaved); XCTAssertTrue(secondSaved)
        let disk = try await fixture.library.state(fixture.book.id)
        XCTAssertEqual(disk.notes.map(\.id), [first, second])
        XCTAssertEqual(disk.notes.map(\.body), ["Same thought", "Same thought"])
    }

    @MainActor
    func testClosingConfirmedNoteClearsOnlyItsMatchingDraft() async throws {
        let fixture = try await fixture()
        let session = fixture.session(state: fixture.state, store: fixture.library)
        let id = UUID()
        _ = await session.saveNote(fixture.quote, text: "Confirmed thought", id: id)
        session.draft(fixture.quote, text: "Changed thought")
        await session.flush()
        session.draft(fixture.quote, text: "Confirmed thought")
        await session.flush()
        session.keepNoteDraft(fixture.quote, text: "Confirmed thought", submissionID: id)
        await session.flush()
        var disk = try await fixture.library.state(fixture.book.id)
        XCTAssertEqual(disk.notes.map(\.id), [id])
        XCTAssertNil(disk.drafts[fixture.quote.anchor.key], "Closing a confirmed unchanged note must not leave a redundant draft")
        session.keepNoteDraft(fixture.quote, text: "A new thought", submissionID: id)
        await session.flush()
        disk = try await fixture.library.state(fixture.book.id)
        XCTAssertEqual(disk.drafts[fixture.quote.anchor.key]?.body, "A new thought")
        session.keepNoteDraft(fixture.quote, text: "Confirmed thought", submissionID: UUID())
        await session.flush()
        disk = try await fixture.library.state(fixture.book.id)
        XCTAssertEqual(disk.drafts[fixture.quote.anchor.key]?.body, "Confirmed thought", "A different editor can intentionally keep a draft with the same content")
    }

    @MainActor
    func testTypographyChangesDoNotBecomeExplicitNavigation() async throws {
        let fixture = try await fixture()
        let session = fixture.session(state: fixture.state, store: fixture.library)
        let navigation = session.navigationID
        var preferences = session.state.preferences
        preferences.fontSize += 4
        session.changePreferences(preferences)
        await session.flush()
        XCTAssertEqual(session.navigationID, navigation, "Reflow must retain its position rather than impersonating a source jump")
        session.go(to: 0, anchor: fixture.quote.anchor)
        XCTAssertNotEqual(session.navigationID, navigation, "An explicit same-chapter jump still needs a new identity")
        await session.flush()
    }

    @MainActor
    func testVisibleCheckpointDoesNotPublishStateAndIsIncludedInImmediateFlush() async throws {
        let fixture = try await fixture()
        let session = fixture.session(state: fixture.state, store: fixture.library)
        let changed = expectation(description: "scroll must not publish observed state")
        changed.isInverted = true
        withObservationTracking { _ = session.state; _ = session.navigationID; _ = session.currentAnchor } onChange: { changed.fulfill() }
        var visible = fixture.quote.anchor; visible.characterOffset = 5
        session.recordVisible(visible, navigationID: session.navigationID)
        await fulfillment(of: [changed], timeout: 0.05)
        XCTAssertEqual(session.currentAnchor, visible)
        XCTAssertEqual(session.state.anchor, fixture.quote.anchor)
        let before = try await fixture.library.state(fixture.book.id)
        XCTAssertNil(before.anchor)
        let receipt = await session.flush()
        XCTAssertTrue(session.isCurrent(receipt))
        let disk = try await fixture.library.state(fixture.book.id)
        XCTAssertEqual(disk.anchor, visible)
    }

    @MainActor
    func testFlushIncludesCheckpointArrivingWhileAnEarlierWriteIsSuspended() async throws {
        let fixture = try await fixture()
        let first = expectation(description: "earlier snapshot started")
        let second = expectation(description: "latest visible checkpoint started")
        let store = GatedStateStore(library: fixture.library, starts: [first, second])
        let session = fixture.session(state: fixture.state, store: store)
        session.save()
        await fulfillment(of: [first], timeout: 3)
        let flush = Task { await session.flush() }
        var visible = fixture.quote.anchor; visible.characterOffset = 7
        session.recordVisible(visible, navigationID: session.navigationID)
        await store.release(1)
        await fulfillment(of: [second], timeout: 3)
        let earlier = try await fixture.library.state(fixture.book.id)
        XCTAssertEqual(earlier.anchor, fixture.quote.anchor)
        await store.release(2)
        let receipt = await flush.value
        XCTAssertTrue(session.isCurrent(receipt))
        let disk = try await fixture.library.state(fixture.book.id)
        XCTAssertEqual(disk.anchor, visible)
    }

    @MainActor
    func testOldRenderedCheckpointCannotOverrideAnExplicitJump() async throws {
        let fixture = try await fixture()
        let session = fixture.session(state: fixture.state, store: fixture.library)
        let oldNavigation = session.navigationID
        var oldVisible = fixture.quote.anchor; oldVisible.characterOffset = 3
        session.recordVisible(oldVisible, navigationID: oldNavigation)
        var target = fixture.quote.anchor; target.characterOffset = 8
        session.go(to: 0, anchor: target)
        session.recordVisible(oldVisible, navigationID: oldNavigation)
        var wrongChapter = target; wrongChapter.chapterID = "a different rendered chapter"
        session.recordVisible(wrongChapter, navigationID: session.navigationID)
        XCTAssertEqual(session.currentAnchor, target)
        await session.flush()
        let disk = try await fixture.library.state(fixture.book.id)
        XCTAssertEqual(disk.anchor, target)
    }

    @MainActor
    func testNoteSubmissionConfirmsTheLatestVisibleCheckpoint() async throws {
        let fixture = try await fixture()
        let first = expectation(description: "note snapshot started")
        let second = expectation(description: "latest note and reading position started")
        let store = GatedStateStore(library: fixture.library, starts: [first, second])
        let session = fixture.session(state: fixture.state, store: store)
        let id = UUID()
        let note = Task { await session.saveNote(fixture.quote, text: "Keep this thought", id: id) }
        await fulfillment(of: [first], timeout: 3)
        var visible = fixture.quote.anchor; visible.characterOffset = 6
        session.recordVisible(visible, navigationID: session.navigationID)
        await store.release(1)
        await fulfillment(of: [second], timeout: 3)
        XCTAssertTrue(session.saving)
        await store.release(2)
        let submitted = await note.value
        XCTAssertTrue(submitted)
        let disk = try await fixture.library.state(fixture.book.id)
        XCTAssertEqual(disk.notes.map(\.id), [id])
        XCTAssertEqual(disk.anchor, visible)
        XCTAssertEqual(disk.notes.first?.anchor, fixture.quote.anchor, "The reading checkpoint must not rewrite the note's original quote")
    }

    @MainActor
    func testNewVisibleCheckpointInvalidatesAnEarlierReceiptAndPreferencesSaveIt() async throws {
        let fixture = try await fixture()
        let session = fixture.session(state: fixture.state, store: fixture.library)
        session.save()
        let earlier = await session.flush()
        XCTAssertTrue(session.isCurrent(earlier))
        var visible = fixture.quote.anchor; visible.characterOffset = 9
        session.recordVisible(visible, navigationID: session.navigationID)
        XCTAssertFalse(session.isCurrent(earlier))
        var preferences = session.state.preferences; preferences.fontSize += 2
        session.changePreferences(preferences)
        await session.flush()
        let disk = try await fixture.library.state(fixture.book.id)
        XCTAssertEqual(disk.anchor, visible)
        XCTAssertEqual(disk.preferences, preferences)
    }

    @MainActor
    private func fixture() async throws -> SessionFixture {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("LeafhourSession-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("reading.txt")
        try Data("First source paragraph.\n\nAnother source paragraph.".utf8).write(to: source)
        let library = try OfflineLibrary(root: root.appendingPathComponent("Library"), scope: .device)
        let book = try await library.importFile(source)
        let chapter = try XCTUnwrap(book.chapters.first)
        let passage = try XCTUnwrap(chapter.passages.first)
        let quote = SelectedQuote(anchor: ReadingAnchor(chapterID: chapter.id, passageID: passage.id), text: passage.text)
        var state = ReaderState(); state.anchor = quote.anchor
        return SessionFixture(library: library, book: book, original: try await library.originalURL(book.id), directory: try await library.bookDirectory(book.id), quote: quote, state: state)
    }
}

private struct SessionFixture {
    let library: OfflineLibrary
    let book: LocalBook
    let original: URL
    let directory: URL
    let quote: SelectedQuote
    let state: ReaderState
    @MainActor func session(state: ReaderState, store: any ReaderStateStore) -> ReaderSession {
        ReaderSession(book: book, state: state, original: original, directory: directory, library: store)
    }
}

@MainActor private final class FlushObservation {
    var enabled = true
}

/// Only the storage scheduling/failure boundary is controlled. Successful writes use the real local library.
private actor GatedStateStore: ReaderStateStore {
    struct WriteFailure: Error {}
    let library: OfflineLibrary
    let starts: [XCTestExpectation]
    var count = 0
    var gates: [Int: CheckedContinuation<Void, Error>] = [:]
    init(library: OfflineLibrary, starts: [XCTestExpectation]) { self.library = library; self.starts = starts }
    func saveState(_ state: ReaderState, bookID: String) async throws {
        count += 1
        let ticket = count
        if ticket <= starts.count {
            try await withCheckedThrowingContinuation { continuation in
                gates[ticket] = continuation
                starts[ticket - 1].fulfill()
            }
        }
        try await library.saveState(state, bookID: bookID)
    }
    func release(_ ticket: Int, failing: Bool = false) {
        guard let gate = gates.removeValue(forKey: ticket) else { return }
        if failing { gate.resume(throwing: WriteFailure()) } else { gate.resume() }
    }
}
