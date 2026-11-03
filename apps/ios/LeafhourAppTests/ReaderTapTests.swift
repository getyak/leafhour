import XCTest
import UIKit
import LeafhourCore
@testable import Leafhour

@MainActor final class ReaderTapTests: XCTestCase {
    func testCenterRevealsFullToolsAndEdgesRemainReachableAfterScrolling() {
        let text = UITextView(frame: CGRect(x: 0, y: 0, width: 390, height: 700))
        let handler = ReaderEdgeTapHandler(view: text, blocked: { false }, onWake: { _ in })
        XCTAssertEqual(handler.destination(at: CGPoint(x: 180, y: 350)), .tools)
        text.bounds.origin.y = 800
        XCTAssertEqual(handler.destination(at: CGPoint(x: 180, y: 810)), .top)
        XCTAssertEqual(handler.destination(at: CGPoint(x: 180, y: 1490)), .progress)
        XCTAssertEqual(handler.destination(at: CGPoint(x: 180, y: 1150)), .tools)
        XCTAssertNil(handler.destination(at: CGPoint(x: 180, y: 10)))
    }
    func testRawNativeSelectionBlocksDisclosureEvenWithoutDomainQuote() {
        let text = UITextView(frame: CGRect(x: 0, y: 0, width: 390, height: 700))
        text.text = "A selection across two paragraphs.\n\nAnother paragraph."
        text.selectedRange = NSRange(location: 2, length: 40)
        let handler = ReaderEdgeTapHandler(view: text, blocked: { text.selectedRange.length > 0 }, onWake: { _ in })
        XCTAssertNil(handler.destination(at: CGPoint(x: 180, y: 350)))
    }
    func testNativeLinkGlyphDoesNotOpenReaderChrome() throws {
        let text = UITextView(frame: CGRect(x: 0, y: 0, width: 390, height: 700), textContainer: nil)
        text.attributedText = NSAttributedString(string: "A source link", attributes: [.font: UIFont.systemFont(ofSize: 22), .link: URL(string: "https://example.invalid")!])
        text.layoutManager.ensureLayout(for: text.textContainer)
        let rect = text.layoutManager.boundingRect(forGlyphRange: NSRange(location: 2, length: 1), in: text.textContainer)
        let point = CGPoint(x: rect.midX + text.textContainerInset.left, y: rect.midY + text.textContainerInset.top)
        let handler = ReaderEdgeTapHandler(view: text, blocked: { false }, onWake: { _ in })
        XCTAssertTrue(ReaderEdgeTapHandler.isLink(at: point, in: text))
        XCTAssertNil(handler.destination(at: point))
        XCTAssertEqual(handler.destination(at: CGPoint(x: 180, y: 350)), .tools)
    }
    func testPagedBodySidesTurnWhileCenterAndVerticalEdgesKeepDisclosure() {
        let text = UITextView(frame: CGRect(x: 0, y: 0, width: 390, height: 700))
        var paged = true, blocked = false
        let handler = ReaderEdgeTapHandler(view: text, blocked: { blocked }, onWake: { _ in }, isPaged: { paged })
        XCTAssertEqual(handler.action(at: CGPoint(x: 30, y: 350)), .turn(.previous))
        XCTAssertEqual(handler.action(at: CGPoint(x: 360, y: 350)), .turn(.next))
        XCTAssertEqual(handler.action(at: CGPoint(x: 195, y: 350)), .wake(.tools))
        XCTAssertEqual(handler.action(at: CGPoint(x: 30, y: 22)), .wake(.top))
        XCTAssertEqual(handler.action(at: CGPoint(x: 360, y: 678)), .wake(.progress))
        text.bounds.origin = CGPoint(x: 10, y: 800)
        XCTAssertEqual(handler.action(at: CGPoint(x: 370, y: 1150)), .turn(.next))
        XCTAssertEqual(handler.action(at: CGPoint(x: 40, y: 810)), .wake(.top))
        paged = false
        XCTAssertEqual(handler.action(at: CGPoint(x: 370, y: 1150)), .wake(.tools))
        paged = true; blocked = true
        XCTAssertNil(handler.action(at: CGPoint(x: 370, y: 1150)))
    }
    func testPagedLinksStayProtectedWithoutNativeTapOrHoldFailureDependencies() throws {
        let text = UITextView(frame: CGRect(x: 0, y: 0, width: 390, height: 700), textContainer: nil)
        text.attributedText = NSAttributedString(string: "Source link", attributes: [.font: UIFont.systemFont(ofSize: 22), .link: URL(string: "https://example.invalid")!])
        text.textContainerInset.top = 100
        text.layoutManager.ensureLayout(for: text.textContainer)
        let rect = text.layoutManager.boundingRect(forGlyphRange: NSRange(location: 0, length: 1), in: text.textContainer)
        let point = CGPoint(x: rect.midX + text.textContainerInset.left, y: rect.midY + text.textContainerInset.top)
        let handler = ReaderEdgeTapHandler(view: text, blocked: { false }, onWake: { _ in }, isPaged: { true })
        XCTAssertNil(handler.action(at: point))
        let lateDoubleTap = UITapGestureRecognizer(); lateDoubleTap.numberOfTapsRequired = 2
        let lateLongPress = UILongPressGestureRecognizer()
        let descendant = UIView(); text.addSubview(descendant)
        descendant.addGestureRecognizer(lateDoubleTap); descendant.addGestureRecognizer(lateLongPress)
        XCTAssertFalse(handler.gestureRecognizer(handler.recognizer, shouldRequireFailureOf: lateDoubleTap))
        XCTAssertFalse(handler.gestureRecognizer(handler.recognizer, shouldRequireFailureOf: lateLongPress))
        let outside = UIView(), externalTap = UITapGestureRecognizer(); externalTap.numberOfTapsRequired = 2
        outside.addGestureRecognizer(externalTap)
        XCTAssertFalse(handler.gestureRecognizer(handler.recognizer, shouldRequireFailureOf: externalTap))
    }

