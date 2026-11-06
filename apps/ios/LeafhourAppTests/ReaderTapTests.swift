import XCTest
import UIKit
import LeafhourCore
@testable import Leafhour

@MainActor final class ReaderTapTests: XCTestCase {
    func testTenRawContactsTurnIndividuallyWithoutWaitingForUIKitReset() throws {
        for vertical in [false, true] {
            let view = UIView(frame: CGRect(x: 0, y: 0, width: 400, height: 800))
            var turns = 0
            let handler = ReaderEdgeTapHandler(view: view, blocked: { false }, onWake: { _ in },
                isPaged: { !vertical }, isScrolling: { vertical }, onTurn: { _ in turns += 1 })
            let observer = try XCTUnwrap(handler.recognizer as? ReaderShortContactObserver)
            let point = vertical ? CGPoint(x: 200, y: 720) : CGPoint(x: 380, y: 400)
            for index in 0..<10 {
                let touch = ReaderContactTestTouch(point: point, instant: Double(index) * 0.1)
                let event = ReaderContactTestEvent(contacts: [touch])
                XCTAssertTrue(handler.gestureRecognizer(observer, shouldReceive: touch))
                observer.touchesBegan([touch], with: event)
                touch.instant += 0.04
                observer.touchesEnded([touch], with: event)
                XCTAssertEqual(turns, index + 1)
                XCTAssertEqual(observer.state, .possible, "A completed contact must not create a terminal-state blind spot")
            }
            XCTAssertFalse(observer.cancelsTouchesInView)
            XCTAssertFalse(observer.delaysTouchesBegan)
            XCTAssertFalse(observer.delaysTouchesEnded)
            handler.invalidate()
        }
    }
    func testRawContactRejectsDragHoldAndMultipleFingersAndThenRecovers() throws {
        let view = UIView(frame: CGRect(x: 0, y: 0, width: 400, height: 800))
        var turns = 0
        let handler = ReaderEdgeTapHandler(view: view, blocked: { false }, onWake: { _ in }, isPaged: { true }, onTurn: { _ in turns += 1 })
        let observer = try XCTUnwrap(handler.recognizer as? ReaderShortContactObserver)
        for kind in 0..<4 {
            let touch = ReaderContactTestTouch(point: CGPoint(x: 380, y: 400), instant: Double(kind))
            let event = ReaderContactTestEvent(contacts: [touch])
            XCTAssertTrue(handler.gestureRecognizer(observer, shouldReceive: touch))
            observer.touchesBegan([touch], with: event)
            if kind == 0 { touch.point.y += 30; observer.touchesMoved([touch], with: event) }
            if kind == 2 {
                let second = ReaderContactTestTouch(point: CGPoint(x: 40, y: 400), instant: Double(kind) + 0.01)
                XCTAssertFalse(handler.gestureRecognizer(observer, shouldReceive: second))
            }
            touch.instant += kind == 1 ? 0.8 : 0.04
            observer.touchesEnded([touch], with: event)
            XCTAssertEqual(turns, kind == 3 ? 1 : 0)
        }
        handler.invalidate()
    }
    func testPassiveContactObserverDoesNotBlockParagraphLongPress() throws {
        let view = UIView(frame: CGRect(x: 0, y: 0, width: 400, height: 800))
        let handler = ReaderEdgeTapHandler(view: view, blocked: { false }, onWake: { _ in })
        let paragraphs = ReaderParagraphSelectionObserver(view: view, eligible: { _ in true }, context: { "same" },
            selectionActive: { false }, expand: { false }, initialSelection: { _ in true })
        let press = try XCTUnwrap(view.gestureRecognizers?.compactMap { $0 as? UILongPressGestureRecognizer }.first)
        XCTAssertFalse(paragraphs.gestureRecognizer(press, shouldBeRequiredToFailBy: handler.recognizer))
        paragraphs.invalidate(); handler.invalidate()
    }
    func testReaderBodyRejectsNativeCaretTapsInsteadOfCombiningThemWithPageTurns() {
        let view = ReflowTextView()
        view.frame = CGRect(x: 0, y: 0, width: 400, height: 800)
        view.isEditable = false; view.isSelectable = true; view.text = "A real source paragraph."
        let nativeTap = UITapGestureRecognizer()
        view.addGestureRecognizer(nativeTap)
        for insets in [UIEdgeInsets.zero, nil] as [UIEdgeInsets?] {
            view.pagedReadingInsets = insets
            XCTAssertFalse(view.gestureRecognizerShouldBegin(nativeTap), "Both axes must leave ordinary body taps to the reader")
        }
    }
    func testTenVerticalTapsKeepTheirAxisAndSelectionDismissalConsumesOnlyOneTap() {
        let text = UITextView(frame: CGRect(x: 0, y: 0, width: 400, height: 800))
        var turns: [ReaderPageDirection] = [], selected = false
        let handler = ReaderEdgeTapHandler(view: text, blocked: { false }, onWake: { _ in },
            isScrolling: { true }, hasSelection: { selected }, onDismissSelection: { selected = false },
            onTurn: { turns.append($0) })
        for _ in 0..<10 { handler.handleTap(at: CGPoint(x: 200, y: 720)) }
        XCTAssertEqual(turns, Array(repeating: .next, count: 10))
        for _ in 0..<10 { handler.handleTap(at: CGPoint(x: 200, y: 80)) }
        XCTAssertEqual(turns.suffix(10), Array(repeating: .previous, count: 10)[...])
        handler.handleTap(at: CGPoint(x: 20, y: 400))
        handler.handleTap(at: CGPoint(x: 380, y: 400))
        XCTAssertEqual(turns.count, 20)
        selected = true
        handler.handleTap(at: CGPoint(x: 200, y: 720))
        XCTAssertFalse(selected); XCTAssertEqual(turns.count, 20)
        handler.handleTap(at: CGPoint(x: 200, y: 720))
        XCTAssertEqual(turns.count, 21)
        handler.invalidate()
    }

