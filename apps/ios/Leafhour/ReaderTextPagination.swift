import UIKit
import LeafhourCore

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
    private let prioritizesScrollViewPans: Bool
    private(set) var recognizer: UIPanGestureRecognizer!
    var isEnabled: Bool { get { recognizer.isEnabled } set { recognizer.isEnabled = newValue } }
    init(view: UIView, blocked: @escaping () -> Bool, onTurn: @escaping (ReaderPageDirection) -> Void, prioritizesScrollViewPans: Bool = false) {
        self.view = view; self.blocked = blocked; self.onTurn = onTurn
        self.prioritizesScrollViewPans = prioritizesScrollViewPans
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
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldBeRequiredToFailBy other: UIGestureRecognizer) -> Bool {
        guard prioritizesScrollViewPans, gestureRecognizer === recognizer, let view,
              let scroll = other.view as? UIScrollView, scroll === view || scroll.isDescendant(of: view) else { return false }
        // Framework-created scroll views may change after layout. A public
        // dynamic failure rule keeps their delegates and zoom behavior intact.
        return other === scroll.panGestureRecognizer
    }
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRequireFailureOf other: UIGestureRecognizer) -> Bool {
        guard prioritizesScrollViewPans, let view, let owner = other.view,
              owner === view || owner.isDescendant(of: view) else { return false }
        if let tap = other as? UITapGestureRecognizer { return tap.numberOfTapsRequired > 1 }
        return other is UILongPressGestureRecognizer
    }
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
        guard prioritizesScrollViewPans, let view, let owner = other.view,
              owner === view || owner.isDescendant(of: view) else { return false }
        return other is UIPinchGestureRecognizer
    }
    @objc private func handle(_ pan: UIPanGestureRecognizer) { complete(state: pan.state, translation: pan.translation(in: view)) }
    func complete(state: UIGestureRecognizer.State, translation: CGPoint) {
        guard state == .ended, recognizer.isEnabled, !blocked(), abs(translation.x) >= 40, abs(translation.x) > abs(translation.y) * 1.4 else { return }
        onTurn(translation.x < 0 ? .next : .previous)
    }
    func invalidate() { if let recognizer { view?.removeGestureRecognizer(recognizer) }; view = nil }
}

/// The one real native reader stays mounted. A synchronous opaque cover protects
/// asynchronous layout; only disposable snapshots move during the transition.
@MainActor final class ReaderPageCurlTransition {
    private var controller: UIPageViewController?
    private var cover: UIView?
    private var source: UIView?
    private var animator: UIViewPropertyAnimator?
    private var completion: ((Bool) -> Void)?
    private var generation = 0
    private var reduceMotionObserver: NSObjectProtocol?
    var isActive: Bool { cover != nil || controller != nil }

    init() {
        reduceMotionObserver = NotificationCenter.default.addObserver(forName: UIAccessibility.reduceMotionStatusDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                guard UIAccessibility.isReduceMotionEnabled, let self else { return }
                if let animator = self.animator { animator.stopAnimation(false); animator.finishAnimation(at: .end) }
                else if self.completion != nil { self.finish(true) }
                // A cover waiting for asynchronous restoration must stay in place.
            }
        }
    }
    deinit { if let reduceMotionObserver { NotificationCenter.default.removeObserver(reduceMotionObserver) } }

    func snapshot(from view: UIView) -> UIView? {
        guard view.window != nil, view.bounds.width > 0, view.bounds.height > 0 else { return nil }
        return view.snapshotView(afterScreenUpdates: false)
    }

    func protect(_ snapshot: UIView?, over view: UIView, paper: UIColor) {
        guard let snapshot, let container = view.superview else { return }
        cancel()
        let shield = UIView(frame: container.convert(view.bounds, from: view))
        shield.backgroundColor = paper; shield.isOpaque = true; shield.clipsToBounds = true
        shield.isUserInteractionEnabled = false; shield.accessibilityElementsHidden = true
        shield.accessibilityIdentifier = "reader-page-transition-cover"
        let page = UIView(frame: shield.bounds); page.backgroundColor = paper; page.isOpaque = true
        page.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        snapshot.frame = page.bounds; snapshot.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        page.addSubview(snapshot); shield.addSubview(page); container.addSubview(shield)
        cover = shield; source = page
    }

    func animate(from before: UIView?, over view: UIView, direction: ReaderPageDirection,
                 paper: UIColor, style: ReaderPageAnimation = .slide, completion: @escaping (Bool) -> Void) {
        if cover == nil { protect(before, over: view, paper: paper) }
        self.completion = completion
        guard let before, let cover, !UIAccessibility.isReduceMotionEnabled, style != .none,
              view.window != nil else { finish(true); return }
        generation += 1; let token = generation
        if style == .slide {
            guard let source else { finish(true); return }
            // Reveal the settled live page underneath one moving paper snapshot.
            // No second snapshot/afterScreenUpdates barrier or new controller is
            // needed on the normal turn path. The native hit-test surface stays put.
            view.layoutIfNeeded(); cover.backgroundColor = .clear; cover.isOpaque = false
            let distance = cover.bounds.width * (direction == .next ? 1 : -1)
            let motion = UIViewPropertyAnimator(duration: 0.20, curve: .easeOut) {
                source.transform = CGAffineTransform(translationX: -distance, y: 0)
            }
            animator = motion
            motion.addCompletion { [weak self] position in
                guard let self, self.generation == token else { return }
                self.finish(position == .end)
            }
            motion.startAnimation()
            return
        }
        guard let after = view.snapshotView(afterScreenUpdates: true) else { finish(true); return }
        guard let owner = Self.owner(of: view), let container = view.superview else { finish(true); return }
        let source = UIViewController(), destination = UIViewController()
        for (page, snapshot) in [(source, before), (destination, after)] {
            page.view.backgroundColor = paper
            page.view.frame = CGRect(origin: .zero, size: view.bounds.size)
            snapshot.frame = page.view.bounds; snapshot.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            page.view.addSubview(snapshot); page.view.accessibilityElementsHidden = true
        }
        let pager = UIPageViewController(transitionStyle: .pageCurl, navigationOrientation: .horizontal,
            options: [.spineLocation: UIPageViewController.SpineLocation.min.rawValue])
        pager.isDoubleSided = false; pager.view.backgroundColor = paper
        pager.view.isUserInteractionEnabled = false; pager.view.accessibilityElementsHidden = true
        pager.view.frame = container.convert(view.bounds, from: view)
        owner.addChild(pager); container.addSubview(pager.view); pager.didMove(toParent: owner)
        pager.setViewControllers([source], direction: .forward, animated: false)
        pager.view.layoutIfNeeded(); controller = pager
        pager.setViewControllers([destination], direction: direction == .next ? .forward : .reverse, animated: true) { [weak self] finished in
            guard let self, self.generation == token else { return }; self.finish(finished)
        }
    }

    func cancel() { generation += 1; animator?.stopAnimation(true); finish(false) }
    private func finish(_ completed: Bool) {
        let callback = completion; completion = nil; animator = nil
        let pager = controller; controller = nil
        pager?.willMove(toParent: nil); pager?.view.removeFromSuperview(); pager?.removeFromParent()
        cover?.removeFromSuperview(); cover = nil; source = nil
        callback?(completed)
    }
    private static func owner(of view: UIView) -> UIViewController? {
        var responder: UIResponder? = view
        while let current = responder {
            if let controller = current as? UIViewController { return controller }; responder = current.next
        }
        return nil
    }
}
