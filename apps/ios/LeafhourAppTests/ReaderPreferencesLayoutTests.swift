import XCTest
import SwiftUI
import UIKit
import LeafhourCore
@testable import Leafhour

@MainActor
final class ReaderPreferencesLayoutTests: XCTestCase {
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
