import UIKit
import LeafhourCore

struct ReaderBookmarkGestureCapture {
    let anchor: ReadingAnchor
    let context: String
    let presentation: ReaderBookmarkPresentation?
    init(anchor: ReadingAnchor, context: String, presentation: ReaderBookmarkPresentation? = nil) {
        self.anchor = anchor; self.context = context; self.presentation = presentation
    }
    var value: ReaderBookmarkCapture { ReaderBookmarkCapture(anchor: anchor, presentation: presentation) }
}

/// This observer never recognizes or changes UIKit's selection/scroll ownership.
@MainActor private final class ReaderBookmarkTouchObserver: UIGestureRecognizer {
    var onBegin: ((UITouch) -> Void)?
    var onCancel: (() -> Void)?
    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        guard touches.count == 1, event.allTouches?.count == 1, let touch = touches.first else { onCancel?(); return }
        onBegin?(touch)
    }
    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) { state = .failed }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) { onCancel?(); state = .failed }
    override func canPrevent(_ preventedGestureRecognizer: UIGestureRecognizer) -> Bool { false }
    override func canBePrevented(by preventingGestureRecognizer: UIGestureRecognizer) -> Bool { false }
}

/// Paged text has no native scroll pan. Continuous text/PDF only observes the
/// existing pan after a touch that began at the real document boundary.
@MainActor final class ReaderBookmarkGestureHandler: NSObject, UIGestureRecognizerDelegate {
    private weak var view: UIView?
    private weak var scroll: UIScrollView?
    private weak var touchWindow: UIWindow?
    private let blocked: () -> Bool
    private let isPaged: () -> Bool
    private let isTrueTop: (UIScrollView) -> Bool
    private let capture: () -> ReaderBookmarkGestureCapture?
    private let context: () -> String?
    private let readingRect: () -> CGRect
    private let onBookmark: (ReadingAnchor) -> Void
    private let onFeedback: (ReaderBookmarkPullVisual) -> Void
    private let onBookmarkCapture: ((ReaderBookmarkCapture) -> Void)?
    private let observer = ReaderBookmarkTouchObserver()
    private(set) var recognizer: UIPanGestureRecognizer!
    private var snapshot: ReaderBookmarkGestureCapture?
    private var pull = ReaderBookmarkPullState()
    private var feedback = ReaderBookmarkPullVisual.idle
    private let thresholdHaptic = UISelectionFeedbackGenerator()
    private var hapticSent = false
    private var enabled = true
    private var resignObserver: NSObjectProtocol?

