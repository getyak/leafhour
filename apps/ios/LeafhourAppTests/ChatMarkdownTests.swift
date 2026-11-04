import XCTest
import UIKit
import SwiftUI
import Vision
import Observation
import LeafhourCore
@testable import Leafhour

@MainActor final class ChatMarkdownTests: XCTestCase {
    func testIncomingContentAndLayoutVisibilityNeverImplyUserBrowsing() {
        let position = ChatScrollState()
        for _ in 0..<20 { position.updateBottomVisibility(false); position.updateBottomVisibility(true) }
        XCTAssertTrue(position.followsLatest)
        position.updateBottomVisibility(false)
        XCTAssertTrue(position.followsLatest, "A growing answer alone does not pause following")
    }

    func testUserScrollPausesUntilAnActualScrollEndsAtTheBottom() {
        let position = ChatScrollState()
        position.updateBottomVisibility(true)
        position.beginBrowsing(); position.updateBottomVisibility(false); position.endBrowsing()
        XCTAssertFalse(position.followsLatest)
        position.beginBrowsing(); position.updateBottomVisibility(true); position.endBrowsing()
        XCTAssertTrue(position.followsLatest)
    }

    func testExplicitSendOrLatestResumesWithoutBeingOverriddenByAnOldScrollEnd() {
        let position = ChatScrollState()
        position.beginBrowsing(); position.updateBottomVisibility(false)
        position.resumeFollowing(); position.endBrowsing()
        XCTAssertTrue(position.followsLatest)
        XCTAssertFalse(position.isAtLatest, "Resuming intent must not claim the position has already changed")
    }

    func testKeyboardDismissalPreservesExistingBrowsingIntent() {
        let typing = ChatScrollLayout(container: CGSize(width: 390, height: 844), insets: EdgeInsets(top: 100, leading: 0, bottom: 380, trailing: 0))
        let reading = ChatScrollLayout(container: CGSize(width: 390, height: 844), insets: EdgeInsets(top: 100, leading: 0, bottom: 80, trailing: 0))
        let position = ChatScrollState()
        position.beginBrowsing(layout: typing); position.updateBottomVisibility(false); position.endBrowsing(layout: typing)
        position.beginBrowsing(layout: typing); position.updateBottomVisibility(true); position.endBrowsing(layout: reading)
        XCTAssertFalse(position.followsLatest, "A larger viewport must not turn an earlier browsing session into following")
        position.resumeFollowing()
        position.beginBrowsing(layout: typing); position.endBrowsing(layout: reading)
        XCTAssertTrue(position.followsLatest, "A bottom bounce may return to an already-following state")
    }

    func testLegacyInertiaReachesTheBottomAfterTheFingerLifts() async {
        let position = ChatScrollState()
        position.beginLegacyBrowsing()
        position.updateLegacyBottomVisibility(false)
        position.endLegacyBrowsing()
        XCTAssertFalse(position.followsLatest)
        let resumed = expectation(description: "The settled legacy scroll resumes at its final bottom position")
        withObservationTracking { _ = position.followsLatest } onChange: { resumed.fulfill() }
        position.updateLegacyBottomVisibility(true)
        await fulfillment(of: [resumed], timeout: 2)
        XCTAssertTrue(position.followsLatest)
    }

