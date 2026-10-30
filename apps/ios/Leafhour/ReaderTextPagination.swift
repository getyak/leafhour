import UIKit
import QuartzCore

struct ReaderPagePosition: Equatable {
    let index: Int
    let count: Int
    let chapterIndex: Int
}
enum ReaderPageDirection: Equatable { case previous, next }

/// Current-chapter screen origins derived from the real TextKit layout. Source
/// anchors remain the persisted position; these offsets are disposable geometry.
struct ReaderTextPagination {
    let origins: [CGFloat]
    @MainActor init(textView: UITextView, readingTop: CGFloat, bottomInset: CGFloat) {
        textView.layoutManager.ensureLayout(for: textView.textContainer)
        textView.layoutIfNeeded()
        let minimum = -textView.adjustedContentInset.top
        let firstFont = textView.attributedText.length > 0 ? textView.attributedText.attribute(.font, at: 0, effectiveRange: nil) as? UIFont : nil
        let defaultLine = (textView.font ?? firstFont ?? UIFont.preferredFont(forTextStyle: .body)).lineHeight
        let height = max(1, max(defaultLine, textView.bounds.height - readingTop - bottomInset))
        var result = [minimum]
        textView.layoutManager.enumerateLineFragments(forGlyphRange: NSRange(location: 0, length: textView.layoutManager.numberOfGlyphs)) { _, used, _, glyphs, _ in
            guard glyphs.length > 0, used.height > 0, let current = result.last else { return }
            let start = used.minY + textView.textContainerInset.top - readingTop
            let end = used.maxY + textView.textContainerInset.top - readingTop
            guard end > current + height + 0.5 else { return }
            // Start the first line that cannot fit on a new screen. A forced
            // contentSize-derived final offset can put that screen mid-glyph.
            if start > current + 0.5 { result.append(start) }
            // Only a line containing an oversized attachment may be sliced.
            // Ordinary source lines retain a real line boundary as their origin.
            let characters = textView.layoutManager.characterRange(forGlyphRange: glyphs, actualGlyphRange: nil)
            var hasAttachment = false
            textView.attributedText.enumerateAttribute(.attachment, in: characters) { attachment, _, stop in
                if attachment != nil { hasAttachment = true; stop.pointee = true }
            }
            if hasAttachment {
                while let origin = result.last, end > origin + height + 0.5 {
                    result.append(origin + height)
                }
            }
        }
        origins = result
    }
    func index(at offset: CGFloat) -> Int {
        var lower = 0, upper = origins.count
        while lower < upper {
            let middle = (lower + upper) / 2
            if origins[middle] <= offset + 0.5 { lower = middle + 1 } else { upper = middle }
        }
        return max(0, lower - 1)
    }
    func destination(_ direction: ReaderPageDirection, from offset: CGFloat) -> CGFloat? {
        let current = index(at: offset)
        if direction == .previous, offset > origins[current] + 1 { return origins[current] }
        let next = current + (direction == .next ? 1 : -1)
        return origins.indices.contains(next) ? origins[next] : nil
    }
}

@MainActor
final class ReaderPageTurnGestureHandler: NSObject, UIGestureRecognizerDelegate {
    private weak var view: UIView?
    private let blocked: () -> Bool
    private let onTurn: (ReaderPageDirection) -> Void
    private(set) var recognizer: UIPanGestureRecognizer!
    var isEnabled: Bool { get { recognizer.isEnabled } set { recognizer.isEnabled = newValue } }
    init(view: UIView, blocked: @escaping () -> Bool, onTurn: @escaping (ReaderPageDirection) -> Void) {
        self.view = view; self.blocked = blocked; self.onTurn = onTurn
        super.init()
        recognizer = UIPanGestureRecognizer(target: self, action: #selector(handle(_:)))
        recognizer.minimumNumberOfTouches = 1; recognizer.maximumNumberOfTouches = 1
        recognizer.cancelsTouchesInView = false; recognizer.delegate = self
        view.addGestureRecognizer(recognizer)
    }
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        guard !blocked(), !UIAccessibility.isVoiceOverRunning, let view else { return false }
        var touched = touch.view
        while let current = touched, current !== view {
            if current is UIControl { return false }
            touched = current.superview
        }
        if ReaderEdgeTapHandler.isLink(at: touch.location(in: view), in: view) { return false }
        return true
    }
    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        guard !blocked(), let pan = gestureRecognizer as? UIPanGestureRecognizer, let view else { return false }
        let velocity = pan.velocity(in: view)
        return abs(velocity.x) > abs(velocity.y) * 1.4
    }
    @objc private func handle(_ pan: UIPanGestureRecognizer) { complete(state: pan.state, translation: pan.translation(in: view)) }
    func complete(state: UIGestureRecognizer.State, translation: CGPoint) {
        guard state == .ended, !blocked(), abs(translation.x) >= 40, abs(translation.x) > abs(translation.y) * 1.4 else { return }
        onTurn(translation.x < 0 ? .next : .previous)
    }
    func invalidate() { if let recognizer { view?.removeGestureRecognizer(recognizer) }; view = nil }
}

@MainActor enum ReaderPageTransition {
    static let key = "leafhour-page-turn"
    static func apply(to view: UIView, direction: ReaderPageDirection) {
        view.layer.removeAnimation(forKey: key)
        guard !UIAccessibility.isReduceMotionEnabled, view.window != nil else { return }
        let transition = CATransition()
        transition.type = .push; transition.subtype = direction == .next ? .fromRight : .fromLeft
        transition.duration = 0.18; transition.timingFunction = CAMediaTimingFunction(name: .easeOut)
        view.layer.add(transition, forKey: key)
    }
}
