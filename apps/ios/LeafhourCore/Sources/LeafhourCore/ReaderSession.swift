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
    public init(book: LocalBook, state: ReaderState, original: URL, directory: URL, library: any ReaderStateStore) {
        self.id = book.id; self.book = book; self.state = state; self.original = original; self.directory = directory; self.library = library
        persistedState = state
        chapterIndex = book.chapters.firstIndex { $0.id == state.anchor?.chapterID } ?? 0
    }
    public var chapter: BookChapter { book.chapters[chapterIndex] }
    public func save() {
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
            let version = revision, task = pending
            await task?.value
            if version == revision {
                return ReaderSaveReceipt(revision: version, persistedRevision: persistedRevision, succeeded: version == persistedRevision && saveError == nil)
            }
        }
    }
    public func isCurrent(_ receipt: ReaderSaveReceipt) -> Bool {
        receipt.revision == revision && receipt.succeeded && !saving && saveError == nil
    }
    public func isNotePersisted(id: UUID, body: String) -> Bool {
        persistedState.notes.contains { $0.id == id && $0.body == body }
    }
    public func moved(_ anchor: ReadingAnchor) {
        guard anchor != state.anchor else { return }
        state.anchor = anchor; save()
    }
    public func go(to index: Int, anchor: ReadingAnchor? = nil) {
        guard book.chapters.indices.contains(index) else { return }
        chapterIndex = index
        state.anchor = anchor ?? ReadingAnchor(chapterID: chapter.id, passageID: chapter.passages.first?.id ?? "page", characterOffset: 0)
        navigationID = UUID(); selection = nil; save()
    }
    public func changePreferences(_ value: ReaderPreferences) { state.preferences = value; navigationID = UUID(); save() }
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
            guard receipt.revision == revision else { continue }
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
    public init(anchor: ReadingAnchor, text: String) { self.anchor = anchor; self.text = text }
    public var id: String { anchor.key }
}
