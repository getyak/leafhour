import Foundation
import LeafhourCore

/// Owned by a native reading surface. A snapshot keeps its captured revision;
/// resizing, scrolling, reflow and teardown revoke that revision immediately.
@MainActor
final class ReaderVisiblePageLayout {
    private(set) var revision = UUID()
    private var validation: (() -> Bool)?
    func invalidate() { revision = UUID(); validation = nil }
    func bind(_ validation: @escaping () -> Bool) { self.validation = validation }
    func isCurrent(_ revision: UUID) -> Bool { self.revision == revision && (validation?() ?? true) }
}

/// Complete author paragraphs intersecting one settled, real native viewport.
/// A page never infers source IDs from a chapter index or reading percentage.
@MainActor
struct ReaderVisiblePage: Equatable {
    let sessionID: String
    let navigationID: UUID
    let chapterID: String
    let preferences: ReaderPreferences
    let passageIDs: [String]
    let layoutRevision: UUID
    private let sessionOwner: ObjectIdentifier
    private let sourceVersion: String
    private let identity: CloudBookIdentity?
    private let original: URL
    private let languages: BookTranslationSettings
    private let contentRevision: Int
    private let layout: ReaderVisiblePageLayout

    init?(session: ReaderSession, chapterID: String, passageIDs: [String], layout: ReaderVisiblePageLayout) {
        guard chapterID == session.chapter.id, !passageIDs.isEmpty,
              Set(passageIDs).count == passageIDs.count else { return nil }
        let selected = Set(passageIDs)
        let source = session.chapter.passages.filter { selected.contains($0.id) }
        guard source.count == passageIDs.count, source.map(\.id) == passageIDs,
              source.allSatisfy({ ReadingTranslationPlan.isPageText($0, in: session.book) }) else { return nil }
        sessionID = session.id; sessionOwner = ObjectIdentifier(session)
        navigationID = session.navigationID; self.chapterID = chapterID
        preferences = session.state.preferences; self.passageIDs = passageIDs
        sourceVersion = session.book.sourceVersion; identity = session.book.cloud
        original = session.original; languages = session.translationSettings
        contentRevision = session.contentRevision
        self.layout = layout; layoutRevision = layout.revision
    }

    func isCurrent(_ session: ReaderSession) -> Bool {
        sessionID == session.id && sessionOwner == ObjectIdentifier(session)
            && navigationID == session.navigationID && chapterID == session.chapter.id
            && preferences == session.state.preferences && languages == session.translationSettings
            && sourceVersion == session.book.sourceVersion && identity == session.book.cloud
            && original == session.original && contentRevision == session.contentRevision
            && layout.isCurrent(layoutRevision)
    }

    nonisolated static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.sessionOwner == rhs.sessionOwner && lhs.navigationID == rhs.navigationID
            && lhs.chapterID == rhs.chapterID && lhs.preferences == rhs.preferences
            && lhs.passageIDs == rhs.passageIDs && lhs.layoutRevision == rhs.layoutRevision
            && lhs.sourceVersion == rhs.sourceVersion && lhs.identity == rhs.identity
            && lhs.original == rhs.original && lhs.languages == rhs.languages
            && lhs.contentRevision == rhs.contentRevision && lhs.layout === rhs.layout
    }
}
