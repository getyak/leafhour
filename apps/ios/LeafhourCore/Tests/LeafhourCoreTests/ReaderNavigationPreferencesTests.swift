import XCTest
@testable import LeafhourCore

final class ReaderNavigationPreferencesTests: XCTestCase {
    func testLegacyPreferencesKeepTypographyAndDefaultToScroll() throws {
        let data = Data(#"{"fontSize":28,"lineSpacing":12,"theme":"night"}"#.utf8)
        let value = try JSONDecoder().decode(ReaderPreferences.self, from: data)
        XCTAssertEqual(value.fontSize, 28)
        XCTAssertEqual(value.lineSpacing, 12)
        XCTAssertEqual(value.theme, "night")
        XCTAssertEqual(value.navigationMode, .scroll)
    }
    func testPagedPreferenceRoundTripsWithTheWholeReadingState() throws {
        var state = ReaderState()
        let anchor = ReadingAnchor(chapterID: "chapter", passageID: "paragraph", characterOffset: 8)
        state.anchor = anchor
        state.notes = [ReaderNote(anchor: anchor, quote: "原文", body: "保留的笔记")]
        state.drafts[anchor.key] = NoteDraft(anchor: anchor, quote: "原文", body: "未完成")
        state.preferences.navigationMode = .paged
        let restored = try JSONDecoder().decode(ReaderState.self, from: JSONEncoder().encode(state))
        XCTAssertEqual(restored, state)
    }
    func testUnknownFutureNavigationModeDoesNotDiscardReadingRecords() throws {
        let data = Data(#"{"fontSize":22,"lineSpacing":9,"theme":"paper","navigationMode":"future-mode"}"#.utf8)
        XCTAssertEqual(try JSONDecoder().decode(ReaderPreferences.self, from: data).navigationMode, .scroll)
    }
}
