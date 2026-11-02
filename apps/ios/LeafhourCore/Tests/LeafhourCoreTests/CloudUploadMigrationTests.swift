import XCTest
@testable import LeafhourCore

final class CloudUploadMigrationTests: XCTestCase {
    func testStaleUploadSnapshotCannotOverwriteNewDraft() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let file = root.appendingPathComponent("Fixture.txt")
        try Data("Unique source paragraph.".utf8).write(to: file)
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .device)
        let book = try await library.importFile(file)
        let expected = try await library.state(book.id)
        let result = CloudUploadMigration.remap(source: book, state: expected, destination: book, destinationState: expected)
        var newer = expected
        let anchor = ReadingAnchor(chapterID: book.chapters[0].id, passageID: book.chapters[0].passages[0].id)
        newer.drafts[anchor.key] = NoteDraft(anchor: anchor, quote: "Unique", body: "Typed while upload matching ran")
        try await library.saveState(newer, bookID: book.id)
        let committed = try await library.commitUploadMigration(result, bookID: book.id, expected: expected)
        XCTAssertFalse(committed)
        let saved = try await library.state(book.id)
        XCTAssertEqual(saved, newer)
    }

    func testReadingTimeMigrationRequiresUniqueSourceAnchorsAndKeepsStableSessionID() throws {
        let source = book([("local", "Unique source paragraph")], chapter: "local-chapter")
        var target = book([("remote", "Unique source paragraph")], chapter: "cloud-chapter")
        target.cloud = CloudBookIdentity(ownerID: "11111111-1111-4111-8111-111111111111", bookID: "cloud-book", contentVersion: "cloud-version", sourceFormat: "txt")
        let base = Date(timeIntervalSince1970: 1_793_491_200)
        var clock = ReadingActivityClock(); try clock.start(bookID: source.id, contentVersion: source.sourceVersion, anchor: ReadingAnchor(chapterID: "local-chapter", passageID: "local"), at: base, id: "keep-session-id")
        clock.tick(at: base.addingTimeInterval(2)); let row = try XCTUnwrap(clock.finish(at: base.addingTimeInterval(2)))
        let mapped = CloudUploadMigration.remap(source: source, state: ReaderState(), destination: target, destinationState: ReaderState(), readingTime: [row])
        XCTAssertEqual(mapped.readingTimeSnapshots.first?.id, row.id)
        XCTAssertEqual(mapped.readingTimeSnapshots.first?.start.passageID, "remote")
        XCTAssertEqual(mapped.readingTimeSnapshots.first?.contentVersion, "cloud-version")
        XCTAssertEqual(mapped.readingTimeSnapshots.first?.segments, row.segments)
        target.chapters[0].passages.append(Passage(id: "ambiguous", text: "Unique source paragraph"))
        let unresolved = CloudUploadMigration.remap(source: source, state: ReaderState(), destination: target, destinationState: ReaderState(), readingTime: [row])
        XCTAssertTrue(unresolved.readingTimeSnapshots.isEmpty); XCTAssertEqual(unresolved.unresolvedCount, 1)
    }
    func book(_ rows: [(String, String)], chapter: String) -> LocalBook {
        LocalBook(id: String(repeating: "a", count: 64), title: "Fixture", author: "", kind: .txt,
            sourceVersion: "fixture", originalFilename: "fixture.txt", importedAt: .distantPast,
            chapters: [BookChapter(id: chapter, title: chapter, sourcePath: chapter,
                passages: rows.map { Passage(id: $0.0, text: $0.1) })])
    }
    func testMapsExactUnicodeSourceAndPreservesNotesDraftAndProgress() {
        let text = "引言 🐿️ café 与原文。"
        let source = book([("local", text)], chapter: "local-chapter")
        let target = book([("remote", "Before " + text + " After")], chapter: "cloud-chapter")
        var state = ReaderState()
        let anchor = ReadingAnchor(chapterID: "local-chapter", passageID: "local", characterOffset: 3)
        state.anchor = anchor
        state.notes = [ReaderNote(anchor: anchor, quote: "🐿️ café", body: "A thought")]
        state.drafts[anchor.key] = NoteDraft(anchor: anchor, quote: "🐿️ café", body: "Unfinished")
        let original = state
        let result = CloudUploadMigration.remap(source: source, state: state, destination: target, destinationState: ReaderState())
        XCTAssertEqual(state, original)
        XCTAssertEqual(result.unresolvedCount, 0)
        XCTAssertEqual(result.state.anchor, ReadingAnchor(chapterID: "cloud-chapter", passageID: "remote", characterOffset: 10))
        XCTAssertEqual(result.state.notes.first?.id, state.notes.first?.id)
        XCTAssertEqual(result.state.notes.first?.anchor, result.state.anchor)
        XCTAssertEqual(result.state.drafts.values.first?.body, "Unfinished")
    }
    func testAmbiguousQuoteIsKeptInOriginalAndNeverGuessed() {
        let source = book([("local", "Shared words")], chapter: "local-chapter")
        let target = book([("remote-1", "Shared words"), ("remote-2", "Shared words")], chapter: "cloud-chapter")
        var state = ReaderState()
        state.notes = [ReaderNote(anchor: ReadingAnchor(chapterID: "local-chapter", passageID: "local"), quote: "Shared words", body: "Personal")]
        let result = CloudUploadMigration.remap(source: source, state: state, destination: target, destinationState: ReaderState())
        XCTAssertEqual(result.unresolvedCount, 1)
        XCTAssertTrue(result.state.notes.isEmpty)
        XCTAssertEqual(state.notes.first?.body, "Personal")
    }
    func testRepeatedMigrationDeduplicatesAndDoesNotReplaceExistingPosition() {
        let source = book([("local", "Unique source paragraph")], chapter: "local-chapter")
        let target = book([("remote", "Unique source paragraph")], chapter: "cloud-chapter")
        var state = ReaderState()
        let anchor = ReadingAnchor(chapterID: "local-chapter", passageID: "local", characterOffset: 7)
        state.anchor = anchor; state.notes = [ReaderNote(anchor: anchor, quote: "source", body: "Keep")]
        var destination = ReaderState()
        destination.anchor = ReadingAnchor(chapterID: "cloud-chapter", passageID: "remote", characterOffset: 2)
        let once = CloudUploadMigration.remap(source: source, state: state, destination: target, destinationState: destination)
        let twice = CloudUploadMigration.remap(source: source, state: state, destination: target, destinationState: once.state)
        XCTAssertEqual(once.state.notes.count, 1)
        XCTAssertEqual(twice.state, once.state)
        XCTAssertEqual(twice.state.anchor, destination.anchor)
        XCTAssertEqual(twice.unresolvedCount, 1, "A different existing position requires a choice")
    }
    func testMigrationCannotEraseNewerDestinationReadingActivity() {
        let source = book([("local", "Unique source paragraph")], chapter: "local-chapter"), target = book([("remote", "Unique source paragraph")], chapter: "cloud-chapter")
        var state = ReaderState(); state.anchor = ReadingAnchor(chapterID: "local-chapter", passageID: "local")
        var destination = ReaderState(); destination.anchor = ReadingAnchor(chapterID: "cloud-chapter", passageID: "remote"); destination.lastActivityAt = Date(timeIntervalSince1970: 1_793_491_200)
        let result = CloudUploadMigration.remap(source: source, state: state, destination: target, destinationState: destination)
        XCTAssertEqual(result.state.lastActivityAt, destination.lastActivityAt)
    }
    func testUniqueSelectedQuoteCanBridgeDifferentParagraphSplitting() {
        let source = book([("local", "First sentence. Distinct selected quote. Last sentence.")], chapter: "local-chapter")
        let target = book([("remote-1", "First sentence."), ("remote-2", "Distinct selected quote."), ("remote-3", "Last sentence.")], chapter: "cloud-chapter")
        var state = ReaderState()
        state.notes = [ReaderNote(anchor: ReadingAnchor(chapterID: "local-chapter", passageID: "local", characterOffset: 16), quote: "Distinct selected quote.", body: "Keep this idea")]
        let result = CloudUploadMigration.remap(source: source, state: state, destination: target, destinationState: ReaderState())
        XCTAssertEqual(result.unresolvedCount, 0)
        XCTAssertEqual(result.state.notes.first?.anchor, ReadingAnchor(chapterID: "cloud-chapter", passageID: "remote-2"))
    }
    func testDraftMigrationPreservesTranslationIdentitiesAlongsideOriginalAndReplaysWithoutDuplicates() {
        let text = "Unique source paragraph for a translated draft."
        let source = book([("local", text)], chapter: "local-chapter")
        let target = book([("remote", "Before " + text + " After")], chapter: "cloud-chapter")
        let anchor = ReadingAnchor(chapterID: "local-chapter", passageID: "local", characterOffset: 7)
        let original = NoteDraft(anchor: anchor, quote: "source", body: "Original draft")
        let literal = NoteDraft(anchor: anchor, quote: "译文选段", body: "Literal draft", quoteOrigin: "translation", quoteVariant: "literal", quoteOffset: 0)
        let laterLiteral = NoteDraft(anchor: anchor, quote: "译文选段", body: "Later literal draft", quoteOrigin: "translation", quoteVariant: "literal", quoteOffset: 7)
        let interpretive = NoteDraft(anchor: anchor, quote: "译文选段", body: "Interpretive draft", quoteOrigin: "translation", quoteVariant: "interpretive", quoteOffset: 0)
        let drafts = [original, literal, laterLiteral, interpretive]
        var state = ReaderState()
        for draft in drafts { state.drafts[draft.id] = draft }
        let sourceBefore = state

        let once = CloudUploadMigration.remap(source: source, state: state, destination: target, destinationState: ReaderState())
        XCTAssertEqual(once.unresolvedCount, 0)
        XCTAssertEqual(once.state.drafts.count, 4, "The same source anchor can own distinct original, variant, and translation-offset drafts")
        let mappedAnchor = ReadingAnchor(chapterID: "cloud-chapter", passageID: "remote", characterOffset: 14)
        for draft in drafts {
            let selection = SelectedQuote(anchor: mappedAnchor, text: draft.quote, origin: draft.quoteOrigin, variant: draft.quoteVariant, translationOffset: draft.quoteOffset)
            let migrated = once.state.drafts[selection.id]
            XCTAssertEqual(migrated?.anchor, mappedAnchor)
            XCTAssertEqual(migrated?.quote, draft.quote)
            XCTAssertEqual(migrated?.body, draft.body)
            XCTAssertEqual(migrated?.quoteOrigin, draft.quoteOrigin)
            XCTAssertEqual(migrated?.quoteVariant, draft.quoteVariant)
            XCTAssertEqual(migrated?.quoteOffset, draft.quoteOffset)
        }
        XCTAssertEqual(once.state.drafts[mappedAnchor.key]?.body, "Original draft", "Source-only drafts keep the existing anchor-key contract")
        let twice = CloudUploadMigration.remap(source: source, state: state, destination: target, destinationState: once.state)
        XCTAssertEqual(twice.state, once.state)
        XCTAssertEqual(twice.unresolvedCount, 0)
        XCTAssertEqual(state, sourceBefore)
    }

    func testDraftMigrationPreservesConflictingDestinationTranslationAndReportsUnresolved() {
        let text = "Unique source paragraph"
        let source = book([("local", text)], chapter: "local-chapter")
        let target = book([("remote", text)], chapter: "cloud-chapter")
        let sourceAnchor = ReadingAnchor(chapterID: "local-chapter", passageID: "local", characterOffset: 2)
        let targetAnchor = ReadingAnchor(chapterID: "cloud-chapter", passageID: "remote", characterOffset: 2)
        let incoming = NoteDraft(anchor: sourceAnchor, quote: "已选译文", body: "Source unfinished text", quoteOrigin: "translation", quoteVariant: "interpretive", quoteOffset: 4)
        let existing = NoteDraft(anchor: targetAnchor, quote: "已选译文", body: "Newer destination text", quoteOrigin: "translation", quoteVariant: "interpretive", quoteOffset: 4)
        var state = ReaderState(); state.drafts[incoming.id] = incoming
        var destination = ReaderState(); destination.drafts[existing.id] = existing
        let sourceBefore = state, destinationBefore = destination

        let once = CloudUploadMigration.remap(source: source, state: state, destination: target, destinationState: destination)
        XCTAssertEqual(once.unresolvedCount, 1)
        XCTAssertEqual(once.state, destinationBefore)
        XCTAssertNil(once.state.drafts[targetAnchor.key], "A conflicting translation must not also become an original-layer draft")
        let twice = CloudUploadMigration.remap(source: source, state: state, destination: target, destinationState: once.state)
        XCTAssertEqual(twice.unresolvedCount, 1)
        XCTAssertEqual(twice.state, destinationBefore)
        XCTAssertEqual(state, sourceBefore)
    }

    func testTranslationDraftDoesNotUseItsDisplayedQuoteToGuessAChangedSourceAnchor() {
        let text = "First sentence. Distinct selected quote. Last sentence."
        let source = book([("local", text)], chapter: "local-chapter")
        let target = book([("remote-1", "First sentence."), ("remote-2", "Distinct selected quote."), ("remote-3", "Last sentence.")], chapter: "cloud-chapter")
        let anchor = ReadingAnchor(chapterID: "local-chapter", passageID: "local", characterOffset: 16)
        // A translation may happen to contain source words. That coincidence is
        // not proof that its display offset belongs to the reparsed paragraph.
        let translated = NoteDraft(anchor: anchor, quote: "Distinct selected quote.", body: "Translated selection draft", quoteOrigin: "translation", quoteVariant: "literal", quoteOffset: 6)
        let original = NoteDraft(anchor: anchor, quote: "Distinct selected quote.", body: "Original selection draft")
        var state = ReaderState(); state.drafts[translated.id] = translated; state.drafts[original.id] = original
        let sourceBefore = state

        let result = CloudUploadMigration.remap(source: source, state: state, destination: target, destinationState: ReaderState())
        XCTAssertEqual(result.unresolvedCount, 1)
        XCTAssertEqual(result.state.drafts.count, 1)
        let mappedAnchor = ReadingAnchor(chapterID: "cloud-chapter", passageID: "remote-2")
        XCTAssertEqual(result.state.drafts[mappedAnchor.key]?.body, original.body, "Existing source-quote fallback remains supported")
        XCTAssertNil(result.state.drafts[mappedAnchor.key]?.quoteOrigin)
        XCTAssertEqual(state, sourceBefore, "The unresolved translated draft remains intact in the source book")
    }

    func testTranslationDraftWithAmbiguousWholeSourceRemainsUnresolved() {
        let text = "Repeated source paragraph"
        let source = book([("local", text)], chapter: "local-chapter")
        let target = book([("remote-1", text), ("remote-2", text)], chapter: "cloud-chapter")
        let anchor = ReadingAnchor(chapterID: "local-chapter", passageID: "local")
        let draft = NoteDraft(anchor: anchor, quote: "原文之外的译文", body: "Keep in the original", quoteOrigin: "translation", quoteVariant: "literal", quoteOffset: 3)
        var state = ReaderState(); state.drafts[draft.id] = draft
        let sourceBefore = state
        let result = CloudUploadMigration.remap(source: source, state: state, destination: target, destinationState: ReaderState())
        XCTAssertEqual(result.unresolvedCount, 1)
        XCTAssertTrue(result.state.drafts.isEmpty)
        XCTAssertEqual(state, sourceBefore)
    }
}
