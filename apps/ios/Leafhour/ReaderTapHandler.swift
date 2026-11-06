import UIKit
import PDFKit
import LeafhourCore

/// Recognize each short contact independently, including the second contact of
/// a rapid double tap. UITapGestureRecognizer can group those contacts together.
@MainActor final class ReaderShortTapGestureRecognizer: UIGestureRecognizer {
    private var activeTouch: ObjectIdentifier?
    private var beganTimestamp: TimeInterval?
    private var beganPoint = CGPoint.zero
    private var completedDuration: TimeInterval?
    var isShortTap: Bool { completedDuration.map { $0 <= 0.35 } ?? false }

    func rejectsAdditionalContact(_ touch: UITouch) -> Bool {
        guard let activeTouch, activeTouch != ObjectIdentifier(touch) else { return false }
        state = .failed; return true
    }
    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        guard activeTouch == nil, event.allTouches?.count == 1, touches.count == 1, let touch = touches.first else { state = .failed; return }
        activeTouch = ObjectIdentifier(touch); beganTimestamp = touch.timestamp
        beganPoint = touch.location(in: view?.window); completedDuration = nil
    }
    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
        guard event.allTouches?.count == 1, let touch = touches.first else { state = .failed; return }
        let point = touch.location(in: view?.window)
        if hypot(point.x - beganPoint.x, point.y - beganPoint.y) > 10 { state = .failed }
    }
    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        guard event.allTouches?.count == 1, touches.count == 1, let touch = touches.first, activeTouch == ObjectIdentifier(touch), let beganTimestamp else { state = .failed; return }
        let duration = touch.timestamp - beganTimestamp, point = touch.location(in: view?.window)
        guard duration.isFinite, (0...0.35).contains(duration), hypot(point.x - beganPoint.x, point.y - beganPoint.y) <= 10 else { state = .failed; return }
        completedDuration = duration; state = .ended
    }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) { completedDuration = nil; state = .cancelled }
    override func reset() { activeTouch = nil; beganTimestamp = nil; completedDuration = nil; super.reset() }
    override func canPrevent(_ other: UIGestureRecognizer) -> Bool { false }
    override func canBePrevented(by other: UIGestureRecognizer) -> Bool { false }
}

/// Observe raw contacts without entering a terminal recognition state between
/// rapid taps. UIKit may defer resetting a recognized discrete gesture until
/// after the next contact has already arrived.
@MainActor final class ReaderShortContactObserver: UIGestureRecognizer {
    var onShortContact: ((CGPoint) -> Void)?
    private var activeTouch: ObjectIdentifier?
    private var beganTimestamp: TimeInterval?
    private var beganPoint = CGPoint.zero
    private var rejected = false

    func rejectsAdditionalContact(_ touch: UITouch) -> Bool {
        guard let activeTouch, activeTouch != ObjectIdentifier(touch) else { return false }
        rejected = true; return true
    }
    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        guard activeTouch == nil, event.allTouches?.count == 1, touches.count == 1, let touch = touches.first else { rejected = true; return }
        activeTouch = ObjectIdentifier(touch); beganTimestamp = touch.timestamp
        beganPoint = touch.location(in: view?.window); rejected = false
    }
    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
        guard event.allTouches?.count == 1, let touch = touches.first,
              activeTouch == ObjectIdentifier(touch) else { rejected = true; return }
        let point = touch.location(in: view?.window)
        if hypot(point.x - beganPoint.x, point.y - beganPoint.y) > 10 { rejected = true }
    }
    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        guard let touch = touches.first, activeTouch == ObjectIdentifier(touch) else { return }
        let duration = beganTimestamp.map { touch.timestamp - $0 }
        let point = touch.location(in: view?.window)
        let accepts = !rejected && event.allTouches?.count == 1 && touches.count == 1
            && duration.map { $0.isFinite && (0...0.35).contains($0) } == true
            && hypot(point.x - beganPoint.x, point.y - beganPoint.y) <= 10
        let local = touch.location(in: view)
        clearContact()
        if accepts { onShortContact?(local) }
    }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) { clearContact() }
    private func clearContact() { activeTouch = nil; beganTimestamp = nil; rejected = false }
    override func reset() { clearContact(); super.reset() }
    override func canPrevent(_ other: UIGestureRecognizer) -> Bool { false }
    override func canBePrevented(by other: UIGestureRecognizer) -> Bool { false }
}

