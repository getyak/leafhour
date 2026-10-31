import UIKit

@MainActor protocol ReaderSpeechPaintingLayout: AnyObject {
    var speechHighlightRange: NSRange? { get set }
}

struct ReaderSpeechTextTarget {
    let sentence: NSRange
    let word: NSRange
}

/// Temporary paint preserves native selection and the attributed source. Follow
/// the word even when the enclosing sentence spans more than one screen.
@MainActor final class ReaderSpeechTextFollower {
    private var applied: NSRange?
    func apply(to view: UITextView, target: ReaderSpeechTextTarget?, following: Bool, viewport: CGRect, pages: ReaderTextPagination?) {
        let count = view.attributedText.length, next = target?.sentence
        if applied != next {
            let valid = next.flatMap { $0.length > 0 && $0.location >= 0 && NSMaxRange($0) <= count ? $0 : nil }
            (view.layoutManager as? ReaderSpeechPaintingLayout)?.speechHighlightRange = valid
            applied = valid
            view.textInputView.setNeedsDisplay()
        }
        guard following, view.selectedRange.length == 0, !view.isTracking, !view.isDragging, !view.isDecelerating,
              let word = target?.word, word.length > 0, word.location >= 0, NSMaxRange(word) <= count else { return }
        let glyphs = view.layoutManager.glyphRange(forCharacterRange: word, actualCharacterRange: nil)
        let rect = view.layoutManager.boundingRect(forGlyphRange: glyphs, in: view.textContainer)
            .offsetBy(dx: view.textContainerInset.left, dy: view.textContainerInset.top)
        guard !viewport.insetBy(dx: -1, dy: -1).contains(rect) else { return }
        let desired = rect.minY - (viewport.minY - view.bounds.minY)
        let minimum = -view.adjustedContentInset.top
        let maximum = max(minimum, view.contentSize.height - view.bounds.height + view.adjustedContentInset.bottom)
        let offset = pages.map { $0.origins[$0.index(at: desired)] } ?? min(maximum, max(minimum, desired))
        view.setContentOffset(CGPoint(x: view.contentOffset.x, y: offset), animated: false)
    }
    func invalidate(in view: UITextView) {
        (view.layoutManager as? ReaderSpeechPaintingLayout)?.speechHighlightRange = nil
        applied = nil
    }
}