    func testDueTapWaitsForShortContactReleaseInsteadOfDroppingOrMovingTextUnderTheFinger() async throws {
        let text = UITextView(frame: CGRect(x: 0, y: 0, width: 390, height: 700))
        var turns = 0
        let handler = ReaderEdgeTapHandler(view: text, blocked: { false }, onWake: { _ in }, isPaged: { true }, onTurn: { _ in turns += 1 }, delay: { 0.05 })
        handler.handleTap(at: CGPoint(x: 360, y: 350)); handler.touchActivity(true)
        try await Task.sleep(for: .milliseconds(100)); XCTAssertEqual(turns, 0)
        handler.touchActivity(false)
        handler.handleTap(at: CGPoint(x: 360, y: 350))
        try await Task.sleep(for: .milliseconds(100)); XCTAssertEqual(turns, 2)
        handler.invalidate()
    }
    func testDelayedTurnsRebaseOnlyNavigationCausedByThePageTurnItself() async throws {
        let text = UITextView(frame: CGRect(x: 0, y: 0, width: 390, height: 700))
        var turns = 0, navigation = UUID()
        let handler = ReaderEdgeTapHandler(view: text, blocked: { false }, onWake: { _ in }, isPaged: { true }, onTurn: { _ in turns += 1; navigation = UUID() }, delay: { 0.05 }, context: {
            ReaderTapContext(owner: ObjectIdentifier(text), navigation: navigation, preferences: ReaderPreferences())
        })
        for _ in 0..<3 { handler.handleTap(at: CGPoint(x: 360, y: 350)) }
        try await Task.sleep(for: .milliseconds(150)); XCTAssertEqual(turns, 3)
        handler.handleTap(at: CGPoint(x: 360, y: 350)); navigation = UUID()
        try await Task.sleep(for: .milliseconds(100)); XCTAssertEqual(turns, 3)
        handler.invalidate()
    }

    func testDelayedTapsRemainIndividualAndCancelOnContextOrSelectionChange() async throws {
        let text = UITextView(frame: CGRect(x: 0, y: 0, width: 390, height: 700))
        var turns: [ReaderPageDirection] = [], blocked = false, navigation = UUID()
        let handler = ReaderEdgeTapHandler(view: text, blocked: { blocked }, onWake: { _ in }, isPaged: { true },
            onTurn: { turns.append($0) }, delay: { 0.05 }, context: {
                ReaderTapContext(owner: ObjectIdentifier(text), navigation: navigation, preferences: ReaderPreferences())
            })
        let point = CGPoint(x: 360, y: 350)
        handler.handleTap(at: point); handler.handleTap(at: point); handler.handleTap(at: point)
        XCTAssertTrue(turns.isEmpty)
        try await Task.sleep(for: .milliseconds(120))
        XCTAssertEqual(turns, [.next, .next, .next])
        handler.handleTap(at: point); navigation = UUID()
        try await Task.sleep(for: .milliseconds(100)); XCTAssertEqual(turns.count, 3)
        handler.handleTap(at: point); blocked = true
        try await Task.sleep(for: .milliseconds(100)); XCTAssertEqual(turns.count, 3)
        blocked = false; handler.handleTap(at: point)
        NotificationCenter.default.post(name: UIApplication.willResignActiveNotification, object: nil)
        try await Task.sleep(for: .milliseconds(100)); XCTAssertEqual(turns.count, 3)
        handler.invalidate()
    }

    func testNativeCurlUsesOneTemporaryContainerAndReleasesItWhenCancelled() throws {
        try XCTSkipIf(UIAccessibility.isReduceMotionEnabled, "The Reduce Motion path intentionally creates no curl container")
        let owner = UIViewController(), window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 700))
        window.rootViewController = owner; window.makeKeyAndVisible()
        defer { window.isHidden = true; window.rootViewController = nil }
        let page = UIView(frame: window.bounds); page.backgroundColor = .white
        owner.view.addSubview(page)
        let curl = ReaderPageCurlTransition()
        var completed: Bool?
        curl.animate(from: UIView(frame: page.bounds), over: page, direction: .next, paper: .white, style: .curl) { completed = $0 }
        let controller = try XCTUnwrap(owner.children.compactMap { $0 as? UIPageViewController }.first)
        XCTAssertEqual(controller.transitionStyle, .pageCurl)
        XCTAssertEqual(controller.navigationOrientation, .horizontal)
        XCTAssertFalse(controller.isDoubleSided)
        XCTAssertTrue(curl.isActive)
        curl.cancel()
        XCTAssertFalse(curl.isActive)
        XCTAssertTrue(owner.children.isEmpty, "Cancellation must release the temporary native curl and both snapshots")
        XCTAssertEqual(completed, false)
        XCTAssertTrue(page.superview === owner.view, "The live selectable reader remains the actual page")
    }

    func testUnavailableCurlStillCompletesAndKeepsTheLivePage() {
        let page = UIView(frame: CGRect(x: 0, y: 0, width: 390, height: 700))
        let curl = ReaderPageCurlTransition()
        var completionCount = 0
        curl.animate(from: nil, over: page, direction: .next, paper: .white) { _ in completionCount += 1 }
        XCTAssertEqual(completionCount, 1)
        XCTAssertFalse(curl.isActive)
    }

}
