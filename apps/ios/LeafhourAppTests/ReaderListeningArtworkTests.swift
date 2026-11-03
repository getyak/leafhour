import XCTest
import UIKit
import LeafhourCore
@testable import Leafhour

@MainActor final class ReaderListeningArtworkTests: XCTestCase {
    func testRealCoverKeepsTopAndBottomOnSquarePaperRatherThanCroppingToFill() throws {
        let format = UIGraphicsImageRendererFormat(); format.scale = 1; format.opaque = true
        let cover = UIGraphicsImageRenderer(size: CGSize(width: 200, height: 400), format: format).image { context in
            UIColor.red.setFill(); context.fill(CGRect(x: 0, y: 0, width: 200, height: 100))
            UIColor.green.setFill(); context.fill(CGRect(x: 0, y: 100, width: 200, height: 200))
            UIColor.blue.setFill(); context.fill(CGRect(x: 0, y: 300, width: 200, height: 100))
        }
        var preferences = ReaderPreferences(); preferences.theme = "paper"
        let image = ReaderListeningArtwork.render(title: "Actual cover", author: "Actual author", cover: cover, preferences: preferences)
        XCTAssertEqual(image.size, CGSize(width: 1024, height: 1024))
        XCTAssertEqual(image.cgImage?.width, 1024); XCTAssertEqual(image.cgImage?.height, 1024)
        assertColor(try pixel(image, x: 512, y: 100), [255, 0, 0, 255])
        assertColor(try pixel(image, x: 512, y: 512), [0, 255, 0, 255])
        assertColor(try pixel(image, x: 512, y: 920), [0, 0, 255, 255])
        assertColor(try pixel(image, x: 80, y: 512), [247, 245, 235, 255])
        // Visual acceptance samples use invented metadata, never a user book.
        for paper in ["paper", "night"] {
            var sample = ReaderPreferences(); sample.theme = paper
            let artwork = ReaderListeningArtwork.render(title: "A Quiet Walk", author: "演示文本", cover: nil, preferences: sample)
            let attachment = XCTAttachment(image: artwork)
            attachment.name = "Lockscreen fallback design · " + paper
            attachment.lifetime = .keepAlways; add(attachment)
        }

    }

    func testFallbackUsesActualLongUnicodeTitleAndAuthorWithinPaperSafeArea() throws {
        var preferences = ReaderPreferences(); preferences.theme = "night"; preferences.fontStyle = .serif
        let title = String(repeating: "夜读 👩🏽‍💻 café e\u{301} 与书页之间 ", count: 8)
        let first = ReaderListeningArtwork.render(title: title + "终", author: "真实作者", cover: nil, preferences: preferences)
        let changedTitle = ReaderListeningArtwork.render(title: title + "章", author: "真实作者", cover: nil, preferences: preferences)
        let changedAuthor = ReaderListeningArtwork.render(title: title + "终", author: "另一作者", cover: nil, preferences: preferences)
        XCTAssertEqual(first.size, CGSize(width: 1024, height: 1024))
        XCTAssertNotEqual(first.pngData(), changedTitle.pngData(), "The end of a long Unicode title remains visible rather than being silently clipped")
        XCTAssertNotEqual(first.pngData(), changedAuthor.pngData(), "Fallback artwork identifies the real author")
        for point in [(16, 16), (1008, 16), (16, 1008), (1008, 1008), (16, 512), (1008, 512)] {
            assertColor(try pixel(first, x: point.0, y: point.1), [31, 31, 31, 255])
        }
        let attachment = XCTAttachment(image: first)
        attachment.name = "Listening artwork long Unicode fallback"; attachment.lifetime = .keepAlways; add(attachment)
    }

    func testLandscapeCoverRetainsBothEndsAndDoesNotAddTypographicTitleOverRealCover() throws {
        let format = UIGraphicsImageRendererFormat(); format.scale = 1; format.opaque = true
        let cover = UIGraphicsImageRenderer(size: CGSize(width: 400, height: 200), format: format).image { context in
            UIColor.red.setFill(); context.fill(CGRect(x: 0, y: 0, width: 200, height: 200))
            UIColor.blue.setFill(); context.fill(CGRect(x: 200, y: 0, width: 200, height: 200))
        }
        let preferences = ReaderPreferences()
        let first = ReaderListeningArtwork.render(title: "First title", author: "Author", cover: cover, preferences: preferences)
        let second = ReaderListeningArtwork.render(title: "Changed title", author: nil, cover: cover, preferences: preferences)
        XCTAssertEqual(first.pngData(), second.pngData(), "An actual cover is preserved without competing title artwork")
        assertColor(try pixel(first, x: 100, y: 512), [255, 0, 0, 255])
        assertColor(try pixel(first, x: 920, y: 512), [0, 0, 255, 255])
        assertColor(try pixel(first, x: 512, y: 80), [247, 245, 235, 255])
    }

    private func pixel(_ image: UIImage, x: Int, y: Int) throws -> [UInt8] {
        let source = try XCTUnwrap(image.cgImage?.cropping(to: CGRect(x: x, y: y, width: 1, height: 1)))
        var bytes = [UInt8](repeating: 0, count: 4)
        try bytes.withUnsafeMutableBytes { buffer in
            let context = try XCTUnwrap(CGContext(data: buffer.baseAddress, width: 1, height: 1, bitsPerComponent: 8,
                bytesPerRow: 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
            context.draw(source, in: CGRect(x: 0, y: 0, width: 1, height: 1))
        }
        return bytes
    }
    private func assertColor(_ actual: [UInt8], _ expected: [UInt8], file: StaticString = #filePath, line: UInt = #line) {
        for index in 0..<4 { XCTAssertEqual(Double(actual[index]), Double(expected[index]), accuracy: 2, file: file, line: line) }
    }
}