    init(view: UIView, blocked: @escaping () -> Bool, isPaged: @escaping () -> Bool, isTrueTop: @escaping (UIScrollView) -> Bool,
         capture: @escaping () -> ReaderBookmarkGestureCapture?, context: @escaping () -> String?, readingRect: @escaping () -> CGRect,
         onBookmark: @escaping (ReadingAnchor) -> Void, onFeedback: @escaping (ReaderBookmarkPullVisual) -> Void, onBookmarkCapture: ((ReaderBookmarkCapture) -> Void)? = nil) {
        self.view = view; self.blocked = blocked; self.isPaged = isPaged; self.isTrueTop = isTrueTop
        self.capture = capture; self.context = context; self.readingRect = readingRect; self.onBookmark = onBookmark; self.onFeedback = onFeedback; self.onBookmarkCapture = onBookmarkCapture
        super.init()
        recognizer = UIPanGestureRecognizer(target: self, action: #selector(pagedPan(_:)))
        recognizer.minimumNumberOfTouches = 1; recognizer.maximumNumberOfTouches = 1
        recognizer.cancelsTouchesInView = false; recognizer.delegate = self
        view.addGestureRecognizer(recognizer)
        observer.cancelsTouchesInView = false; observer.delaysTouchesBegan = false; observer.delaysTouchesEnded = false
        observer.onBegin = { [weak self] touch in self?.began(touch) }
        observer.onCancel = { [weak self] in self?.cancel() }
        view.addGestureRecognizer(observer)
        resignObserver = NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in MainActor.assumeIsolated { self?.cancel() } }
    }
    deinit { if let resignObserver { NotificationCenter.default.removeObserver(resignObserver) } }
    func configure(enabled: Bool) {
        self.enabled = enabled
        let recognizesPagedPull = enabled && isPaged()
        if recognizer.isEnabled != recognizesPagedPull { recognizer.isEnabled = recognizesPagedPull }
        if !enabled || snapshot?.context != context() { cancel() }
    }
    func observe(scroll target: UIScrollView) {
        guard scroll !== target else { return }
        scroll?.panGestureRecognizer.removeTarget(self, action: #selector(scrollingPan(_:)))
        scroll = target
        target.panGestureRecognizer.addTarget(self, action: #selector(scrollingPan(_:)))
    }
    private func allowed(_ touch: UITouch) -> Bool {
        guard enabled, !blocked(), !UIAccessibility.isVoiceOverRunning, UIApplication.shared.applicationState == .active,
              touch.type == .direct, let view, view.window != nil, readingRect().contains(touch.location(in: view)),
              !ReaderEdgeTapHandler.isLink(at: touch.location(in: view), in: view) else { return false }
        var owner = touch.view
        while let current = owner, current !== view {
            if current is UIControl { return false }
            owner = current.superview
        }
        return true
    }
    private func began(_ touch: UITouch) {
        cancel()
        guard allowed(touch), isPaged() || (scroll.map(isTrueTop) == true), let snapshot = capture() else { return }
        self.snapshot = snapshot; touchWindow = view?.window; hapticSent = false
        pull.begin(eligible: true)
        thresholdHaptic.prepare()
    }
    private var isCurrent: Bool {
        enabled && !blocked() && !UIAccessibility.isVoiceOverRunning && UIApplication.shared.applicationState == .active
            && snapshot?.context == context() && snapshot != nil && touchWindow != nil && view?.window === touchWindow
    }
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool { allowed(touch) && isPaged() }
    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        guard isPaged(), isCurrent, let view else { return false }
        let velocity = recognizer.velocity(in: view)
        return velocity.y > 0 && velocity.y > abs(velocity.x) * 1.4
    }
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRequireFailureOf other: UIGestureRecognizer) -> Bool {
        guard gestureRecognizer === recognizer, other !== observer, let owner = other.view, let view,
              owner === view || owner.isDescendant(of: view) else { return false }
        return other is UILongPressGestureRecognizer || (other as? UITapGestureRecognizer).map { $0.numberOfTapsRequired > 1 } == true
    }
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldBeRequiredToFailBy other: UIGestureRecognizer) -> Bool {
        // PDFKit's fitted-page scroll pan yields only after this vertical pan
        // establishes its direction; zoomed pages never enable this recognizer.
        guard gestureRecognizer === recognizer, isPaged(), let scroll else { return false }
        return other === scroll.panGestureRecognizer
    }
    @objc private func pagedPan(_ pan: UIPanGestureRecognizer) {
        guard isPaged() else { return }
        let translation = pan.translation(in: view?.window)
        consume(state: pan.state, down: Double(translation.y), across: Double(translation.x))
    }
    @objc private func scrollingPan(_ pan: UIPanGestureRecognizer) {
        guard !isPaged(), let scroll, pan === scroll.panGestureRecognizer else { return }
        let overscroll = max(0, -scroll.adjustedContentInset.top - scroll.contentOffset.y)
        // UIScrollView applies rubber-band resistance. The observed overscroll
        // itself must reach 72pt, so an ordinary short bounce never commits.
        consume(state: pan.state, down: Double(overscroll), across: Double(pan.translation(in: scroll).x))
    }
    private func consume(state: UIGestureRecognizer.State, down: Double, across: Double) {
        guard isCurrent else { cancel(); return }
        switch state {
        case .began, .changed:
            let value = pull.change(down: down, across: across)
            if value == .armed, !hapticSent { hapticSent = true; thresholdHaptic.selectionChanged() }
            publish(pull.visual)
        case .ended:
            _ = pull.change(down: down, across: across)
            let value = snapshot?.value, committed = pull.end()
            cancel()
            if committed, let value {
                if let onBookmarkCapture { onBookmarkCapture(value) }
                else if value.presentation == nil { onBookmark(value.anchor) }
            }
        case .cancelled, .failed: cancel()
        default: break
        }
    }
    private func publish(_ value: ReaderBookmarkPullVisual) {
        // Continuous mode already rubber-bands in UIScrollView. Never move it twice.
        let value = isPaged() ? value : ReaderBookmarkPullVisual(feedback: value.feedback, progress: value.progress, displacement: 0)
        guard feedback != value else { return }
        feedback = value
        DispatchQueue.main.async { [weak self] in
            guard let self, self.feedback == value else { return }
            self.onFeedback(value)
        }
    }
    func cancel() { snapshot = nil; touchWindow = nil; pull.cancel(); publish(.idle) }
    func invalidate() {
        cancel(); enabled = false
        scroll?.panGestureRecognizer.removeTarget(self, action: #selector(scrollingPan(_:))); scroll = nil
        observer.onBegin = nil; observer.onCancel = nil
        view?.removeGestureRecognizer(observer); view?.removeGestureRecognizer(recognizer); view = nil
    }
}
