import XCTest
import UIKit
import SwiftUI
import Vision
import Observation
import LeafhourCore
@testable import Leafhour

@MainActor final class ChatMarkdownTests: XCTestCase {
    func testNativeTableMeasurementMatchesPlacementAtAccessibilitySize() {
        let source = "| 起点 | 时刻 | 留下什么 |\n|---|---|---|\n| 一句读不懂的话 | 傍晚光线将要变暗，注意力剩得不多，却又不想马上起身去做别的事的时候 | 一个被反复描过的问号，以及第二天重读时忽然通了的那一下 |"
        for category in [UIContentSizeCategory.large, .accessibilityExtraExtraExtraLarge] {
            let view = ChatMarkdownView.makeNativeTextView(), coordinator = ChatMarkdownView.Coordinator()
            let measured = coordinator.size(view, source: source, width: 362, category: category)
            view.bounds = CGRect(origin: .zero, size: measured)
            view.traitOverrides.preferredContentSizeCategory = category
            view.layoutIfNeeded()
            let actual = view.sizeThatFits(CGSize(width: 362, height: CGFloat.greatestFiniteMagnitude))
            let evidence = XCTAttachment(string: "category=\(category.rawValue), measured=\(measured), placed=\(actual), actualFont=\((view.attributedText.attribute(.font, at: 0, effectiveRange: nil) as? UIFont)?.pointSize ?? 0)")
            evidence.name = "Native table measure/place consistency"; evidence.lifetime = .keepAlways; add(evidence)
            XCTAssertEqual(measured.height, actual.height, accuracy: 1, "UIKit must not change explicit fonts behind the cached measurement")
        }
    }

    func testAccessibleResponsiveTableNativeLineGeometry() throws {
        let source = "| 起点 | 适合的时刻 | 读后留下什么 |\n|---|---|---|\n| 一句读不懂的话 | 傍晚光线将要变暗，注意力剩得不多，却又不想马上起身去做别的事的时候 | 一个被反复描过的问号，以及第二天重读时忽然通了的那一下 |"
        let view = ChatMarkdownView.makeNativeTextView()
        view.frame = CGRect(x: 0, y: 0, width: 362, height: 4000)
        view.traitOverrides.preferredContentSizeCategory = .large
        let coordinator = ChatMarkdownView.Coordinator()
        _ = coordinator.size(view, source: source, width: 362, category: .accessibilityExtraExtraExtraLarge)
        view.traitOverrides.preferredContentSizeCategory = .accessibilityExtraExtraExtraLarge
        view.layoutIfNeeded(); view.layoutManager.ensureLayout(for: view.textContainer)
        var previous: CGRect?, report: [String] = [], overlaps = 0
        let all = view.layoutManager.glyphRange(for: view.textContainer)
        view.layoutManager.enumerateLineFragments(forGlyphRange: all) { rect, used, container, glyphs, _ in
            let bounds = view.layoutManager.boundingRect(forGlyphRange: glyphs, in: container)
            let chars = view.layoutManager.characterRange(forGlyphRange: glyphs, actualGlyphRange: nil)
            let font = view.textStorage.attribute(.font, at: chars.location, effectiveRange: nil) as? UIFont
            report.append("line=\(rect), used=\(used), glyph=\(bounds), font=\(font?.pointSize ?? 0), fontLine=\(font?.lineHeight ?? 0)")
            if let previous, bounds.minY < previous.maxY - 2 { overlaps += 1 }
            previous = bounds
        }
        let evidence = XCTAttachment(string: report.joined(separator: "\n")); evidence.name = "UIKit accessible table line geometry"; evidence.lifetime = .keepAlways; add(evidence)
        XCTAssertEqual(overlaps, 0, "Adjacent native line glyph bounds must not overlap")
    }

    func testAccessibleTableParagraphTerminatorsKeepTheirValueFontMetrics() throws {
        let text = ChatMarkdownView.render("| A | B | C | D |\n|---|---|---|---|\n| 完整值 | 第二格 | 第三格 | 第四格 |", width: 250, category: .accessibilityExtraExtraExtraLarge)
        let string = text.string as NSString
        let value = try XCTUnwrap(text.attribute(.font, at: string.range(of: "完整值").location, effectiveRange: nil) as? UIFont)
        for offset in 0..<string.length where string.character(at: offset) == 10 {
            let terminator = try XCTUnwrap(text.attribute(.font, at: offset, effectiveRange: nil) as? UIFont, "Every native paragraph must carry explicit Dynamic Type metrics")
            XCTAssertEqual(terminator.pointSize, value.pointSize)
        }
    }

