import Foundation
import CryptoKit
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
    public private(set) var readingTimePhase: ReadingTimePhase = .idle
    public private(set) var readingTimeDurationSeconds = 0
    public private(set) var readingTimeSource: ReadingTimeSource = .focus
    public private(set) var readingTimeWantsRunning = false
    public private(set) var readingTimeError: String?
    @ObservationIgnored private var readingClock = ReadingActivityClock()
    @ObservationIgnored private var timePersistence: Task<Void, Never>?
    @ObservationIgnored private var timePrepared = false
    @ObservationIgnored private var timeRevision = 0
    @ObservationIgnored private var timePersistedRevision = 0
    @ObservationIgnored private var lastTimeCheckpoint = Date.distantPast
    @ObservationIgnored private var lastActivitySave = Date.distantPast
    @ObservationIgnored private var readingVisible = true
    @ObservationIgnored private var activityNeedsSave = false
    public private(set) var translations: [String: ReadingTranslation] = [:]
    public private(set) var contentRevision = 0
    public func updateTranslations(_ rows: [String: ReadingTranslation]) {
        let sources = Dictionary(uniqueKeysWithValues: book.chapters.flatMap(\.passages).map { ($0.id, $0.text) })
        var updated = translations
        for (id, value) in rows where sources[id] == value.original {
            var incoming = value
            if let prior = updated[id], prior.original == value.original {
                if incoming.text(.literal) == nil || (prior.literalStatus == "reviewed" && incoming.literalStatus != "reviewed") { incoming.literal = prior.literal; incoming.literalStatus = prior.literalStatus }
                if incoming.text(.interpretive) == nil || (prior.interpretiveStatus == "reviewed" && incoming.interpretiveStatus != "reviewed") { incoming.interpretive = prior.interpretive; incoming.interpretiveStatus = prior.interpretiveStatus }
            }
            updated[id] = incoming
        }
        if updated != translations { translations = updated; contentRevision += 1 }
    }
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
                if let y = anchor.resourceY, !y.isFinite || !(0...1).contains(y) || passage.resourcePath == nil || book.kind == .pdf || anchor.pageY != nil || anchor.characterOffset != 0 {
                    restored.anchor?.resourceY = nil
                }
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
    public func startReadingTime(source: ReadingTimeSource = .focus) {
        guard let anchor = currentAnchor else { return }
        do {
            try readingClock.start(bookID: book.cloud?.bookID ?? book.id, contentVersion: book.cloud?.contentVersion ?? book.sourceVersion, anchor: anchor, source: source, at: Date())
            recordReadingInteraction(); checkpointReadingTime(); updateReadingTime()
        } catch { readingTimeError = error.localizedDescription }
    }
    public func pauseReadingTime() { readingClock.pause(at: Date()); checkpointReadingTime(); updateReadingTime() }
    public func resumeReadingTime() { readingClock.resume(at: Date()); checkpointReadingTime(); updateReadingTime() }
    public func finishReadingTime() {
        if let anchor = currentAnchor { readingClock.setContext(anchor) }
        if let snapshot = readingClock.finish(at: Date()) { persistReadingTime(snapshot) }
        updateReadingTime()
    }
    public func setReadingVisible(_ visible: Bool) {
        readingVisible = visible; readingClock.setVisible(visible, at: Date()); checkpointReadingTime(); updateReadingTime()
    }
    /// Call only for a real reader gesture. Restoring, saving or speech navigation
    /// deliberately do not call this method or manufacture a recent-reading event.
    public func recordReadingInteraction() {
        guard readingVisible else { return }
        let now = Date(); state.lastActivityAt = ReadingTimeDate.stamp(now); activityNeedsSave = true
        readingClock.interact(at: now)
        if let anchor = currentAnchor { readingClock.setContext(anchor) }
        if now.timeIntervalSince(lastActivitySave) >= 1 { lastActivitySave = now; save() }
        updateReadingTime()
    }
    public func tickReadingTime() {
        let before = readingClock.phase, now = Date(); readingClock.tick(at: now)
        if let anchor = currentAnchor { readingClock.setContext(anchor) }
        if now.timeIntervalSince(lastTimeCheckpoint) >= 30 || readingClock.phase != before { checkpointReadingTime() }
        updateReadingTime()
    }
    @discardableResult public func flushReadingTime() async -> Bool {
        checkpointReadingTime()
        while true {
            let revision = timeRevision, task = timePersistence; await task?.value
            if revision == timeRevision { return timePersistedRevision == revision && readingTimeError == nil }
        }
    }
    private func updateReadingTime() {
        readingTimePhase = readingClock.phase; readingTimeDurationSeconds = readingClock.durationSeconds; readingTimeSource = readingClock.source; readingTimeWantsRunning = readingClock.wantsRunning
    }
    private func checkpointReadingTime() {
        if let anchor = currentAnchor { readingClock.setContext(anchor) }
        if let snapshot = readingClock.snapshot(at: Date()) { persistReadingTime(snapshot) }
    }
    private func persistReadingTime(_ snapshot: ReadingTimeSnapshot) {
        guard let store = library as? any ReadingTimeStore else { readingTimeError = "此阅读空间暂不支持保存计时。"; readingClock.pause(at: Date()); updateReadingTime(); return }
        lastTimeCheckpoint = Date(); timeRevision += 1
        let revision = timeRevision, previous = timePersistence
        timePersistence = Task {
            await previous?.value
            do {
                if !timePrepared { try await store.recoverReadingTime(bookID: book.id); timePrepared = true }
                try await store.retainReadingTime(snapshot, bookID: book.id)
                timePersistedRevision = revision
                if revision == timeRevision { readingTimeError = nil }
            } catch {
                if revision == timeRevision { readingTimeError = error.localizedDescription; readingClock.pause(at: Date()); updateReadingTime() }
            }
        }
    }
    /// A read-only destination for an explicit “start reading” action. A valid
    /// saved cover position is never changed merely by asking for this hint.
    /// Call once on presentation or on demand, not from a repeatedly evaluated body.
    public func declaredReadingStart() -> ReadingAnchor? { Self.readingStart(for: book, directory: directory) }
    private static func readingStart(for book: LocalBook, directory: URL) -> ReadingAnchor? {
        guard book.kind == .epub || book.cloud != nil else { return nil }
        func validated(_ candidate: ReadingAnchor?) -> ReadingAnchor? {
            guard var candidate, let chapter = book.chapters.first(where: { $0.id == candidate.chapterID }),
                  let passage = chapter.passages.first(where: { $0.id == candidate.passageID }) else { return nil }
            candidate.characterOffset = min(max(0, candidate.characterOffset), passage.text.unicodeScalars.count)
            if candidate.pageY?.isFinite == false { candidate.pageY = nil }
            if let y = candidate.resourceY, !y.isFinite || !(0...1).contains(y) || passage.resourcePath == nil || book.kind == .pdf || candidate.pageY != nil || candidate.characterOffset != 0 {
                candidate.resourceY = nil
            }
            return candidate
        }
        if let start = validated(book.readingStartAnchor) { return start }
        // Cloud caches prepare their hint on OfflineLibrary's actor. Never
        // decode cloud-content.json from this main-actor session or SwiftUI body.
        guard book.kind == .epub else { return nil }
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
        activityNeedsSave = false
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
            if state.anchor != currentAnchor || activityNeedsSave { save() }
            let version = revision, task = pending
            await task?.value
            if version == revision && state.anchor == currentAnchor && !activityNeedsSave {
                return ReaderSaveReceipt(revision: version, persistedRevision: persistedRevision, succeeded: version == persistedRevision && saveError == nil)
            }
        }
    }
    public func isCurrent(_ receipt: ReaderSaveReceipt) -> Bool {
        receipt.revision == revision && receipt.succeeded && !saving && saveError == nil && !activityNeedsSave && state.anchor == currentAnchor
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
        state.drafts[quote.id] = NoteDraft(anchor: quote.anchor, quote: quote.text, body: text, quoteOrigin: quote.origin, quoteVariant: quote.variant, quoteOffset: quote.translationOffset); save()
    }
    public func keepNoteDraft(_ quote: SelectedQuote, text: String, submissionID: UUID) {
        let draft = NoteDraft(anchor: quote.anchor, quote: quote.text, body: text, quoteOrigin: quote.origin, quoteVariant: quote.variant, quoteOffset: quote.translationOffset)
        let confirmed = persistedState.notes.first { $0.id == submissionID && $0.anchor == quote.anchor && $0.quote == quote.text && $0.body == text }
        if let confirmed, state.notes.contains(confirmed) {
            if state.drafts[quote.id] == draft { state.drafts.removeValue(forKey: quote.id) }
            save()
        } else {
            self.draft(quote, text: text)
        }
    }
    @discardableResult public func saveNote(_ quote: SelectedQuote, text: String, id: UUID = UUID()) async -> Bool {
        guard noteSubmission == nil, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        let previous = state.notes.first { $0.id == id }
        let note = ReaderNote(id: id, anchor: quote.anchor, quote: quote.text, body: text, quoteOrigin: quote.origin, quoteVariant: quote.variant)
        noteSubmission = note; noteSubmissionWasPersisted = false
        defer { noteSubmission = nil; noteSubmissionWasPersisted = false }
        if let index = state.notes.firstIndex(where: { $0.id == id }) { state.notes[index] = note }
        else { state.notes.append(note) }
        state.drafts.removeValue(forKey: quote.id)
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
                if state.drafts[quote.id] == nil {
                    state.drafts[quote.id] = NoteDraft(anchor: quote.anchor, quote: quote.text, body: text, quoteOrigin: quote.origin, quoteVariant: quote.variant, quoteOffset: quote.translationOffset)
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
    public let origin: String?
    public let variant: String?
    public let translationOffset: Int?
    public init(anchor: ReadingAnchor, text: String, sourceText: String? = nil, origin: String? = nil, variant: String? = nil, translationOffset: Int? = nil) {
        self.anchor = anchor; self.text = text; self.sourceText = sourceText; self.origin = origin; self.variant = variant; self.translationOffset = translationOffset
    }
    public var id: String {
        guard origin == "translation" else { return anchor.key }
        let digest = SHA256.hash(data: Data(text.utf8)).prefix(8).map { String(format: "%02x", $0) }.joined()
        return anchor.key + ":translation:" + (variant ?? "literal") + ":" + String(translationOffset ?? 0) + ":" + digest
    }
}
