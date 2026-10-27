import Foundation
import PDFKit
public enum PDFTextAnchor {
    public static func make(selection: PDFSelection, page: PDFPage, chapterID: String, passageID: String) -> ReadingAnchor? {
        guard selection.numberOfTextRanges(on: page) == 1, let content = page.string else { return nil }
        let range = selection.range(at: 0, on: page)
        guard range.location != NSNotFound, range.location >= 0, range.length > 0, range.location <= (content as NSString).length - range.length else { return nil }
        let offset = (content as NSString).substring(to: range.location).unicodeScalars.count
        return ReadingAnchor(chapterID: chapterID, passageID: passageID, characterOffset: offset, pageY: Double(selection.bounds(for: page).maxY))
    }
}
