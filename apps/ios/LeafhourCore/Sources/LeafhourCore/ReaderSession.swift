import Foundation
import Observation

/// The reading session can persist to the local library or another explicitly supplied state store.
public protocol ReaderStateStore: Sendable {
    func saveState(_ state: ReaderState, bookID: String) async throws
}

extension OfflineLibrary: ReaderStateStore {}

public struct ReaderSaveReceipt: Equatable, Sendable {
    public let revision: Int
    public let persistedRevision: Int
    public let succeeded: Bool
}

@MainActor @Observable
public final class ReaderSession: Identifiable {
    public let book: LocalBook
    public let original: URL
    public let directory: URL
    private let library: any ReaderStateStore
    public nonisolated let id: String
    public var state: ReaderState
    public var chapterIndex: Int
    public var navigationID = UUID()
    public var message: String?
    public var saveMessage: String?
    public var saving = false
    public var saveError: String?
    public var selection: SelectedQuote?
    public var noteEditorID: UUID?
    @ObservationIgnored private var pending: Task<Void, Never>?
    @ObservationIgnored private var revision = 0
    @ObservationIgnored private var persistedRevision = 0
    @ObservationIgnored private var persistedState: ReaderState
    @ObservationIgnored private var noteSubmission: ReaderNote?
    @ObservationIgnored private var noteSubmissionWasPersisted = false
    @ObservationIgnored private var visibleAnchor: ReadingAnchor?
    public init(book: LocalBook, state: ReaderState, original: URL, directory: URL, library: any ReaderStateStore) {
        var restored = state
        let initialChapter: Int
        if let anchor = state.anchor, let index = book.chapters.firstIndex(where: { $0.id == anchor.chapterID }) {
            initialChapter = index
            let chapter = book.chapters[index]
            if let passage = chapter.passages.first(where: { $0.id == anchor.passageID }) {
                restored.anchor?.characterOffset = min(max(0, anchor.characterOffset), passage.text.unicodeScalars.count)
                if anchor.pageY?.isFinite == false { restored.anchor?.pageY = nil }
            } else {
                // An old passage must not send an otherwise known chapter back
                // to the new-book entry point, including a saved cover chapter.
                restored.anchor = chapter.passages.first.map { ReadingAnchor(chapterID: chapter.id, passageID: $0.id) }
            }
        } else {
            let start = Self.readingStart(for: book, directory: directory)
            initialChapter = book.chapters.firstIndex { $0.id == start?.chapterID } ?? 0
            restored.anchor = start
        }
        self.id = book.id; self.book = book; self.state = restored; self.original = original; self.directory = directory; self.library = library
        persistedState = restored
        chapterIndex = initialChapter
    }
    public var chapter: BookChapter { book.chapters[chapterIndex] }
    /// Scroll checkpoints are immediate, while observed state and disk writes remain coalesced.
    public var currentAnchor: ReadingAnchor? { visibleAnchor ?? state.anchor }
    /// A read-only destination for an explicit “start reading” action. A valid
    /// saved cover position is never changed merely by asking for this hint.
    /// Call once on presentation or on demand, not from a repeatedly evaluated body.
    public func declaredReadingStart() -> ReadingAnchor? { Self.readingStart(for: book, directory: directory) }
    private static func readingStart(for book: LocalBook, directory: URL) -> ReadingAnchor? {
        guard book.kind == .epub else { return nil }
        func validated(_ candidate: ReadingAnchor?) -> ReadingAnchor? {
            guard var candidate, let chapter = book.chapters.first(where: { $0.id == candidate.chapterID }),
                  let passage = chapter.passages.first(where: { $0.id == candidate.passageID }) else { return nil }
            candidate.characterOffset = min(max(0, candidate.characterOffset), passage.text.unicodeScalars.count)
            if candidate.pageY?.isFinite == false { candidate.pageY = nil }
            return candidate
        }
        if let start = validated(book.readingStartAnchor) { return start }
        if let start = validated(BookParser.legacyReadingStart(for: book, directory: directory)) { return start }
        if let chapter = book.chapters.first(where: { $0.id == book.readingStartChapterID }), let passage = chapter.passages.first {
            return ReadingAnchor(chapterID: chapter.id, passageID: passage.id)
        }
        return nil
    }
    /// A tool's selected excerpt is temporary; returning to reading must follow the visible passage.
    public func clearTransientSelection() { selection = nil }
    public func recordVisible(_ anchor: ReadingAnchor, navigationID: UUID) {
        guard navigationID == self.navigationID, anchor.chapterID == chapter.id else { return }
        visibleAnchor = anchor
    }
    public func save() {
        if state.anchor != currentAnchor { state.anchor = currentAnchor }
        revision += 1
        let version = revision, snapshot = state, previous = pending
        saving = true
        pending = Task {
            await previous?.value
            do {
                try await library.saveState(snapshot, bookID: book.id)
                persistedRevision = version; persistedState = snapshot
                if let noteSubmission, snapshot.notes.contains(noteSubmission) { noteSubmissionWasPersisted = true }
                if version == revision { saving = false; saveError = nil; saveMessage = nil }
            } catch {
                if version == revision {
                    saveError = error.localizedDescription
                    saveMessage = "记录尚未保存：\(error.localizedDescription)"
                    saving = false
                }
            }
        }
    }
    @discardableResult public func flush() async -> ReaderSaveReceipt {
        while true {
            if state.anchor != currentAnchor { save() }
            let version = revision, task = pending
            await task?.value
            if version == revision && state.anchor == currentAnchor {
                return ReaderSaveReceipt(revision: version, persistedRevision: persistedRevision, succeeded: version == persistedRevision && saveError == nil)
            }
        }
    }
    public func isCurrent(_ receipt: ReaderSaveReceipt) -> Bool {
        receipt.revision == revision && receipt.succeeded && !saving && saveError == nil && state.anchor == currentAnchor
    }
    public func isNotePersisted(id: UUID, body: String) -> Bool {
        persistedState.notes.contains { $0.id == id && $0.body == body }
    }
    public func moved(_ anchor: ReadingAnchor) {
        recordVisible(anchor, navigationID: navigationID)
        guard anchor != state.anchor else { return }
        state.anchor = anchor; save()
    }
    public func go(to index: Int, anchor: ReadingAnchor? = nil) {
        guard book.chapters.indices.contains(index) else { return }
        visibleAnchor = nil
        chapterIndex = index
        state.anchor = anchor ?? ReadingAnchor(chapterID: chapter.id, passageID: chapter.passages.first?.id ?? "page", characterOffset: 0)
        navigationID = UUID(); selection = nil; save()
    }
    public func changePreferences(_ value: ReaderPreferences) { state.preferences = value; save() }
    public func draft(_ quote: SelectedQuote, text: String) {
        state.drafts[quote.anchor.key] = NoteDraft(anchor: quote.anchor, quote: quote.text, body: text); save()
    }
    public func keepNoteDraft(_ quote: SelectedQuote, text: String, submissionID: UUID) {
        let draft = NoteDraft(anchor: quote.anchor, quote: quote.text, body: text)
        let confirmed = persistedState.notes.first { $0.id == submissionID && $0.anchor == quote.anchor && $0.quote == quote.text && $0.body == text }
        if let confirmed, state.notes.contains(confirmed) {
            if state.drafts[quote.anchor.key] == draft { state.drafts.removeValue(forKey: quote.anchor.key) }
            save()
        } else {
            self.draft(quote, text: text)
        }
    }
    @discardableResult public func saveNote(_ quote: SelectedQuote, text: String, id: UUID = UUID()) async -> Bool {
        guard noteSubmission == nil, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        let previous = state.notes.first { $0.id == id }
        let note = ReaderNote(id: id, anchor: quote.anchor, quote: quote.text, body: text)
        noteSubmission = note; noteSubmissionWasPersisted = false
        defer { noteSubmission = nil; noteSubmissionWasPersisted = false }
        if let index = state.notes.firstIndex(where: { $0.id == id }) { state.notes[index] = note }
        else { state.notes.append(note) }
        state.drafts.removeValue(forKey: quote.anchor.key)
        save()
        while true {
            let receipt = await flush()
            guard receipt.revision == revision && state.anchor == currentAnchor else { continue }
            if isCurrent(receipt) { return true }
            // A later failure must not undo a note that an earlier successful snapshot already confirmed.
            if !noteSubmissionWasPersisted {
                if let index = state.notes.firstIndex(where: { $0 == note }) {
                    if let previous { state.notes[index] = previous } else { state.notes.remove(at: index) }
                }
                if state.drafts[quote.anchor.key] == nil {
                    state.drafts[quote.anchor.key] = NoteDraft(anchor: quote.anchor, quote: quote.text, body: text)
                }
            }
            return false
        }
    }
}
public struct SelectedQuote: Identifiable {
    public let anchor: ReadingAnchor
    public let text: String
    /// Exact underlying source for a formatted selection, independent of its displayed characters.
    public let sourceText: String?
    public init(anchor: ReadingAnchor, text: String, sourceText: String? = nil) { self.anchor = anchor; self.text = text; self.sourceText = sourceText }
    public var id: String { anchor.key }
}
