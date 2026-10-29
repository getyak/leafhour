import XCTest
import SwiftUI
import UIKit
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
}