enum ReaderTapAction: Equatable {
    case wake(ReaderChrome)
    case turn(ReaderPageDirection)
    case dismissSelection
}
struct ReaderTapContext: Equatable {
    let owner: ObjectIdentifier
    let navigation: UUID
    let preferences: ReaderPreferences
    var size: CGSize = .zero
}

/// Short taps turn independently; native held selection keeps its handles/menu.
@MainActor final class ReaderEdgeTapHandler: NSObject, UIGestureRecognizerDelegate {
    private weak var view: UIView?
    private let blocked: () -> Bool
    private let onWake: (ReaderChrome) -> Void
    private let isPaged: () -> Bool
    private let isScrolling: () -> Bool
    private let hasSelection: () -> Bool
    private let onDismissSelection: () -> Void
    private let onTurn: (ReaderPageDirection) -> Void
    private let delay: () -> TimeInterval
    private let context: () -> ReaderTapContext?
    private final class PendingTap {
        let action: ReaderTapAction
        let delay: TimeInterval
        var ready = false
        var context: ReaderTapContext?
        var task: Task<Void, Never>?
        init(action: ReaderTapAction, delay: TimeInterval, context: ReaderTapContext?) {
            self.action = action; self.delay = delay; self.context = context
        }
    }
    private var pending: [PendingTap] = []
    private var touching = false
    private var dismissSelectionOnContact = false
    private var contactContext: ReaderTapContext?
    private var observers: [NSObjectProtocol] = []
    private final class DisabledTap {
        weak var value: UITapGestureRecognizer?
        init(_ value: UITapGestureRecognizer) { self.value = value }
    }
    private var disabledTaps: [ObjectIdentifier: DisabledTap] = [:]
    private(set) var recognizer: UIGestureRecognizer!
    init(view: UIView, blocked: @escaping () -> Bool, onWake: @escaping (ReaderChrome) -> Void,
         isPaged: @escaping () -> Bool = { false }, isScrolling: @escaping () -> Bool = { false },
         hasSelection: @escaping () -> Bool = { false }, onDismissSelection: @escaping () -> Void = {},
         onTurn: @escaping (ReaderPageDirection) -> Void = { _ in },
         delay: @escaping () -> TimeInterval = { 0 }, context: @escaping () -> ReaderTapContext? = { nil }) {
        self.view = view; self.blocked = blocked; self.onWake = onWake
        self.isPaged = isPaged; self.onTurn = onTurn
        self.isScrolling = isScrolling; self.hasSelection = hasSelection; self.onDismissSelection = onDismissSelection
        self.delay = delay; self.context = context
        super.init()
        let tap = ReaderShortContactObserver(target: nil, action: nil)
        tap.onShortContact = { [weak self] point in self?.activate(at: point) }
        recognizer = tap
        tap.cancelsTouchesInView = false; tap.delaysTouchesBegan = false; tap.delaysTouchesEnded = false
        tap.delegate = self
        view.addGestureRecognizer(tap)
        refreshSelectionGestures()
        observers.append(NotificationCenter.default.addObserver(forName: UIAccessibility.voiceOverStatusDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.cancelPending(); self?.refreshSelectionGestures() }
        })
        observers.append(NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.cancelPending() }
        })
    }
    deinit { observers.forEach { NotificationCenter.default.removeObserver($0) } }
    func refreshSelectionGestures() {
        if UIAccessibility.isVoiceOverRunning {
            disabledTaps.values.forEach { $0.value?.isEnabled = true }; disabledTaps = [:]; return
        }
        guard let view else { return }
        func collect(_ node: UIView) -> [UIGestureRecognizer] {
            (node.gestureRecognizers ?? []) + node.interactions.compactMap { $0 as? UITextInteraction }.flatMap(\.gesturesForFailureRequirements) + node.subviews.flatMap(collect)
        }
        for tap in collect(view).compactMap({ $0 as? UITapGestureRecognizer }) where tap !== recognizer && tap.numberOfTapsRequired > 1 && tap.isEnabled {
            disabledTaps[ObjectIdentifier(tap)] = DisabledTap(tap); tap.isEnabled = false
        }
        disabledTaps = disabledTaps.filter { $0.value.value != nil }
    }
    func cancelPending() { pending.forEach { $0.task?.cancel() }; pending = [] }
    func touchActivity(_ active: Bool) { touching = active; if !active { drainPendingTaps() } }
    func rebaseNavigation(from old: UUID, to new: UUID, owner: ObjectIdentifier) {
        for item in pending {
            if let context = item.context, context.owner == owner, context.navigation == old {
                item.context = ReaderTapContext(owner: owner, navigation: new, preferences: context.preferences, size: context.size)
            }
        }
    }
    func invalidate() {
        cancelPending(); observers.forEach { NotificationCenter.default.removeObserver($0) }; observers = []
        disabledTaps.values.forEach { $0.value?.isEnabled = true }; disabledTaps = [:]
        if let recognizer { view?.removeGestureRecognizer(recognizer) }; view = nil
    }
    func destination(at point: CGPoint) -> ReaderChrome? {
        guard !blocked(), let view, view.bounds.contains(point), !Self.isLink(at: point, in: view) else { return nil }
        if let scroll = view as? UIScrollView, scroll.isDragging || scroll.isDecelerating { return nil }
        if point.y < view.bounds.minY + 44 { return .top }
        if point.y > view.bounds.maxY - 44 { return .progress }
        return .tools
    }
    func action(at point: CGPoint) -> ReaderTapAction? {
        guard let destination = destination(at: point), let view else { return nil }
        if hasSelection() { return .dismissSelection }
        // Side gutters have one meaning along their full height. Previously
        // their top/bottom 44 points opened tools, making nearby taps disagree.
        if isPaged(), !UIAccessibility.isVoiceOverRunning {
            let x = (point.x - view.bounds.minX) / max(1, view.bounds.width)
            if x < 0.25 { return .turn(.previous) }
            if x > 0.75 { return .turn(.next) }
        } else if isScrolling(), !UIAccessibility.isVoiceOverRunning {
            let y = (point.y - view.bounds.minY) / max(1, view.bounds.height)
            if y < 0.25 { return .turn(.previous) }
            if y > 0.75 { return .turn(.next) }
        }
        return .wake(destination)
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
        refreshSelectionGestures()
        // Reject a second contact before filtering links/controls, so a pinch
        // cannot leave the first stationary finger eligible for a page turn.
        if (recognizer as? ReaderShortContactObserver)?.rejectsAdditionalContact(touch) == true { return false }
        guard !UIAccessibility.isVoiceOverRunning, touch.type == .direct || touch.type == .indirectPointer else { return false }
        var touched = touch.view
        while let current = touched, current !== view {
            if current is UIControl { return false }
            touched = current.superview
        }
        let accepts = action(at: touch.location(in: view)) != nil
        dismissSelectionOnContact = accepts && hasSelection()
        if accepts { contactContext = context() }
        return accepts
    }
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRequireFailureOf other: UIGestureRecognizer) -> Bool {
        // The contact's own duration/movement rules reject holds and drags.
        // Native long-press recognizers may themselves wait for a second tap,
        // so a failure dependency would reintroduce the same tap grouping delay.
        false
    }
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool { true }
    private func activate(at point: CGPoint) {
        guard view != nil, contactContext == context() else { return }
        if dismissSelectionOnContact {
            dismissSelectionOnContact = false; cancelPending(); onDismissSelection(); return
        }
        handleTap(at: point)
    }
    func handleTap(at point: CGPoint) {
        guard let action = action(at: point) else { return }
        let duration = ReaderPreferences.normalizedPageTapDelay(delay())
        guard case .turn = action, duration > 0 else {
            cancelPending()
            perform(action); return
        }
        let item = PendingTap(action: action, delay: duration, context: context())
        pending.append(item)
        item.task = Task { [weak self, weak item] in
            do { try await Task.sleep(for: .seconds(duration)) } catch { return }
            guard let self, let item, !Task.isCancelled else { return }
            item.ready = true; self.drainPendingTaps()
        }
    }
    private func drainPendingTaps() {
        guard !touching else { return }
        while let item = pending.first, item.ready {
            pending.removeFirst()
            guard view != nil, !blocked(), !hasSelection(), isPaged() || isScrolling(), context() == item.context, delay() == item.delay else {
                cancelPending(); return
            }
            perform(item.action)
        }
    }
    private func perform(_ action: ReaderTapAction) {
        switch action {
        case .dismissSelection: onDismissSelection()
        case .wake(let chrome): onWake(chrome)
        case .turn(let direction):
            let before = context(); onTurn(direction)
            if let before, let after = context(), before.owner == after.owner, before.preferences == after.preferences {
                rebaseNavigation(from: before.navigation, to: after.navigation, owner: before.owner)
            }
        }
    }
}
