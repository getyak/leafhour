import Foundation
import XCTest
@testable import LeafhourCore

final class SourceTextOffsetsTests: XCTestCase {
    func testEmptyAndOutOfBoundsOffsetsClamp() {
        for text in ["", "A😀終"] {
            let index = SourceTextOffsets(text)
            XCTAssertEqual(index.scalarOffset(forUTF16Offset: Int.min), 0)
            XCTAssertEqual(index.utf16Offset(forScalarOffset: Int.min), 0)
            XCTAssertEqual(index.scalarOffset(forUTF16Offset: Int.max), text.unicodeScalars.count)
            XCTAssertEqual(index.utf16Offset(forScalarOffset: Int.max), text.utf16.count)
        }
    }
    func testEveryValidUnicodeBoundaryRoundTrips() {
        for source in ["Reading source", "阅读／読書", "e\u{301}🇨🇳👩🏽‍💻𠮷👍🏽\r\n終", "\0\u{202E}עבריתالعربية"] {
            let expected = boundaries(source), index = SourceTextOffsets(source)
            XCTAssertEqual(index.utf16Count, source.utf16.count)
            XCTAssertEqual(index.scalarCount, source.unicodeScalars.count)
            for (scalar, utf16) in expected.enumerated() {
                XCTAssertEqual(index.scalarOffset(forUTF16Offset: utf16), scalar, source)
                XCTAssertEqual(index.utf16Offset(forScalarOffset: scalar), utf16, source)
            }
            for utf16 in 0...source.utf16.count {
                let preceding = expected.lastIndex(where: { $0 <= utf16 })!
                XCTAssertEqual(index.scalarOffset(forUTF16Offset: utf16), preceding, source)
            }
        }
    }
    func testInsideSurrogatePairReturnsItsStartingScalar() {
        let index = SourceTextOffsets("A😀B")
        XCTAssertEqual(index.scalarOffset(forUTF16Offset: 1), 1)
        XCTAssertEqual(index.scalarOffset(forUTF16Offset: 2), 1, "Do not turn half a scalar into a replacement-character offset")
        XCTAssertEqual(index.scalarOffset(forUTF16Offset: 3), 2)
        XCTAssertEqual(index.utf16Offset(forScalarOffset: 2), 3)
    }
    func testCanonicallyEquivalentSourcesStillHaveTheirOwnExactOffsets() {
        let composed = "é", decomposed = "e\u{301}"
        XCTAssertEqual(composed, decomposed)
        let first = SourceTextOffsets(composed), second = SourceTextOffsets(decomposed)
        XCTAssertEqual(first.scalarCount, 1)
        XCTAssertEqual(second.scalarCount, 2)
        XCTAssertEqual(first.utf16Offset(forScalarOffset: 2), 1)
        XCTAssertEqual(second.utf16Offset(forScalarOffset: 2), 2)
    }
    func testLongMixedSourceAcrossManyLookupRegions() {
        let source = String(repeating: "a字😀e\u{301} ", count: 4_000)
        let expected = boundaries(source), index = SourceTextOffsets(source)
        let positions = Array(stride(from: 0, to: expected.count, by: 97)) + [0, 1, 1022, 1023, 1024, 1025, 1028, 2047, 2048, 2049, expected.count - 1]
        for scalar in positions {
            XCTAssertEqual(index.utf16Offset(forScalarOffset: scalar), expected[scalar])
            XCTAssertEqual(index.scalarOffset(forUTF16Offset: expected[scalar]), scalar)
            if scalar + 1 < expected.count && expected[scalar + 1] - expected[scalar] == 2 {
                XCTAssertEqual(index.scalarOffset(forUTF16Offset: expected[scalar] + 1), scalar)
            }
        }
    }
    func testBMPScalarsKeepIdentityIncludingCombiningMarks() {
        let source = String(repeating: "字e\u{301} ", count: 4_000), index = SourceTextOffsets(String(repeating: "字e\u{301} ", count: 4_000))
        XCTAssertEqual(index.utf16Count, index.scalarCount)
        for offset in stride(from: 0, through: source.utf16.count, by: 113) {
            XCTAssertEqual(index.scalarOffset(forUTF16Offset: offset), offset)
            XCTAssertEqual(index.utf16Offset(forScalarOffset: offset), offset)
        }
    }
    func testIndicesBelongToTheOriginalValueAndBridgedStorage() {
        let original = String(repeating: "字😀e\u{301}", count: 600)
        var value = original
        let index = SourceTextOffsets(value)
        value = "A different book"
        let bridged = SourceTextOffsets((original as NSString) as String)
        let expected = boundaries(original)
        for scalar in stride(from: 0, to: expected.count, by: 67) {
            XCTAssertEqual(index.utf16Offset(forScalarOffset: scalar), expected[scalar])
            XCTAssertEqual(bridged.scalarOffset(forUTF16Offset: expected[scalar]), scalar)
        }
        XCTAssertNotEqual(index.scalarCount, value.unicodeScalars.count)
    }
    private func boundaries(_ text: String) -> [Int] {
        var result = [0]
        for scalar in text.unicodeScalars { result.append(result.last! + String(scalar).utf16.count) }
        return result
    }
}