    func testAccessibleThematicRuleUsesOneNativeLine() {
        let rendered = ChatMarkdownView.render("上文。\n\n---\n\n下文。", width: 200, category: .accessibilityExtraExtraExtraLarge)
        let storage = NSTextStorage(attributedString: rendered), layout = NSLayoutManager()
        let container = NSTextContainer(size: CGSize(width: 200, height: 10000)); container.lineFragmentPadding = 0
        storage.addLayoutManager(layout); layout.addTextContainer(container); layout.ensureLayout(for: container)
        let glyphs = layout.glyphRange(forCharacterRange: (rendered.string as NSString).range(of: "────────"), actualCharacterRange: nil)
        var lines = 0; layout.enumerateLineFragments(forGlyphRange: glyphs) { _, _, _, _, _ in lines += 1 }
        XCTAssertEqual(lines, 1, "A separator must not wrap like eight oversized text characters")
    }

    func testMarginalCompletionWithoutTextDeltasKeepsTheFirstSentenceVisible() async throws {
        try await verifyMarginalFirstSentence(preloaded: false)
    }
    func testWarmMarginalReopenKeepsTheFirstSentenceVisible() async throws {
        try await verifyMarginalFirstSentence(preloaded: true)
    }
    private func verifyMarginalFirstSentence(preloaded: Bool) async throws {
        let tools = ReaderCloudTools(); tools.conversationAvailable = true
        let answer = "第一句应当留在眼前。\n\n" + String(repeating: "继续辨认这段话里的意思，不必追着结尾跑。\n\n", count: 80)
        let completed = ReaderConversationTurn(id: "no-deltas", question: "读这段", answer: answer, status: "completed")
        if preloaded { tools.turns = [completed] }
        let host = UIHostingController(rootView: NavigationStack {
            ChatConversationView(tools: tools, cloud: nil, bookTitle: "Test book", source: "", isMarginalNote: true,
                load: {
                    if preloaded { return }
                    tools.generating = true
                    tools.turns = [ReaderConversationTurn(id: "no-deltas", question: "读这段", answer: nil, status: "running")]
                    try? await Task.sleep(for: .milliseconds(200))
                    tools.turns = [completed]
                    tools.generating = false
                }, send: {})
        })
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene); window.frame = CGRect(x: 0, y: 0, width: 402, height: 874)
        window.rootViewController = host; window.makeKeyAndVisible(); host.view.frame = window.bounds
        defer { window.isHidden = true; window.rootViewController = nil }
        func views(_ view: UIView) -> [UITextView] { (view as? UITextView).map { [$0] } ?? [] + view.subviews.flatMap(views) }
        var live: UITextView?
        for _ in 0..<120 {
            host.view.layoutIfNeeded()
            live = views(host.view).first { $0.text.hasPrefix("第一句应当") }
            if let live, live.convert(live.bounds, to: host.view).minY >= window.safeAreaInsets.top { break }
            try await Task.sleep(for: .milliseconds(20))
        }
        let visible = try XCTUnwrap(live)
        XCTAssertGreaterThanOrEqual(visible.convert(visible.bounds, to: host.view).minY, window.safeAreaInsets.top)
        XCTAssertLessThan(visible.convert(visible.bounds, to: host.view).minY, window.bounds.height * 0.5)
    }

    func testExplicitReadingIntentPreservesTheObservedBottomPosition() {
        let position = ChatScrollState(); position.updateBottomVisibility(true)
        position.pauseFollowing()
        XCTAssertFalse(position.followsLatest)
        XCTAssertTrue(position.isAtLatest, "Presentation intent must not fabricate a new bottom position")
        position.endBrowsing()
        XCTAssertFalse(position.followsLatest, "An unrelated idle event must not undo explicit reading intent")
        position.resumeFollowing(); XCTAssertTrue(position.followsLatest)
    }

    func testTableEntityWhitespaceCannotShiftColumnsOrDropValues() {
        for space in ["&#9;", "&#10;"] {
            let source = "| A | B | C | D |\n|---|---|---|---|\n| left\(space)tail | second | third | fourth |"
            let display = ChatMarkdownView.render(source, width: 250)
            XCTAssertTrue(display.string.contains("B：second"))
            XCTAssertTrue(display.string.contains("C：third"))
            XCTAssertTrue(display.string.contains("D：fourth"), "A character inside a cell cannot become an extra table delimiter")
            XCTAssertTrue(display.string.contains("tail"))
        }
    }

    func testResponsiveTablePreservesRichHeaderLinksAndEmphasis() throws {
        let source = "| [来源](https://leafhour.com) | *语气* | `kind` | ~~旧记~~ |\n|---|---|---|---|\n| 页面 | 轻声 | note | 保留 |"
        let display = ChatMarkdownView.render(source, width: 250)
        let text = display.string as NSString
        XCTAssertEqual((display.attribute(.link, at: text.range(of: "来源").location, effectiveRange: nil) as? URL)?.absoluteString, "https://leafhour.com")
        XCTAssertNotNil(display.attribute(.obliqueness, at: text.range(of: "语气").location, effectiveRange: nil))
        let code = try XCTUnwrap(display.attribute(.font, at: text.range(of: "kind").location, effectiveRange: nil) as? UIFont)
        XCTAssertTrue(code.fontDescriptor.symbolicTraits.contains(.traitMonoSpace))
        XCTAssertNotNil(display.attribute(.strikethroughStyle, at: text.range(of: "旧记").location, effectiveRange: nil))
    }

    func testAsynchronouslyRestoredLongAnswerHasVisibleNativeText() async throws {
        let tools = ReaderCloudTools(); tools.conversationAvailable = true
        let turns = (1...4).map { ReaderConversationTurn(id: "short-\($0)", question: "短问题", answer: "较短的旧回答。", status: "completed") }
            + [ReaderConversationTurn(id: "long-live", question: String(repeating: "请检查这份长回答。", count: 70), answer: String(repeating: "## 页边的一段\n\n认真辨认，并不需要抢着得出结论。\n\n", count: 80) + "GET385-LONG-END", status: "completed")]
        let host = UIHostingController(rootView: NavigationStack {
            ChatConversationView(tools: tools, cloud: nil, bookTitle: "", source: "", load: { await Task.yield(); tools.turns = turns }, send: {})
        })
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene); window.frame = CGRect(x: 0, y: 0, width: 402, height: 874)
        window.rootViewController = host; window.makeKeyAndVisible(); host.view.frame = window.bounds
        defer { window.isHidden = true; window.rootViewController = nil }
        func views(_ view: UIView) -> [UITextView] { (view as? UITextView).map { [$0] } ?? [] + view.subviews.flatMap(views) }
        var latest: UITextView?
        for _ in 0..<100 {
            host.view.layoutIfNeeded()
            latest = views(host.view).first { $0.text.contains("GET385-LONG-END") }
            if let latest, latest.convert(latest.bounds, to: host.view).intersects(host.view.bounds) { break }
            try await Task.sleep(for: .milliseconds(20))
        }
        let live = try XCTUnwrap(latest, "Cold-loading a long answer must not cull all native message views")
        XCTAssertTrue(live.convert(live.bounds, to: host.view).intersects(host.view.bounds))
        XCTAssertEqual(tools.turns.count, 5)
    }

    func testNarrowComparisonKeepsEachHeaderBesideItsValue() throws {
        let source = "| 序号 | 动作 | 时长 | 要点 | 回望 |\n|---|---|---|---|---|\n| 01 | 合上书，去倒水 | 三分钟 | 让眼睛离开纸面 | 回来时常常发现问题没那么大 |\n| 02 | 把疑问抄在页边 | 五分钟 | 不要求自己组织成完整句子 | 半年后重读，会看见自己变过的痕迹 |"
        let display = ChatMarkdownView.render(source, width: 250, category: .accessibilityExtraExtraExtraLarge)
        XCTAssertTrue(display.string.contains("动作：合上书，去倒水"), "A narrow table must preserve header/value associations instead of wrapping unrelated columns together")
        XCTAssertTrue(display.string.contains("时长：五分钟"))
        XCTAssertTrue(display.string.contains("回来时常常发现问题没那么大"))
        XCTAssertTrue(display.string.contains("半年后重读，会看见自己变过的痕迹"))
        XCTAssertFalse(display.string.contains("\t"))
    }

    func testHeadingsScaleOnlyOnceAtTheActualAccessibilityCategory() throws {
        let category = UIContentSizeCategory.accessibilityExtraExtraExtraLarge
        UITraitCollection(preferredContentSizeCategory: category).performAsCurrent {
            for level in 1...6 {
                let text = ChatMarkdownView.render(String(repeating: "#", count: level) + " 中英 Heading\n\n普通正文 body", width: 300, category: category)
                let heading = text.attribute(.font, at: 0, effectiveRange: nil) as? UIFont
                let bodyRange = (text.string as NSString).range(of: "普通正文")
                let body = text.attribute(.font, at: bodyRange.location, effectiveRange: nil) as? UIFont
                XCTAssertNotNil(heading); XCTAssertNotNil(body)
                if let heading, let body { XCTAssertLessThanOrEqual(heading.pointSize, body.pointSize * 1.5, "Headings must not apply accessibility scaling to an already scaled font") }
            }
        }
    }

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
        XCTAssertEqual(body.pointSize, UIFont.preferredFont(forTextStyle: .body).pointSize)
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
        XCTAssertEqual(accessibleFont.pointSize, UIFont.preferredFont(forTextStyle: .body,
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
