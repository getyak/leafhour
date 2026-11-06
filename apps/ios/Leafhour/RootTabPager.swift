import SwiftUI
import UIKit

private struct RootNavigationDepthKey: EnvironmentKey {
    static let defaultValue: (Bool) -> Void = { _ in }
}
extension EnvironmentValues {
    var rootNavigationDepthChanged: (Bool) -> Void {
        get { self[RootNavigationDepthKey.self] }
        set { self[RootNavigationDepthKey.self] = newValue }
    }
}

/// UIKit owns drag tracking, directional arbitration, release velocity and edge resistance.
/// Only the pager's horizontal scroll is disabled in a pushed navigation destination.
struct RootTabPager: UIViewControllerRepresentable {
    @Binding var selection: Int
    let pages: [AnyView]
    let canSwipe: Bool
    let reduceMotion: Bool

    func makeCoordinator() -> Coordinator { Coordinator(selection: $selection) }
    func makeUIViewController(context: Context) -> RootTabContainerController {
        let pager = UIPageViewController(transitionStyle: .scroll, navigationOrientation: .horizontal,
                                        options: [.interPageSpacing: 0])
        context.coordinator.hosts = pages.map { UIHostingController(rootView: $0) }
        context.coordinator.hosts.forEach {
            $0.view.backgroundColor = .clear
            // The native root owns keyboard geometry once; separately hosted pages keep container insets only.
            $0.safeAreaRegions = .container
        }
        pager.dataSource = context.coordinator
        pager.delegate = context.coordinator
        pager.setViewControllers([context.coordinator.hosts[selection]], direction: .forward, animated: false)
        let container = RootTabContainerController(pager: pager)
        container.tabBar.delegate = context.coordinator
        return container
    }
    func updateUIViewController(_ container: RootTabContainerController, context: Context) {
        let pager = container.pager
        container.tabBar.selectedItem = container.tabBar.items?[selection]
        let coordinator = context.coordinator
        coordinator.selection = $selection
        for (index, page) in pages.enumerated() { coordinator.hosts[index].rootView = page }
        // Do not alter child ScrollViews: their text selection and vertical bounce stay native.
        pager.view.subviews.compactMap { $0 as? UIScrollView }.forEach {
            $0.isScrollEnabled = canSwipe; $0.isDirectionalLockEnabled = true
            $0.bounces = !reduceMotion
        }
        if coordinator.transitioning {
            if selection != coordinator.transitionStartSelection { coordinator.pendingSelection = selection }
            return
        }
        guard let visible = pager.viewControllers?.first,
              let index = coordinator.hosts.firstIndex(where: { $0 === visible }), index != selection else { return }
        coordinator.transitioning = true
        coordinator.transitionStartSelection = selection
        pager.setViewControllers([coordinator.hosts[selection]], direction: selection > index ? .forward : .reverse,
                                 animated: !reduceMotion) { _ in
            coordinator.transitioning = false
            // A second tab tap can arrive during the spring. Reconcile to the latest intent.
            let target = coordinator.selection.wrappedValue
            if let shown = pager.viewControllers?.first, shown !== coordinator.hosts[target] {
                pager.setViewControllers([coordinator.hosts[target]], direction: .forward, animated: false)
            }
        }
    }
    final class Coordinator: NSObject, UIPageViewControllerDataSource, UIPageViewControllerDelegate, UITabBarDelegate {
        var selection: Binding<Int>
        var hosts: [UIHostingController<AnyView>] = []
        var transitioning = false
        var transitionStartSelection = 0
        var pendingSelection: Int?
        init(selection: Binding<Int>) { self.selection = selection }
        func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) { selection.wrappedValue = item.tag }
        func pageViewController(_ pageViewController: UIPageViewController, viewControllerBefore viewController: UIViewController) -> UIViewController? {
            guard let index = hosts.firstIndex(where: { $0 === viewController }), index > 0 else { return nil }
            return hosts[index - 1]
        }
        func pageViewController(_ pageViewController: UIPageViewController, viewControllerAfter viewController: UIViewController) -> UIViewController? {
            guard let index = hosts.firstIndex(where: { $0 === viewController }), index + 1 < hosts.count else { return nil }
            return hosts[index + 1]
        }
        func pageViewController(_ pageViewController: UIPageViewController, willTransitionTo pendingViewControllers: [UIViewController]) {
            transitioning = true; transitionStartSelection = selection.wrappedValue; pendingSelection = nil
        }
        func pageViewController(_ pageViewController: UIPageViewController, didFinishAnimating finished: Bool,
                                previousViewControllers: [UIViewController], transitionCompleted completed: Bool) {
            transitioning = false
            if let pending = pendingSelection {
                pendingSelection = nil
                pageViewController.setViewControllers([hosts[pending]], direction: .forward, animated: false)
                selection.wrappedValue = pending
                return
            }
            if completed, let shown = pageViewController.viewControllers?.first,
               let index = hosts.firstIndex(where: { $0 === shown }) { selection.wrappedValue = index }
        }
    }
}

/// UIKit computes the real tab-bar height and gives every hosted page a physical viewport above it.
/// SwiftUI safeAreaInset alone cannot communicate its reservation across separately hosted pages.
final class RootTabContainerController: UIViewController {
    let pager: UIPageViewController
    let tabBar = UITabBar()
    private var barHeight: NSLayoutConstraint!
    private var keyboardLimit: NSLayoutConstraint!
    private var keyboardFrameInScreen: CGRect?
    private var keyboardObservers: [NSObjectProtocol] = []

