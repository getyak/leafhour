import UIKit
import PDFKit

/// A short page tap discloses reader controls without taking ownership of native selection.
@MainActor final class ReaderEdgeTapHandler: NSObject, UIGestureRecognizerDelegate {
    private weak var view: UIView?
    private let blocked: () -> Bool
    private let onWake: (ReaderChrome) -> Void
    private(set) var recognizer: UITapGestureRecognizer!
    init(view: UIView, blocked: @escaping () -> Bool, onWake: @escaping (ReaderChrome) -> Void) {
        self.view = view; self.blocked = blocked; self.onWake = onWake
        super.init()
        let tap = UITapGestureRecognizer(target: self, action: #selector(activate(_:)))
        recognizer = tap
        tap.cancelsTouchesInView = false
        tap.delegate = self
        view.addGestureRecognizer(tap)
        // Let the system finish recognizing word/paragraph selection first.
        for other in view.gestureRecognizers ?? [] {
            if let native = other as? UITapGestureRecognizer, native !== tap, native.numberOfTapsRequired > 1 {
                tap.require(toFail: native)
            }
        }
    }
    func destination(at point: CGPoint) -> ReaderChrome? {
        guard !blocked(), let view, view.bounds.contains(point), !Self.isLink(at: point, in: view) else { return nil }
        if let scroll = view as? UIScrollView, scroll.isDragging || scroll.isDecelerating { return nil }
        if point.y < view.bounds.minY + 44 { return .top }
        if point.y > view.bounds.maxY - 44 { return .progress }
        return .tools
    }
    static func isLink(at point: CGPoint, in view: UIView) -> Bool {
        if let text = view as? ReflowTextView, let body = text.visibleReadingRect, !body.contains(point) { return false }
        if let text = view as? UITextView, text.attributedText.length > 0 {
            let local = CGPoint(x: point.x - text.textContainerInset.left, y: point.y - text.textContainerInset.top)
            var fraction: CGFloat = 0
            let glyph = text.layoutManager.glyphIndex(for: local, in: text.textContainer, fractionOfDistanceThroughGlyph: &fraction)
            guard glyph < text.layoutManager.numberOfGlyphs else { return false }
            let rect = text.layoutManager.boundingRect(forGlyphRange: NSRange(location: glyph, length: 1), in: text.textContainer)
            guard rect.contains(local) else { return false }
            let index = text.layoutManager.characterIndexForGlyph(at: glyph)
            return text.attributedText.attribute(.link, at: index, effectiveRange: nil) != nil
        }
        if let pdf = view as? PDFView, let page = pdf.page(for: point, nearest: false) {
            let local = pdf.convert(point, to: page)
            return page.annotations.contains { $0.bounds.contains(local) && ($0.action != nil || $0.url != nil) }
        }
        return false
    }
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        guard !(touch.view is UIControl), touch.type == .direct || touch.type == .indirectPointer else { return false }
        return destination(at: touch.location(in: view)) != nil
    }
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool { true }
    @objc private func activate(_ tap: UITapGestureRecognizer) {
        guard tap.state == .ended, let destination = destination(at: tap.location(in: view)) else { return }
        onWake(destination)
    }
}
