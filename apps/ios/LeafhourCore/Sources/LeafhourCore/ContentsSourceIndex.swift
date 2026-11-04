import Foundation

public struct ContentsSourceMatch: Identifiable, Equatable, Sendable {
    public let chapterIndex: Int
    public let anchor: ReadingAnchor
    public let quote: String
    let passageIndex: Int
    public var id: String { anchor.key }
}

/// Navigation comes only from the source snapshot, never an AI summary or URL.
public enum ContentsSourceIndex {
    public static func validated(_ references: [CloudJSON], in book: LocalBook) -> [ContentsSourceMatch] {
        var matches: [ContentsSourceMatch] = [], seen = Set<String>()
        for ref in references {
            guard ref["bookId"].string == book.id,
                  ref["sourceVersion"].string == book.sourceVersion,
                  ref["contentVersion"].string == book.sourceVersion,
                  ref["source"].string == "local-device", ref["layer"].string == "original",
                  let chapterID = ref["chapterId"].string,
                  let chapterIndex = book.chapters.firstIndex(where: { $0.id == chapterID }),
                  let passageID = ref["passageId"].string,
                  let passageIndex = book.chapters[chapterIndex].passages.firstIndex(where: { $0.id == passageID }),
                  let quote = ref["quote"].string,
                  !quote.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, quote.utf8.count <= 24_576 else { continue }
            let passage = book.chapters[chapterIndex].passages[passageIndex]
            guard passage.resourcePath == nil else { continue }
            let offset: Int
            if case .null = ref["charOffset"] {
                let source = passage.text as NSString
                let first = source.range(of: quote, options: .literal)
                guard first.location != NSNotFound else { continue }
                let after = first.location + 1
                let remaining = NSRange(location: after, length: source.length - after)
                guard source.range(of: quote, options: .literal, range: remaining).location == NSNotFound else { continue }
                offset = source.substring(to: first.location).unicodeScalars.count
            } else {
                guard let start = integer(ref["charOffset"]), let end = integer(ref["charEnd"]),
                      start >= 0, end > start, end - start == quote.unicodeScalars.count,
                      end <= passage.text.unicodeScalars.count else { continue }
                let scalars = passage.text.unicodeScalars
                let lower = scalars.index(scalars.startIndex, offsetBy: start)
                let upper = scalars.index(lower, offsetBy: end - start)
                guard String(scalars[lower..<upper]).utf16.elementsEqual(quote.utf16) else { continue }
                offset = start
            }
            let anchor = ReadingAnchor(chapterID: chapterID, passageID: passageID, characterOffset: offset)
            guard seen.insert(anchor.key).inserted else { continue }
            matches.append(ContentsSourceMatch(chapterIndex: chapterIndex, anchor: anchor, quote: quote, passageIndex: passageIndex))
        }
        return matches.sorted {
            if $0.chapterIndex != $1.chapterIndex { return $0.chapterIndex < $1.chapterIndex }
            if $0.passageIndex != $1.passageIndex { return $0.passageIndex < $1.passageIndex }
            return $0.anchor.characterOffset < $1.anchor.characterOffset
        }
    }
    private static func integer(_ value: CloudJSON) -> Int? {
        guard let number = value.number, number.isFinite, number.rounded() == number,
              number >= 0, number < Double(Int.max) else { return nil }
        return Int(number)
    }
}