    func testLongHistoryKeepsAllRecordsWithoutCreatingEveryNativeTextView() async throws {
        let tools = ReaderCloudTools()
        tools.conversationAvailable = true
        tools.turns = (1...200).map { ReaderConversationTurn(id: "history-\($0)", question: "Synthetic question \($0)", answer: "Synthetic reply \($0)", status: "completed") }
        let host = UIHostingController(rootView: NavigationStack {
            ChatConversationView(tools: tools, cloud: nil, bookTitle: "Synthetic history", source: "", load: {}, send: {})
        }.environment(\.dynamicTypeSize, .large))
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 390, height: 844)
        window.rootViewController = host; window.makeKeyAndVisible(); host.view.frame = window.bounds
        defer { window.isHidden = true; window.rootViewController = nil }
        func textViews(_ view: UIView) -> [UITextView] {
            (view as? UITextView).map { [$0] } ?? [] + view.subviews.flatMap(textViews)
        }
        var fields: [UITextView] = []
        for _ in 0..<50 {
            host.view.layoutIfNeeded(); fields = textViews(host.view)
            if fields.contains(where: { $0.text.contains("Synthetic reply 200") }) { break }
            try await Task.sleep(for: .milliseconds(20))
        }
        let latest = try XCTUnwrap(fields.first { $0.text.contains("Synthetic reply 200") })
        XCTAssertTrue(latest.convert(latest.bounds, to: host.view).intersects(host.view.bounds))
        XCTAssertEqual(tools.turns.count, 200, "Rendering must not truncate stored conversation history")
        XCTAssertLessThan(fields.count, 200, "Older history must remain lazy rather than create all 400 message text views")
        let evidence = XCTAttachment(string: "Synthetic turns: 200; native text views in the hosted hierarchy: \(fields.count)")
        evidence.lifetime = .keepAlways; add(evidence)
    }

    func testRunningChatKeepsOneSentQuoteAndCompactResponseState() async throws {
        let quoteText = "云端边界不是阅读边界。"
        let tools = ReaderCloudTools()
        tools.conversationAvailable = true
        tools.turns = [ReaderConversationTurn(id: "synthetic-running", question: "解释这段的意思", answer: nil, status: "running",
            quote: ReaderTurnQuote(kind: "quote", schemaVersion: 1, bookId: "synthetic-book", chapterId: "chapter-1",
                parts: [.init(passageId: "passage-1", layer: "original", text: quoteText)]))]
        tools.removeChatSelection()
        tools.generating = true
        tools.responseText = "这里讨论的是阅读材料的存放位置。\n\n**本机原件**可以留在设备上，回答只使用这次提问所需的内容。"
        tools.responseStatus = "正在回答…"
        for size in [DynamicTypeSize.large, .accessibility3] {
            let view = NavigationStack {
                ChatConversationView(tools: tools, cloud: nil, bookTitle: "Synthetic book", source: quoteText,
                    load: {}, send: {})
            }.environment(\.dynamicTypeSize, size)
            let host = UIHostingController(rootView: view)
            let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
            window.rootViewController = host; window.makeKeyAndVisible(); host.view.frame = window.bounds
            try await Task.sleep(for: .milliseconds(180)); host.view.layoutIfNeeded()
            let image = UIGraphicsImageRenderer(size: window.bounds.size).image { _ in
                XCTAssertTrue(host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true))
            }
            let attachment = XCTAttachment(image: image)
            attachment.name = "Compact IM · synthetic streamed reply · " + String(describing: size)
            attachment.lifetime = .keepAlways; add(attachment)
            let recognition = VNRecognizeTextRequest()
            recognition.recognitionLevel = .accurate; recognition.recognitionLanguages = ["zh-Hans", "en-US"]
            try VNImageRequestHandler(cgImage: XCTUnwrap(image.cgImage)).perform([recognition])
            let text = (recognition.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n").replacingOccurrences(of: " ", with: "")
            XCTAssertFalse(text.contains("AI陪读"), text)
            XCTAssertFalse(text.contains("不读取私人笔记"), text)
            XCTAssertFalse(text.contains("刷新对话"), text)
            if size == .large {
                XCTAssertEqual(text.components(separatedBy: quoteText).count - 1, 1, "One immutable sent quote, no composer duplicate.\n" + text)
                XCTAssertTrue(text.contains("正在回答"), text)
            }
            window.isHidden = true; window.rootViewController = nil
        }
    }

    func testAssistantBodyUsesCompactSystemTextStyle() throws {
        let result = ChatMarkdownView.render("A quiet reply.", width: 280)
        let body = try XCTUnwrap(result.attribute(.font, at: 0, effectiveRange: nil) as? UIFont)
        XCTAssertEqual(body.pointSize, UIFont.preferredFont(forTextStyle: .subheadline).pointSize)
    }

    func testNativeMessageNegotiationKeepsTheProposedWidthAndTextSelection() {
        for plain in [true, false] {
            let coordinator = ChatMarkdownView.Coordinator(), view = ChatMeasurementTextView()
            view.isScrollEnabled = false; view.textContainerInset = .zero; view.textContainer.lineFragmentPadding = 0
            let source = plain ? "第二句合成问题" : String(repeating: "A quiet **answer** stays readable.\n\n", count: 20)
            let initialInstalls = view.installations
            let first = coordinator.size(view, source: source, width: 302, category: .large, plainText: plain)
            XCTAssertEqual(first.width, 302, accuracy: 0.01)
            view.bounds = CGRect(origin: .zero, size: first)
            view.selectedRange = NSRange(location: 0, length: 3)
            for _ in 0..<20 {
                coordinator.update(view, source: source, width: view.bounds.width, category: .large, plainText: plain)
                let next = coordinator.size(view, source: source, width: 302, category: .large, plainText: plain)
                XCTAssertEqual(next, first)
                view.bounds = CGRect(origin: .zero, size: next)
            }
            XCTAssertEqual(view.measurements, 1, "Settled message layout must not keep negotiating two widths")
            XCTAssertEqual(view.installations - initialInstalls, 1, "Layout negotiation must not repeatedly replace native text")
            XCTAssertEqual(view.selectedRange, NSRange(location: 0, length: 3))
        }
    }

    func testRepeatedLongAnswerLayoutReusesParsedAndRenderedText() throws {
        let source = String(repeating: "## A chapter\n\nA **long** answer with a [source](https://example.com).\n\n", count: 150)
        let coordinator = ChatMarkdownView.Coordinator()
        let original = coordinator.rendered(source, width: 280, category: .large)
        for _ in 0..<30 {
            XCTAssertTrue(coordinator.rendered(source, width: 280, category: .large) === original)
        }
        let wider = coordinator.rendered(source, width: 340, category: .large)
        XCTAssertFalse(wider === original)
        XCTAssertEqual(wider.string, original.string)
        let next = coordinator.rendered(source + "A streamed addition.", width: 340, category: .large)
        XCTAssertTrue(next.string.hasPrefix(original.string))
        // Markdown's native paragraph separator remains part of display text.
        XCTAssertTrue(next.string.trimmingCharacters(in: .newlines).hasSuffix("A streamed addition."))
    }

    func testCompactAssistantTextStillScalesAtAccessibilitySize() throws {
        let normal = ChatMarkdownView.render("A readable answer.", width: 280, category: .large)
        let accessible = ChatMarkdownView.render("A readable answer.", width: 280, category: .accessibilityExtraExtraExtraLarge)
        let normalFont = try XCTUnwrap(normal.attribute(.font, at: 0, effectiveRange: nil) as? UIFont)
        let accessibleFont = try XCTUnwrap(accessible.attribute(.font, at: 0, effectiveRange: nil) as? UIFont)
        XCTAssertGreaterThan(accessibleFont.pointSize, normalFont.pointSize)
        XCTAssertEqual(accessibleFont.pointSize, UIFont.preferredFont(forTextStyle: .subheadline,
            compatibleWith: UITraitCollection(preferredContentSizeCategory: .accessibilityExtraExtraExtraLarge)).pointSize)
    }

    func testRepeatedMeasurementRetainsNativeSelectionAndSkipsFullTextLayout() {
        let coordinator = ChatMarkdownView.Coordinator(), view = ChatMeasurementTextView()
        view.isScrollEnabled = false
        let source = String(repeating: "A **long** answer.\n\n", count: 100)
        let size = coordinator.size(view, source: source, width: 280, category: .large)
        view.selectedRange = NSRange(location: 3, length: 6)
        for _ in 0..<30 {
            coordinator.update(view, source: source, width: 280, category: .large)
            XCTAssertEqual(coordinator.size(view, source: source, width: 280, category: .large), size)
        }
        XCTAssertEqual(view.measurements, 1)
        XCTAssertEqual(view.selectedRange, NSRange(location: 3, length: 6))
        _ = coordinator.size(view, source: source, width: 340, category: .large)
        XCTAssertEqual(view.measurements, 2, "A width change needs one new layout")
    }

    func testBlockMarkdownRetainsReadableTextAndRealStyles() throws {
        let result = ChatMarkdownView.render("# 标题\n\n正文 **强调**。\n\n> 引用\n\n- 第一项\n- 第二项\n\n```swift\nlet value = 1\n```\n\n[来源](https://example.com)", width: 280)
        XCTAssertFalse(result.string.contains("# 标题"))
        XCTAssertTrue(result.string.contains("标题")); XCTAssertTrue(result.string.contains("第一项")); XCTAssertTrue(result.string.contains("let value = 1"))
        let text = result.string as NSString
        let heading = try XCTUnwrap(result.attribute(.font, at: text.range(of: "标题").location, effectiveRange: nil) as? UIFont)
        let body = try XCTUnwrap(result.attribute(.font, at: text.range(of: "正文").location, effectiveRange: nil) as? UIFont)
        XCTAssertGreaterThan(heading.pointSize, body.pointSize)
        let code = try XCTUnwrap(result.attribute(.font, at: text.range(of: "let value").location, effectiveRange: nil) as? UIFont)
        XCTAssertTrue(code.fontDescriptor.symbolicTraits.contains(.traitMonoSpace))
        XCTAssertEqual((result.attribute(.link, at: text.range(of: "来源").location, effectiveRange: nil) as? URL)?.absoluteString, "https://example.com")
    }
}

private final class ChatMeasurementTextView: UITextView {
    var measurements = 0
    var installations = 0
    override var attributedText: NSAttributedString! { didSet { installations += 1 } }
    override func sizeThatFits(_ size: CGSize) -> CGSize { measurements += 1; return super.sizeThatFits(size) }
}
