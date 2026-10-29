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
        let maximum = max(minimum, textView.contentSize.height - textView.bounds.height + textView.adjustedContentInset.bottom)
        let firstFont = textView.attributedText.length > 0 ? textView.attributedText.attribute(.font, at: 0, effectiveRange: nil) as? UIFont : nil
        let defaultLine = (textView.font ?? firstFont ?? UIFont.preferredFont(forTextStyle: .body)).lineHeight
        let height = max(1, max(defaultLine, textView.bounds.height - readingTop - bottomInset))
        var lines: [CGFloat] = []
        textView.layoutManager.enumerateLineFragments(forGlyphRange: NSRange(location: 0, length: textView.layoutManager.numberOfGlyphs)) { _, used, _, glyphs, _ in
            guard glyphs.length > 0, used.height > 0 else { return }
            lines.append(used.minY + textView.textContainerInset.top - readingTop)
        }
        var result = [minimum], lineIndex = 0
        while let current = result.last, current < maximum - 0.5 {
            let limit = min(maximum, current + height)
            var next: CGFloat?
            while lineIndex < lines.count && lines[lineIndex] <= limit {
                if lines[lineIndex] > current + 0.5 { next = lines[lineIndex] }
                lineIndex += 1
            }
            // The final screen clamps to the actual bottom. An attachment taller
            // than a screen is traversed in screen-sized slices, never omitted.
            let destination = limit >= maximum - 0.5 ? maximum : (next ?? limit)
            guard destination > current + 0.5 else { break }
            result.append(destination)
            // A line considered beyond the chosen start can still be the next
            // screen's start when a long attachment spans several viewports.
            while lineIndex > 0 && lines[lineIndex - 1] > destination + 0.5 { lineIndex -= 1 }
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
        if let text = view as? UITextView, text.attributedText.length > 0 {
            let point = touch.location(in: text)
            let containerPoint = CGPoint(x: point.x - text.textContainerInset.left, y: point.y - text.textContainerInset.top)
            let index = text.layoutManager.characterIndex(for: containerPoint, in: text.textContainer, fractionOfDistanceBetweenInsertionPoints: nil)
            if index < text.attributedText.length, text.attributedText.attribute(.link, at: index, effectiveRange: nil) != nil {
                let glyphs = text.layoutManager.glyphRange(forCharacterRange: NSRange(location: index, length: 1), actualCharacterRange: nil)
                if text.layoutManager.boundingRect(forGlyphRange: glyphs, in: text.textContainer).contains(containerPoint) { return false }
            }
        }
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
