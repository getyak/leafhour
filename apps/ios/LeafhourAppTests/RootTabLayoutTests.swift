import XCTest
import UIKit
@testable import Leafhour

@MainActor final class RootTabLayoutTests: XCTestCase {
    func testHostedPageEndsAboveTheNativeMeasuredTabBar() throws {
        for size in [CGSize(width: 402, height: 874), CGSize(width: 874, height: 402)] {
            let pager = UIPageViewController(transitionStyle: .scroll, navigationOrientation: .horizontal)
            pager.setViewControllers([UIViewController()], direction: .forward, animated: false)
            let container = RootTabContainerController(pager: pager)
            let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
            let window = UIWindow(windowScene: scene); window.frame = CGRect(origin: .zero, size: size)
            window.rootViewController = container; window.makeKeyAndVisible()
            window.layoutIfNeeded(); container.view.layoutIfNeeded(); container.view.layoutIfNeeded()
            XCTAssertLessThanOrEqual(pager.view.frame.maxY, container.tabBar.frame.minY + 0.5,
                                     "No hosted composer or selection action can extend into the bar's physical viewport")
            let measured = container.tabBar.sizeThatFits(CGSize(width: container.view.bounds.width, height: .greatestFiniteMagnitude)).height
            XCTAssertEqual(container.tabBar.bounds.height, ceil(measured), accuracy: 0.5,
                           "Reserve native fitting height, including its current safe area, instead of a fixed 49pt")
            XCTAssertEqual(container.tabBar.frame.maxY, container.view.bounds.maxY, accuracy: 0.5)
            window.isHidden = true
        }
    }
    func testPagerContractsForKeyboardAndRestoresWithoutMovingTheTabBar() throws {
        let pager = UIPageViewController(transitionStyle: .scroll, navigationOrientation: .horizontal)
        pager.setViewControllers([UIViewController()], direction: .forward, animated: false)
        let container = RootTabContainerController(pager: pager)
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene); window.frame = CGRect(x: 0, y: 0, width: 402, height: 874)
        window.rootViewController = container; window.makeKeyAndVisible()
        window.layoutIfNeeded(); container.view.layoutIfNeeded(); container.view.layoutIfNeeded()
        XCTAssertNotNil(container.view.window, "Screen-coordinate conversion requires an attached scene window")
        let nativeBarFrame = container.tabBar.frame
        // Drive the same screen-frame conversion path used by real keyboard notifications.
        container.updateKeyboardOcclusion(CGRect(x: 0, y: 539, width: 402, height: 335))
        container.view.layoutIfNeeded()
        XCTAssertEqual(pager.view.frame.maxY, 539, accuracy: 0.5)
        XCTAssertEqual(container.tabBar.frame, nativeBarFrame)
        container.updateKeyboardOcclusion(CGRect(x: 0, y: 874, width: 402, height: 0))
        container.view.layoutIfNeeded()
        XCTAssertEqual(pager.view.frame.maxY, container.tabBar.frame.minY, accuracy: 0.5)
        XCTAssertEqual(container.tabBar.frame, nativeBarFrame)
        container.updateKeyboardOcclusion(nil)
        container.view.layoutIfNeeded()
        XCTAssertEqual(pager.view.frame.maxY, container.tabBar.frame.minY, accuracy: 0.5)
        window.isHidden = true
    }

    func testKeyboardFrameIntersectionHandlesHiddenOffscreenAndOffsetViewports() {
        let bounds = CGRect(x: 20, y: 40, width: 402, height: 874)
        XCTAssertEqual(RootTabContainerController.availablePageHeight(bounds: bounds, keyboardFrame: nil), 874)
        XCTAssertEqual(RootTabContainerController.availablePageHeight(bounds: bounds, keyboardFrame: CGRect(x: 20, y: 579, width: 402, height: 335)), 539)
        XCTAssertEqual(RootTabContainerController.availablePageHeight(bounds: bounds, keyboardFrame: CGRect(x: 20, y: 914, width: 402, height: 0)), 874)
        XCTAssertEqual(RootTabContainerController.availablePageHeight(bounds: bounds, keyboardFrame: CGRect(x: 900, y: 579, width: 402, height: 335)), 874)
        XCTAssertEqual(RootTabContainerController.availablePageHeight(bounds: bounds, keyboardFrame: CGRect(x: 20, y: 0, width: 402, height: 1000)), 0)
    }

}
