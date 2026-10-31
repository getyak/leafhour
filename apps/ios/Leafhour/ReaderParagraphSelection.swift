import UIKit

/// Native edit menu for a programmatically expanded native selection. Suggested
/// editing commands still come from UIKit's responder chain.
@MainActor final class ReaderParagraphEditMenu: NSObject, UIEditMenuInteractionDelegate {
    private weak var view: UIView?
    private let makeMenu: ([UIMenuElement]) -> UIMenu?
    private let target: () -> CGRect
    private var interaction: UIEditMenuInteraction?
    init(view: UIView, makeMenu: @escaping ([UIMenuElement]) -> UIMenu?, target: @escaping () -> CGRect) {
        self.view = view; self.makeMenu = makeMenu; self.target = target
        super.init()
        let interaction = UIEditMenuInteraction(delegate: self); self.interaction = interaction; view.addInteraction(interaction)
    }

    func present() {
        guard let view, view.window != nil else { return }
        view.becomeFirstResponder()
        let rect = target()
        interaction?.presentEditMenu(with: UIEditMenuConfiguration(identifier: nil, sourcePoint: CGPoint(x: rect.midX, y: rect.midY)))
    }
    func invalidate() {
        interaction?.dismissMenu()
        if let interaction { view?.removeInteraction(interaction) }
        interaction = nil
    }
    func editMenuInteraction(_ interaction: UIEditMenuInteraction, menuFor configuration: UIEditMenuConfiguration, suggestedActions: [UIMenuElement]) -> UIMenu? { makeMenu(suggestedActions) }
    func editMenuInteraction(_ interaction: UIEditMenuInteraction, targetRectFor configuration: UIEditMenuConfiguration) -> CGRect { target() }
}

/// A passive touch lifetime: it never recognizes, delays, cancels or prevents a
/// system gesture. This keeps follow from moving text under a resting finger.
@MainActor private final class ReaderSelectionTouchObserver: UIGestureRecognizer {
    var began: ((UIEvent) -> Void)?
    var moved: ((UIEvent) -> Void)?
    var ended: (() -> Void)?
    var cancelled: (() -> Void)?
    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) { began?(event) }
    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) { moved?(event) }
    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        guard event.allTouches?.allSatisfy({ $0.phase == .ended || $0.phase == .cancelled }) != false else { return }
        ended?(); state = .failed
    }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) { cancelled?(); state = .failed }
    override func canPrevent(_ preventedGestureRecognizer: UIGestureRecognizer) -> Bool { false }
    override func canBePrevented(by preventingGestureRecognizer: UIGestureRecognizer) -> Bool { false }
}

/// Observe the system's held selection gestures without replacing their
/// delegates, timing, loupe, edit menu or handles. Tap/drag eligibility belongs
/// to touch-began, before UIKit creates its initial word selection.
@MainActor final class ReaderParagraphSelectionObserver: NSObject, UIGestureRecognizerDelegate {
    private final class WeakGesture { weak var value: UIGestureRecognizer?; init(_ value: UIGestureRecognizer) { self.value = value } }
    private weak var view: UIView?
    private let eligible: (CGPoint) -> Bool
    private let context: () -> String?
    private let selectionActive: () -> Bool
    private let expand: () -> Bool
    private let activity: (Bool) -> Void
    private let finalized: () -> Void
    private let initialSelection: ((CGPoint) -> Bool)?
    private var paragraphPress: UILongPressGestureRecognizer?
    private var pressContext: String?
    private weak var pressWindow: UIWindow?
    private var touchObserver: ReaderSelectionTouchObserver?
    private var gestures: [ObjectIdentifier: WeakGesture] = [:]
    private var touchID: ObjectIdentifier?
    private var beganAt: TimeInterval = 0
    private var beganClock: TimeInterval = 0
    private var movedAfterStart = false
    private var beganPoint = CGPoint.zero
    private var initialContext: String?
    private var allowed = false
    private var consumed = false
    private var pending = false
    private var generation = UUID()
    private weak var candidate: UIGestureRecognizer?
    private(set) var isTouchActive = false

