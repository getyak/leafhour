import Foundation

public struct CloudUploadMigrationResult: Sendable {
    public let state: ReaderState
    /// Unmatched or conflicting records remain in the source book, never discarded.
    public let unresolvedCount: Int
}

/// Upload reparses the retained original on the server, so local and cloud passage IDs
/// may differ. Only unique, exact source matches can transfer a personal reference.
public enum CloudUploadMigration {
    public static func remap(source: LocalBook, state: ReaderState, destination: LocalBook, destinationState: ReaderState) -> CloudUploadMigrationResult {
        var result = destinationState, unresolved = 0
        let targets = destination.chapters.flatMap { chapter in chapter.passages.filter { $0.resourcePath == nil }.map { (chapter.id, $0) } }

        func unique(_ needle: String) -> ReadingAnchor? {
            guard !needle.isEmpty else { return nil }
            var found: ReadingAnchor?
            for (chapter, passage) in targets {
                let text = passage.text as NSString
                let range = text.range(of: needle, options: .literal)
                guard range.location != NSNotFound else { continue }
                // A second occurrence in this paragraph is just as ambiguous as a
                // second paragraph; neither can stand in for the reader's choice.
                let next = range.location + 1
                if found != nil || (next < text.length && text.range(of: needle, options: .literal, range: NSRange(location: next, length: text.length - next)).location != NSNotFound) { return nil }
                found = ReadingAnchor(chapterID: chapter, passageID: passage.id, characterOffset: text.substring(to: range.location).unicodeScalars.count)
            }
            return found
        }
        func remap(_ anchor: ReadingAnchor, quote: String? = nil) -> ReadingAnchor? {
            guard let passage = source.chapters.first(where: { $0.id == anchor.chapterID })?.passages.first(where: { $0.id == anchor.passageID }),
                  anchor.characterOffset >= 0, anchor.characterOffset <= passage.text.unicodeScalars.count else { return nil }
            if var exact = unique(passage.text) {
                exact.characterOffset += anchor.characterOffset
                return exact
            }
            if let quote, (passage.text as NSString).range(of: quote, options: .literal).location != NSNotFound, let selected = unique(quote) { return selected }
            // Position-only references can survive paragraph splitting if a substantial
            // source context around the exact offset occurs once in the cloud copy.
            guard quote == nil else { return nil }
            let scalars = Array(passage.text.unicodeScalars)
            let start = max(0, anchor.characterOffset - 40), end = min(scalars.count, anchor.characterOffset + 80)
            guard end - start >= 16 else { return nil }
            let context = String(String.UnicodeScalarView(scalars[start..<end]))
            guard var mapped = unique(context) else { return nil }
            mapped.characterOffset += anchor.characterOffset - start
            return mapped
        }
        for note in state.notes {
            guard let anchor = remap(note.anchor, quote: note.quote) else { unresolved += 1; continue }
            if let existing = result.notes.first(where: { $0.id == note.id }) {
                if existing.body != note.body || existing.quote != note.quote || existing.anchor != anchor { unresolved += 1 }
                continue
            }
            var mapped = note; mapped.anchor = anchor; result.notes.append(mapped)
        }
        for draft in state.drafts.values {
            guard let anchor = remap(draft.anchor, quote: draft.quote) else { unresolved += 1; continue }
            if let existing = result.drafts[anchor.key] {
                if existing.body != draft.body || existing.quote != draft.quote { unresolved += 1 }
                continue
            }
            result.drafts[anchor.key] = NoteDraft(anchor: anchor, quote: draft.quote, body: draft.body)
        }
        if let original = state.anchor {
            if let mapped = remap(original) {
                if result.anchor == nil || result.anchor == mapped { result.anchor = mapped }
                else { unresolved += 1 }
            } else { unresolved += 1 }
        }
        return CloudUploadMigrationResult(state: result, unresolvedCount: unresolved)
    }
}
