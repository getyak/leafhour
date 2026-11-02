import XCTest
import SwiftUI
import UIKit
import CoreText
import LeafhourCore
@testable import Leafhour

@MainActor
final class ReaderPreferencesLayoutTests: XCTestCase {
    func testBookLanguageSettingsAndIndentChoicesAtNormalAndLargeType() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("Synthetic.txt"); try Data("    这是一段用于排版验收的原创文字。阅读仍从原文出发。".utf8).write(to: file)
        let library = try OfflineLibrary(root: root, scope: .device), book = try await library.importFile(file)
        let session = ReaderSession(book: book, state: try await library.state(book.id), original: file, directory: root, library: library)
        for size in [DynamicTypeSize.large, .accessibility5] {
            let view = NavigationStack { Form { ReaderBookLanguageChoices(session: session); ReadingAppearanceControls(preferences: Binding(get: { session.state.preferences }, set: { session.changePreferences($0) })) }.navigationTitle("阅读设置") }.environment(\.dynamicTypeSize, size)
            let controller = UIHostingController(rootView: view), window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
            window.rootViewController = controller; window.makeKeyAndVisible(); controller.view.frame = window.bounds
            try await Task.sleep(for: .milliseconds(150)); controller.view.layoutIfNeeded()
            let image = UIGraphicsImageRenderer(size: window.bounds.size).image { _ in _ = controller.view.drawHierarchy(in: controller.view.bounds, afterScreenUpdates: true) }
            let attachment = XCTAttachment(image: image); attachment.name = "Book language and indentation · " + String(describing: size); attachment.lifetime = .keepAlways; add(attachment)
            XCTAssertEqual(session.translationSettings.targetLanguage, .en)
            window.isHidden = true; window.rootViewController = nil
        }
    }
    func testMixedTextUsesSelectedLatinAndChineseGlyphs() throws {
        for (style, chinese) in [(ReaderFontStyle.serif, "NotoSerif"), (.kai, "LXGWWenKai"), (.sans, "PingFang")] {
            let font = ReaderTypography.font(style: style, size: 22, traits: UITraitCollection(preferredContentSizeCategory: .large), latin: .baskerville)
            let line = CTLineCreateWithAttributedString(NSAttributedString(string: "Hello 永远阅读", attributes: [.font: font]))
            let runs = CTLineGetGlyphRuns(line) as! [CTRun]
            let names = runs.map { run -> String in
                let attributes = CTRunGetAttributes(run) as NSDictionary
                let actual = attributes[kCTFontAttributeName] as! CTFont
                return CTFontCopyPostScriptName(actual) as String
            }
            XCTAssertTrue(names.contains { $0.contains("Baskerville") }, "Actual Latin glyph font: \(names)")
            XCTAssertTrue(names.contains { $0.localizedCaseInsensitiveContains(chinese) }, "Actual Chinese glyph font for \(style): \(names)")
        }
        for family in ReaderLatinFont.allCases {
            let regular = ReaderTypography.font(style: .serif, size: 22, traits: UITraitCollection(preferredContentSizeCategory: .large), latin: family)
            let large = ReaderTypography.font(style: .serif, size: 22, traits: UITraitCollection(preferredContentSizeCategory: .accessibilityExtraExtraExtraLarge), latin: family)
            XCTAssertGreaterThan(large.pointSize, regular.pointSize)
        }
    }

    func testChineseMarkdownEmphasisSurvivesTheExplicitCascade() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let original = root.appendingPathComponent("emphasis.md")
        try "正文与**粗体**，以及*斜体*。".write(to: original, atomically: true, encoding: .utf8)
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .device)
        let book = try await library.importFile(original)
        let layout = MarkdownChapterLayout(book: book, chapter: book.chapters[0], original: original)
        for style in [ReaderFontStyle.serif, .kai, .sans] {
            let font = ReaderTypography.font(style: style, size: 24, traits: UITraitCollection(preferredContentSizeCategory: .large))
            let output = layout.attributed(font: font, size: 24, lineSpacing: 9)
            let bold = (output.string as NSString).range(of: "粗体")
            XCTAssertEqual(output.attribute(.strokeWidth, at: bold.location, effectiveRange: nil) as? Double, -2)
            let italic = (output.string as NSString).range(of: "斜体")
            XCTAssertEqual(output.attribute(.obliqueness, at: italic.location, effectiveRange: nil) as? Double, 0.15)
            let emphasized = output.attributedSubstring(from: bold)
            let plain = NSAttributedString(string: "粗体", attributes: [.font: font, .foregroundColor: UIColor.label])
            func pixels(_ text: NSAttributedString) -> Data? {
                UIGraphicsImageRenderer(size: CGSize(width: 150, height: 60)).image { context in
                    UIColor.white.setFill(); context.fill(CGRect(x: 0, y: 0, width: 150, height: 60))
                    text.draw(at: CGPoint(x: 5, y: 5))
                }.pngData()
            }
            XCTAssertNotEqual(pixels(emphasized), pixels(plain), "Actual Chinese emphasis must draw differently for \(style)")
        }
    }

    func testEveryPaperExplicitlyControlsForegroundAppearance() {
        for paper in ReaderPaper.allCases {
            var value = ReaderPreferences(); value.theme = paper.rawValue
            XCTAssertEqual(value.colorScheme(following: .dark), paper == .system || paper.isDark ? .dark : .light)
            XCTAssertEqual(value.colorScheme(following: .light), paper.isDark ? .dark : .light)
        }
    }

    private let sample = "The quiet orchard stays beside the river while a reader changes the type size."

    private func renderedSize(text: String, fontSize: Double, typeSize: DynamicTypeSize) throws -> CGSize {
        let preview = ReaderPreferencesPanel.TypographyPreview(text: text, fontSize: fontSize, lineSpacing: 9)
            .frame(width: 320)
            .environment(\.dynamicTypeSize, typeSize)
        let renderer = ImageRenderer(content: preview)
        return try XCTUnwrap(renderer.uiImage, "Render the actual SwiftUI preview at the requested type size").size
    }

    func testPreviewSupportsSystemTypeWhileKeepingTheChosenBaseSize() throws {
        for baseSize in [16.0, 36.0] {
            let small = try renderedSize(text: sample, fontSize: baseSize, typeSize: .xSmall)
            let regular = try renderedSize(text: sample, fontSize: baseSize, typeSize: .large)
            let accessible = try renderedSize(text: sample, fontSize: baseSize, typeSize: .accessibility5)
            XCTAssertGreaterThan(regular.height, small.height, "A chosen base size must still follow the system type preference")
            XCTAssertGreaterThan(accessible.height, regular.height, "The largest accessibility size must grow the actual rendered preview")
        }
        for typeSize in [DynamicTypeSize.xSmall, .large, .accessibility5] {
            let smaller = try renderedSize(text: sample, fontSize: 16, typeSize: typeSize)
            let larger = try renderedSize(text: sample, fontSize: 36, typeSize: typeSize)
            XCTAssertGreaterThan(larger.height, smaller.height, "Changing the reader's base size must still change the preview")
        }
    }

    func testWholePreviewCanGrowPastFourLinesAtTheLargestTypeSize() throws {
        let short = try renderedSize(text: sample, fontSize: 22, typeSize: .accessibility5)
        let longer = try renderedSize(text: sample + " " + sample, fontSize: 22, typeSize: .accessibility5)
        XCTAssertGreaterThan(longer.height, short.height * 1.5, "Additional original text must receive layout space instead of a fixed-height or four-line truncation")
    }
    func testGlobalStyleReentryReadsTheReadersNewPreferences() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = try LeafhourCore.OfflineLibrary(root: root, scope: .device)
        let style = ReadingStyleModel()
        await style.load(library)
        var first = style.preferences; first.theme = "sage"; style.update(first)
        await style.load(library)
        var reader = style.preferences; reader.theme = "night"; reader.fontSize = 30; reader.navigationMode = .scroll
        try await library.saveReaderPreferences(reader)
        await style.load(library)
        XCTAssertEqual(style.preferences, reader)
        var changed = style.preferences; changed.fontSize = 24; style.update(changed)
        await style.load(library)
        XCTAssertEqual(style.preferences.theme, "night")
        XCTAssertEqual(style.preferences.navigationMode, .scroll)
        XCTAssertEqual(style.preferences.fontSize, 24)
    }

}