    init(pager: UIPageViewController) { self.pager = pager; super.init(nibName: nil, bundle: nil) }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(Color.shelfPaper)
        addChild(pager)
        pager.view.translatesAutoresizingMaskIntoConstraints = false
        tabBar.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(pager.view); view.addSubview(tabBar)
        tabBar.items = [("书房", "books.vertical"), ("松鼠 AI", "leaf"), ("我的阅读", "book")].enumerated().map { index, item in
            let tab = UITabBarItem(title: item.0, image: UIImage(systemName: item.1), tag: index)
            tab.accessibilityIdentifier = index == 1 ? "library-companion" : "root-tab-\(index)"
            return tab
        }
        tabBar.tintColor = UIColor(Color.leafInk)
        let appearance = UITabBarAppearance(); appearance.configureWithDefaultBackground()
        tabBar.standardAppearance = appearance; tabBar.scrollEdgeAppearance = appearance
        // Fitting is repeated after the bar enters its real window and receives its bottom safe area.
        barHeight = tabBar.heightAnchor.constraint(equalToConstant: tabBar.sizeThatFits(view.bounds.size).height)
        // Prefer the tab edge when the keyboard is hidden. A keyboard can lift only the page,
        // while the native bar stays in its normal viewport behind the system keyboard.
        let preferredPageBottom = pager.view.bottomAnchor.constraint(equalTo: tabBar.topAnchor)
        preferredPageBottom.priority = UILayoutPriority(999)
        keyboardLimit = pager.view.bottomAnchor.constraint(lessThanOrEqualTo: view.topAnchor, constant: view.bounds.height)
        NSLayoutConstraint.activate([
            pager.view.topAnchor.constraint(equalTo: view.topAnchor),
            pager.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            pager.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            preferredPageBottom, keyboardLimit,
            tabBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            tabBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            tabBar.bottomAnchor.constraint(equalTo: view.bottomAnchor), barHeight
        ])
        pager.didMove(toParent: self)
        installKeyboardObservation()
    }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        updateBarHeight()
        updateKeyboardLimit()
    }
    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        updateBarHeight()
    }
    private func installKeyboardObservation() {
        for name in [UIResponder.keyboardWillChangeFrameNotification, UIResponder.keyboardWillHideNotification] {
            keyboardObservers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] notification in
                MainActor.assumeIsolated {
                    guard let self, self.view.window != nil else { return }
                    if let local = notification.userInfo?[UIResponder.keyboardIsLocalUserInfoKey] as? Bool, !local { return }
                    let ownsFocus = Self.containsFirstResponder(self.view)
                    guard ownsFocus || self.keyboardFrameInScreen != nil else { return }
                    let hiding = notification.name == UIResponder.keyboardWillHideNotification || !ownsFocus
                    let frame = hiding ? nil : (notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue
                    self.updateKeyboardOcclusion(frame)
                    let duration = (notification.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? NSNumber)?.doubleValue ?? 0
                    let curve = (notification.userInfo?[UIResponder.keyboardAnimationCurveUserInfoKey] as? NSNumber)?.uintValue ?? 0
                    UIView.animate(withDuration: duration, delay: 0,
                                   options: [UIView.AnimationOptions(rawValue: curve << 16), .beginFromCurrentState, .allowUserInteraction]) {
                        self.view.layoutIfNeeded()
                    }
                }
            })
        }
    }
    private static func containsFirstResponder(_ view: UIView) -> Bool {
        view.isFirstResponder || view.subviews.contains(where: containsFirstResponder)
    }
    /// Actual notifications supply screen coordinates. Retain them so rotation/window changes can reconvert.
    func updateKeyboardOcclusion(_ frameInScreen: CGRect?) {
        keyboardFrameInScreen = frameInScreen
        updateKeyboardLimit()
    }
    private func updateKeyboardLimit() {
        guard isViewLoaded, let keyboardLimit else { return }
        var frame: CGRect?
        if let keyboardFrameInScreen, let window = view.window {
            let inWindow = window.convert(keyboardFrameInScreen, from: window.screen.coordinateSpace)
            frame = view.convert(inWindow, from: window)
        }
        keyboardLimit.constant = Self.availablePageHeight(bounds: view.bounds, keyboardFrame: frame)
    }
    static func availablePageHeight(bounds: CGRect, keyboardFrame: CGRect?) -> CGFloat {
        guard let keyboardFrame, !keyboardFrame.isNull, !keyboardFrame.isInfinite,
              keyboardFrame.width > 0, keyboardFrame.height > 0 else { return max(0, bounds.height) }
        let overlap = bounds.intersection(keyboardFrame)
        guard !overlap.isNull, overlap.width > 0, overlap.height > 0 else { return max(0, bounds.height) }
        return max(0, min(bounds.height, overlap.minY - bounds.minY))
    }
    deinit { keyboardObservers.forEach(NotificationCenter.default.removeObserver) }

    private func updateBarHeight() {
        guard isViewLoaded, let barHeight, view.bounds.width > 0 else { return }
        let height = ceil(tabBar.sizeThatFits(CGSize(width: view.bounds.width, height: .greatestFiniteMagnitude)).height)
        if height > 0, abs(barHeight.constant - height) > 0.5 { barHeight.constant = height }
    }
}