    func testTenHorizontalTapsAreIndividualAndTheMiddleHalfDoesNotTurn() {
        let text = UITextView(frame: CGRect(x: 0, y: 0, width: 400, height: 800))
        var turns: [ReaderPageDirection] = []
        let handler = ReaderEdgeTapHandler(view: text, blocked: { false }, onWake: { _ in },
            isPaged: { true }, onTurn: { turns.append($0) })
        for _ in 0..<10 { handler.handleTap(at: CGPoint(x: 380, y: 400)) }
        for _ in 0..<10 { handler.handleTap(at: CGPoint(x: 20, y: 400)) }
        XCTAssertEqual(turns, Array(repeating: .next, count: 10) + Array(repeating: .previous, count: 10))
        handler.handleTap(at: CGPoint(x: 110, y: 400))
        handler.handleTap(at: CGPoint(x: 290, y: 400))
        XCTAssertEqual(turns.count, 20)
        handler.invalidate()
    }

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
        XCTAssertEqual(handler.action(at: CGPoint(x: 30, y: 22)), .turn(.previous))
        XCTAssertEqual(handler.action(at: CGPoint(x: 360, y: 678)), .turn(.next))
        text.bounds.origin = CGPoint(x: 10, y: 800)
        XCTAssertEqual(handler.action(at: CGPoint(x: 370, y: 1150)), .turn(.next))
        XCTAssertEqual(handler.action(at: CGPoint(x: 40, y: 810)), .turn(.previous))
        paged = false
        XCTAssertEqual(handler.action(at: CGPoint(x: 370, y: 1150)), .wake(.tools))
        paged = true; blocked = true
        XCTAssertNil(handler.action(at: CGPoint(x: 370, y: 1150)))
    }
    func testPageSideRegionsIncludeTheTopAndBottomCorners() {
        let text = UITextView(frame: CGRect(x: 0, y: 0, width: 390, height: 700))
        let handler = ReaderEdgeTapHandler(view: text, blocked: { false }, onWake: { _ in }, isPaged: { true })
        for y in [CGFloat(10), 350, 690] {
            XCTAssertEqual(handler.action(at: CGPoint(x: 20, y: y)), .turn(.previous))
            XCTAssertEqual(handler.action(at: CGPoint(x: 370, y: y)), .turn(.next))
        }
        XCTAssertEqual(handler.action(at: CGPoint(x: 195, y: 10)), .wake(.top))
        XCTAssertEqual(handler.action(at: CGPoint(x: 195, y: 690)), .wake(.progress))
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


@MainActor private final class ReaderContactTestTouch: UITouch {
    var point: CGPoint
    var instant: TimeInterval
    init(point: CGPoint, instant: TimeInterval) { self.point = point; self.instant = instant; super.init() }
    override var timestamp: TimeInterval { instant }
    override var type: UITouch.TouchType { .direct }
    override func location(in view: UIView?) -> CGPoint { point }
}
@MainActor private final class ReaderContactTestEvent: UIEvent {
    let contacts: Set<UITouch>
    init(contacts: Set<UITouch>) { self.contacts = contacts; super.init() }
    override var allTouches: Set<UITouch>? { contacts }
}