    init(view: UIView, eligible: @escaping (CGPoint) -> Bool, context: @escaping () -> String?, selectionActive: @escaping () -> Bool, expand: @escaping () -> Bool, activity: @escaping (Bool) -> Void = { _ in }, finalized: @escaping () -> Void = {}, initialSelection: ((CGPoint) -> Bool)? = nil) {
        self.view = view; self.eligible = eligible; self.context = context; self.selectionActive = selectionActive; self.expand = expand; self.activity = activity
        self.finalized = finalized
        self.initialSelection = initialSelection
        super.init()
        let observer = ReaderSelectionTouchObserver(target: nil, action: nil)
        observer.cancelsTouchesInView = false; observer.delaysTouchesBegan = false; observer.delaysTouchesEnded = false
        observer.began = { [weak self, weak view] event in
            guard let self, let view, let touch = event.allTouches?.first else { return }
            self.isTouchActive = true; self.activity(true)
            guard event.allTouches?.count == 1 else { self.cancel(); return }
            self.touchBegan(event, at: touch.location(in: view))
        }
        observer.moved = { [weak self, weak view] event in
            guard let self, let view, let touch = event.allTouches?.first else { return }
            let point = touch.location(in: view.window)
            if hypot(point.x - self.beganPoint.x, point.y - self.beganPoint.y) > 10 { self.movedAfterStart = true }
        }
        observer.ended = { [weak self] in
            guard let self else { return }
            self.isTouchActive = false; self.activity(false); let marker = self.generation
            if self.paragraphPress != nil { return }
            let held = ProcessInfo.processInfo.systemUptime - self.beganClock >= 0.3
            // UIKit can restore its initial word at lift even after accepting
            // our paragraph range. Commit once after native end handlers finish.
            DispatchQueue.main.async { [weak self] in
                DispatchQueue.main.async { [weak self] in
                    guard let self, self.generation == marker else { return }
                    if self.allowed, held, !self.movedAfterStart, self.initialContext == self.context(), self.selectionActive() {
                        self.consumed = true
                        let expanded = self.expand()
                        if expanded { self.finalized() }
                    }
                    self.allowed = false
                }
            }
        }
        observer.cancelled = { [weak self] in self?.isTouchActive = false; self?.activity(false); self?.cancel() }
        touchObserver = observer; view.addGestureRecognizer(observer)
        if initialSelection != nil {
            let press = UILongPressGestureRecognizer(target: self, action: #selector(paragraphPressed(_:)))
            press.minimumPressDuration = 0.35; press.allowableMovement = 10; press.cancelsTouchesInView = false
            press.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
            press.delegate = self; paragraphPress = press; view.addGestureRecognizer(press)
        }
    }

    func install() {
        guard paragraphPress == nil else { return }
        guard let view else { return }
        func collect(_ view: UIView) -> [UIGestureRecognizer] {
            (view.gestureRecognizers ?? []) + view.interactions.compactMap { $0 as? UITextInteraction }.flatMap(\.gesturesForFailureRequirements) + view.subviews.flatMap(collect)
        }
        for gesture in collect(view) where !(gesture is UITapGestureRecognizer) && gesture !== touchObserver {
            let id = ObjectIdentifier(gesture)
            guard gestures[id]?.value == nil else { continue }
            gestures[id] = WeakGesture(gesture); gesture.addTarget(self, action: #selector(observed(_:)))
        }
        gestures = gestures.filter { $0.value.value != nil }
    }
    func touchBegan(_ event: UIEvent?, at point: CGPoint) {
        guard let view, let touches = event?.allTouches, touches.count == 1, let touch = touches.first, touch.phase == .began else { return }
        let id = ObjectIdentifier(touch)
        guard touchID != id || beganAt != touch.timestamp else { return }
        touchID = id; beganAt = touch.timestamp; beganClock = ProcessInfo.processInfo.systemUptime
        movedAfterStart = false; beganPoint = touch.location(in: view.window)
        activity(true)
        generation = UUID(); consumed = false; pending = false; candidate = nil
        initialContext = context()
        allowed = touch.type == .direct && !UIAccessibility.isVoiceOverRunning && initialContext != nil && eligible(point)
        install()
    }
    @objc private func observed(_ gesture: UIGestureRecognizer) {
        guard allowed, !consumed, let view else { return }
        if gesture.state == .cancelled, candidate === gesture { cancel(); return }
        guard gesture.state == .began || gesture.state == .changed || gesture.state == .ended,
              ProcessInfo.processInfo.systemUptime - beganAt >= 0.3 else { return }
        let point = gesture.location(in: view.window)
        guard hypot(point.x - beganPoint.x, point.y - beganPoint.y) <= 10 else { return }
        candidate = gesture; selectionChanged()
    }
    func selectionChanged() {
        guard paragraphPress == nil else { return }
        guard allowed, !consumed, !pending, let candidate,
              candidate.state == .began || candidate.state == .changed || candidate.state == .ended else { return }
        pending = true; let marker = generation
        DispatchQueue.main.async { [weak self] in
            guard let self, self.generation == marker else { return }
            self.pending = false
            guard self.allowed, !self.consumed, self.initialContext == self.context(), self.selectionActive(),
                  self.candidate?.state != .cancelled, self.candidate?.state != .failed else { return }
            self.consumed = true
            let expanded = self.expand()
            if !expanded { self.consumed = false }
        }
    }
    func cancel() { generation = UUID(); allowed = false; pending = false; candidate = nil }
    func invalidate() {
        cancel(); isTouchActive = false; activity(false)
        for gesture in gestures.values { gesture.value?.removeTarget(self, action: #selector(observed(_:))) }
        gestures = [:]
        if let touchObserver { view?.removeGestureRecognizer(touchObserver) }; touchObserver = nil
        if let paragraphPress { paragraphPress.isEnabled = false; view?.removeGestureRecognizer(paragraphPress) }; paragraphPress = nil
    }
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        guard gestureRecognizer === paragraphPress, let view, !UIAccessibility.isVoiceOverRunning,
              touch.type == .direct, eligible(touch.location(in: view)), let current = context() else { return false }
        pressContext = current; pressWindow = view.window
        return true
    }
    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        guard let view else { return false }
        return pressWindow === view.window && pressContext == context() && eligible(gestureRecognizer.location(in: view))
    }
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldBeRequiredToFailBy other: UIGestureRecognizer) -> Bool {
        guard gestureRecognizer === paragraphPress, other !== gestureRecognizer, other !== touchObserver,
              !(other is UITapGestureRecognizer), !(other is UIPanGestureRecognizer), !(other is UIPinchGestureRecognizer),
              !(other is UIRotationGestureRecognizer), !(other is UIHoverGestureRecognizer),
              let view, let owner = other.view else { return false }
        return owner === view || owner.isDescendant(of: view)
    }
    @objc private func paragraphPressed(_ press: UILongPressGestureRecognizer) {
        guard let view, pressWindow === view.window else { return }
        switch press.state {
        case .began:
            consumed = initialSelection?(press.location(in: view)) == true
            if consumed { pressContext = context(); finalized() }
        case .ended:
            break
        default: break
        }
    }
    static func pdfParagraph(in text: String, containing selection: NSRange) -> NSRange? {
        let source = text as NSString
        guard selection.location >= 0, selection.length > 0, selection.location <= source.length - selection.length else { return nil }
        let previous = source.range(of: "\n\n", options: .backwards, range: NSRange(location: 0, length: selection.location))
        let end = NSMaxRange(selection)
        let next = source.range(of: "\n\n", range: NSRange(location: end, length: source.length - end))
        var range: NSRange
        if previous.location != NSNotFound || next.location != NSNotFound {
            let start = previous.location == NSNotFound ? 0 : NSMaxRange(previous)
            let finish = next.location == NSNotFound ? source.length : next.location
            range = NSRange(location: start, length: finish - start)
        } else { range = source.paragraphRange(for: selection) }
        while range.length > 0 && [10, 13].contains(source.character(at: NSMaxRange(range) - 1)) { range.length -= 1 }
        return range.length > 0 ? range : nil
    }
}
