import XCTest
@testable import LeafhourCore

final class ReaderNavigationPreferencesTests: XCTestCase {
    func testListeningComparisonDefaultsOnAndPersistsWithoutChangingReadingLayer() throws {
        var preferences = try JSONDecoder().decode(ReaderPreferences.self, from: Data("{}".utf8))
        XCTAssertTrue(preferences.listeningShowsComparison)
        preferences.listeningShowsComparison = false
        let restored = try JSONDecoder().decode(ReaderPreferences.self, from: JSONEncoder().encode(preferences))
        XCTAssertFalse(restored.listeningShowsComparison)
        XCTAssertEqual(restored.viewMode, .source)
    }
    func testInteractionPreferencesPersistAndLegacyDefaultsStayQuietAndImmediate() throws {
        for (json, delay, progress) in [("{}", 0.0, false), (#"{"pageTapDelay":0.15,"alwaysShowReadingProgress":true}"#, 0.15, true)] {
            let decoded = try JSONDecoder().decode(ReaderPreferences.self, from: Data(json.utf8))
            let encoded = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(decoded)) as? [String: Any])
            XCTAssertEqual(encoded["pageTapDelay"] as? Double, delay)
            XCTAssertEqual(encoded["alwaysShowReadingProgress"] as? Bool, progress)
        }
    }
    func testLegacyPreferencesKeepTypographyAndDefaultToPages() throws {
        let data = Data(#"{"fontSize":28,"lineSpacing":12,"theme":"night"}"#.utf8)
        let value = try JSONDecoder().decode(ReaderPreferences.self, from: data)
        XCTAssertEqual(value.fontSize, 28)
        XCTAssertEqual(value.lineSpacing, 12)
        XCTAssertEqual(value.theme, "night")
        XCTAssertEqual(value.navigationMode, .paged)
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
        XCTAssertEqual(try JSONDecoder().decode(ReaderPreferences.self, from: data).navigationMode, .paged)
    }
    func testPagePresentationDefaultsAndFutureValuesKeepReadingState() throws {
        for json in ["{}", #"{"pageAnimation":"future","pageInput":"future"}"#] {
            let value = try JSONDecoder().decode(ReaderPreferences.self, from: Data(json.utf8))
            XCTAssertEqual(value.pageAnimation, .slide)
            XCTAssertEqual(value.pageInput, .tapAndSwipe)
        }
        for animation in ReaderPageAnimation.allCases {
            for input in ReaderPageInput.allCases {
                var state = ReaderState(); state.preferences.pageAnimation = animation; state.preferences.pageInput = input
                XCTAssertEqual(try JSONDecoder().decode(ReaderState.self, from: JSONEncoder().encode(state)), state)
                XCTAssertEqual(input.allowsTap, input != .swipeOnly)
                XCTAssertEqual(input.allowsSwipe, input != .tapOnly)
            }
        }
    }

}
