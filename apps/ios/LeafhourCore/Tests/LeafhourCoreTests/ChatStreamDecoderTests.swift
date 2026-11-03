import XCTest
@testable import LeafhourCore

final class ChatStreamDecoderTests: XCTestCase {
    func testSplitUTF8AndMultipleFramesKeepOrder() throws {
        var decoder = ChatStreamDecoder()
        let data = Data("{\"type\":\"progress\",\"text\":\"你好😀\"}\n{\"type\":\"result\",\"turn\":{\"id\":\"one\"}}\n".utf8)
        var frames: [CloudJSON] = []
        for byte in data { frames += try decoder.append(Data([byte])) }
        frames += try decoder.finish()
        XCTAssertEqual(frames.count, 2)
        XCTAssertEqual(frames[0]["text"].string, "你好😀")
        XCTAssertEqual(frames[1]["turn"]["id"].string, "one")
    }
    func testFinalLineWithoutNewlineAndBlankKeepalive() throws {
        var decoder = ChatStreamDecoder()
        XCTAssertEqual(try decoder.append(Data("\n\r\n{\"type\":\"result\"}".utf8)), [])
        XCTAssertEqual(try decoder.finish().first?["type"].string, "result")
    }
    func testMalformedAndOversizedFrameFail() throws {
        var decoder = ChatStreamDecoder(maximumFrameBytes: 20)
        XCTAssertThrowsError(try decoder.append(Data(repeating: 97, count: 21)))
        var broken = ChatStreamDecoder()
        XCTAssertThrowsError(try broken.append(Data("not-json\n".utf8)))
    }
}
