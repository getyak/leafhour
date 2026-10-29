import SwiftUI
import UIKit

/// UIKit grows a sheet when the keyboard appears. Reserve the typing controls,
/// while subtracting that growth from the companion's ordinary half-screen size.
struct CompanionSheetGeometry: Equatable {
    let windowSize: CGSize
    let bottomSafeArea: CGFloat
    let keyboardFrame: CGRect

    var keyboardOverlap: CGFloat {
        let bounds = CGRect(origin: .zero, size: windowSize)
        let overlap = bounds.intersection(keyboardFrame)
        guard !overlap.isNull, overlap.height > 0,
              keyboardFrame.maxY >= bounds.maxY - 1,
              overlap.width >= bounds.width * 0.75 else { return 0 }
        return max(0, bounds.maxY - overlap.minY)
    }

    func detentHeight(minimumContentHeight: CGFloat) -> CGFloat {
        let resting = max(1, windowSize.height * 0.5 - max(0, bottomSafeArea))
        guard keyboardOverlap > 0 else { return resting }
        return max(min(resting, minimumContentHeight), resting - keyboardOverlap)
    }
}

struct CompanionComposerHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

struct ReaderPanelPresentation: ViewModifier {
    let isCompanion: Bool
    let isNoteEditor: Bool

    @ViewBuilder func body(content: Content) -> some View {
        if isCompanion {
            content.modifier(CompanionKeyboardPresentation())
        } else {
            content
                .presentationDetents(isNoteEditor ? [.large] : [.medium, .large])
                .presentationDragIndicator(.visible)
                .presentationCompactAdaptation(.automatic)
                .presentationBackgroundInteraction(.enabled(upThrough: .medium))
        }
    }
}

private struct CompanionKeyboardPresentation: ViewModifier {
    @State private var geometry = CompanionSheetGeometry(windowSize: UIScreen.main.bounds.size, bottomSafeArea: 0, keyboardFrame: .null)
    @State private var composerHeight: CGFloat = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var detent: PresentationDetent {
        // The extra room accommodates navigation and the native drag affordance.
        .height(geometry.detentHeight(minimumContentHeight: max(176, composerHeight + 64)))
    }

    func body(content: Content) -> some View {
        content
            .background {
                CompanionKeyboardGeometryReader { value, duration in
                    guard geometry != value else { return }
                    withAnimation(reduceMotion || duration <= 0 ? nil : .easeOut(duration: duration)) { geometry = value }
                }.allowsHitTesting(false).accessibilityHidden(true)
            }
            .onPreferenceChange(CompanionComposerHeightKey.self) { height in
                if abs(composerHeight - height) > 0.5 { composerHeight = height }
            }
            .presentationDetents([detent])
            .presentationDragIndicator(.visible)
            .presentationContentInteraction(.scrolls)
            .presentationCompactAdaptation(.none)
            .presentationBackgroundInteraction(.enabled(upThrough: detent))
    }
}

private struct CompanionKeyboardGeometryReader: UIViewRepresentable {
    let onChange: (CompanionSheetGeometry, TimeInterval) -> Void
    func makeUIView(context: Context) -> CompanionKeyboardGeometryView {
        let view = CompanionKeyboardGeometryView()
        view.onChange = onChange
        return view
    }
    func updateUIView(_ view: CompanionKeyboardGeometryView, context: Context) { view.onChange = onChange; view.report() }
}

private final class CompanionKeyboardGeometryView: UIView {
    var onChange: ((CompanionSheetGeometry, TimeInterval) -> Void)?
    private var keyboardFrame = CGRect.null
    private var lastGeometry: CompanionSheetGeometry?
    private var observers: [NSObjectProtocol] = []

    init() {
        super.init(frame: .zero)
        backgroundColor = .clear
        for name in [UIResponder.keyboardWillChangeFrameNotification, UIResponder.keyboardWillHideNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] notification in
                MainActor.assumeIsolated {
                    guard let self else { return }
                    self.keyboardFrame = name == UIResponder.keyboardWillHideNotification ? .null : (notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue ?? .null
                    let duration = (notification.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? NSNumber)?.doubleValue ?? 0
                    self.report(duration: duration)
                }
            })
        }
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    deinit { observers.forEach { NotificationCenter.default.removeObserver($0) } }
    override func didMoveToWindow() { super.didMoveToWindow(); report() }
    override func layoutSubviews() { super.layoutSubviews(); report() }

    func report(duration: TimeInterval = 0) {
        guard let window, window.bounds.height > 0 else { return }
        let frame = keyboardFrame.isNull ? CGRect.null : window.convert(keyboardFrame, from: window.screen.coordinateSpace)
        let value = CompanionSheetGeometry(windowSize: window.bounds.size, bottomSafeArea: window.safeAreaInsets.bottom, keyboardFrame: frame)
        guard value != lastGeometry else { return }
        lastGeometry = value
        DispatchQueue.main.async { [weak self] in self?.onChange?(value, duration) }
    }
}
