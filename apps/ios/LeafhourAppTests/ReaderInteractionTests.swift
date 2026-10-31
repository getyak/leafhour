import XCTest
import AVFoundation
import SwiftUI
import UIKit
import LeafhourCore
@testable import Leafhour

@MainActor
final class ReaderInteractionTests: XCTestCase {
    private func session(source: String = "A quiet passage to read aloud.", filename: String = "reader.txt") async throws -> ReaderSession {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent(filename)
        try Data(source.utf8).write(to: file)
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .device)
        let book = try await library.importFile(file)
        return ReaderSession(book: book, state: try await library.state(book.id), original: try await library.originalURL(book.id), directory: try await library.bookDirectory(book.id), library: library)
    }

    func testCompanionComposerIsVisibleWithoutScrollingLongHistory() async throws {
        try await assertCompanionComposerVisible(dynamicType: .large)
    }

    func testCompanionComposerRemainsVisibleAtAccessibilityTextSize() async throws {
        try await assertCompanionComposerVisible(dynamicType: .accessibility3)
    }

    private func assertCompanionComposerVisible(dynamicType: DynamicTypeSize) async throws {
        let session = try await session(), tools = ReaderCloudTools()
        let controller = UIHostingController(rootView: NavigationStack {
            ReaderConversationPanel(session: session, tools: tools, cloud: nil)
        }.environment(\.dynamicTypeSize, dynamicType))
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 400))
        window.rootViewController = controller
        window.isHidden = false
        addTeardownBlock { window.isHidden = true; window.rootViewController = nil }
        controller.view.layoutIfNeeded()
        // Let the view's local read complete before supplying a long saved conversation.
        try await Task.sleep(for: .milliseconds(100))
        tools.turns = (0..<30).map { ReaderConversationTurn(id: "saved-\($0)", question: "Question \($0)", answer: String(repeating: "A saved answer. ", count: 20), status: "completed") }
        controller.view.setNeedsLayout()
        controller.view.layoutIfNeeded()
        try await Task.sleep(for: .milliseconds(100))
        controller.view.layoutIfNeeded()
        let field = try XCTUnwrap(descendants(of: controller.view).first {
            $0 is UITextField || ($0 as? UITextView)?.isEditable == true
        }, "The composer must be mounted even when the saved conversation is long")
        let frame = field.convert(field.bounds, to: window)
        XCTAssertGreaterThan(frame.height, 0)
        XCTAssertGreaterThanOrEqual(frame.minY, window.bounds.minY)
        XCTAssertLessThanOrEqual(frame.maxY, window.bounds.maxY, "The input must stay in the visible half sheet, outside scrolling history")
    }

    private func descendants(of view: UIView) -> [UIView] {
        [view] + view.subviews.flatMap { descendants(of: $0) }
    }


    func testStartingAtAMiddleSentenceDoesNotRepeatEarlierSource() async throws {
        let source = "First sentence is already read. Second sentence begins here. Last sentence remains."
        let session = try await session(source: source), synthesizer = SpeechSynthesizerProbe()
        let start = (source as NSString).range(of: "Second").location
        let scalar = SourceTextOffsets(source).scalarOffset(forUTF16Offset: start)
        session.go(to: 0, anchor: ReadingAnchor(chapterID: session.chapter.id, passageID: session.chapter.passages[0].id, characterOffset: scalar))
        let speech = ReaderSpeech(synthesizer: synthesizer, audioSession: SpeechAudioSessionProbe())
        speech.start(session)
        XCTAssertEqual(synthesizer.spoken.first?.speechString, "Second sentence begins here. Last sentence remains.")
    }


    func testActualCallbackAddsTheUtterancePrefixAndRestartsOnlyTheCurrentSentence() async throws {
        let source = "Earlier sentence. Current sentence begins here. Third sentence finishes."
        let session = try await session(source: source), engine = SpeechSynthesizerProbe()
        let start = (source as NSString).range(of: "Current").location
        session.go(to: 0, anchor: ReadingAnchor(chapterID: session.chapter.id, passageID: session.chapter.passages[0].id, characterOffset: SourceTextOffsets(source).scalarOffset(forUTF16Offset: start)))
        let speech = ReaderSpeech(synthesizer: engine, audioSession: SpeechAudioSessionProbe())
        speech.start(session)
        let utterance = try XCTUnwrap(engine.spoken.last)
        let range = (utterance.speechString as NSString).range(of: "Third")
        speech.speechSynthesizer(AVSpeechSynthesizer(), willSpeakRangeOfSpeechString: range, utterance: utterance)
        try await Task.sleep(for: .milliseconds(20))
        XCTAssertEqual(speech.highlight?.wordRange.location, (source as NSString).range(of: "Third").location)
        XCTAssertEqual(speech.activeSentence, "Third sentence finishes.")
        speech.speed = 1.25; speech.restartVoice()
        XCTAssertEqual(engine.spoken.last?.speechString, "Third sentence finishes.")
        speech.speechSynthesizer(AVSpeechSynthesizer(), willSpeakRangeOfSpeechString: NSRange(location: 0, length: 7), utterance: utterance)
        try await Task.sleep(for: .milliseconds(20))
        XCTAssertNil(speech.highlight, "An old utterance must not paint after a voice restart")
        speech.stop(); _ = await session.flush()
    }

    func testPausedProgressSurvivesANewSpeechObjectWithoutReturningToTheViewportParagraph() async throws {
        let session = try await session(source: "First visible paragraph.\n\nSecond paragraph starts. Second paragraph continues."), firstEngine = SpeechSynthesizerProbe()
        let first = ReaderSpeech(synthesizer: firstEngine, audioSession: SpeechAudioSessionProbe())
        first.start(session); first.move(1)
        let utterance = try XCTUnwrap(firstEngine.spoken.last)
        first.speechSynthesizer(AVSpeechSynthesizer(), willSpeakRangeOfSpeechString: (utterance.speechString as NSString).range(of: "continues"), utterance: utterance)
        try await Task.sleep(for: .milliseconds(20)); first.pause(); _ = await session.flush()
        let secondEngine = SpeechSynthesizerProbe(), second = ReaderSpeech(synthesizer: secondEngine, audioSession: SpeechAudioSessionProbe())
        second.start(session)
        XCTAssertEqual(secondEngine.spoken.last?.speechString, "Second paragraph continues.")
        second.stop(); first.stop(); _ = await session.flush()
    }

    func testTranslationStartsFromItsOwnVisibleUTF16Offset() async throws {
        let session = try await session(source: "An original source paragraph."), engine = SpeechSynthesizerProbe()
        let passage = session.chapter.passages[0], translation = "第一句保留。第二句正在阅读。第三句还未开始。"
        var preferences = session.state.preferences; preferences.viewMode = .translation; session.changePreferences(preferences)
        session.updateTranslations([passage.id: ReadingTranslation(original: passage.text, literal: translation, interpretive: "独立意译。")])
        let speech = ReaderSpeech(synthesizer: engine, audioSession: SpeechAudioSessionProbe())
        speech.updateVisible(ReaderSpeechLocation(chapterID: session.chapter.id, passageID: passage.id, layer: "literal", snapshot: translation, utf16Offset: (translation as NSString).range(of: "第二句").location))
        speech.start(session)
        XCTAssertEqual(engine.spoken.last?.speechString, "第二句正在阅读。第三句还未开始。")
        let utterance = try XCTUnwrap(engine.spoken.last)
        speech.speechSynthesizer(AVSpeechSynthesizer(), willSpeakRangeOfSpeechString: NSRange(location: 0, length: 3), utterance: utterance)
        try await Task.sleep(for: .milliseconds(20))
        XCTAssertEqual(speech.highlight?.location.layer, "literal")
        XCTAssertEqual(speech.highlight?.wordRange.location, (translation as NSString).range(of: "第二句").location)
        speech.stop(); _ = await session.flush()
    }

    func testMarkdownSpeechReusesTheChaptersCrossParagraphReferenceRendering() async throws {
        let session = try await session(source: "# Heading\n\nRead the [quiet link][target]. Next sentence.\n\n[target]: https://example.invalid\n", filename: "reader.md"), engine = SpeechSynthesizerProbe()
        let passage = try XCTUnwrap(session.chapter.passages.first { $0.text.contains("quiet link") })
        session.go(to: 0, anchor: ReadingAnchor(chapterID: session.chapter.id, passageID: passage.id))
        let speech = ReaderSpeech(synthesizer: engine, audioSession: SpeechAudioSessionProbe()); speech.start(session)
        let utterance = try XCTUnwrap(engine.spoken.last)
        XCTAssertTrue(utterance.speechString.contains("Read the quiet link."))
        XCTAssertFalse(utterance.speechString.contains("[target]"))
        speech.speechSynthesizer(AVSpeechSynthesizer(), willSpeakRangeOfSpeechString: (utterance.speechString as NSString).range(of: "quiet"), utterance: utterance)
        try await Task.sleep(for: .milliseconds(20))
        XCTAssertEqual(speech.highlight?.wordRange.location, (passage.text as NSString).range(of: "quiet").location)
        speech.stop(); _ = await session.flush()
    }


    func testNaturalAdvanceCrossesAChapterWithoutReenablingManualFollow() async throws {
        let data = Data(#"{"id":"speech-fixture","title":"Book","author":"","kind":"txt","sourceVersion":"v1","originalFilename":"speech.txt","importedAt":0,"chapters":[{"id":"c1","title":"One","sourcePath":"1","passages":[{"id":"p1","text":"First chapter.","heading":false}]},{"id":"c2","title":"Two","sourcePath":"2","passages":[{"id":"p2","text":"Second chapter.","heading":false}]}]}"#.utf8)
        let book = try JSONDecoder().decode(LocalBook.self, from: data)
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let session = ReaderSession(book: book, state: ReaderState(), original: directory.appendingPathComponent("source.txt"), directory: directory, library: SpeechStateStoreProbe())
        let engine = SpeechSynthesizerProbe(), speech = ReaderSpeech(synthesizer: engine, audioSession: SpeechAudioSessionProbe())
        speech.start(session); speech.userNavigated()
        speech.speechSynthesizer(AVSpeechSynthesizer(), didFinish: try XCTUnwrap(engine.spoken.last))
        try await Task.sleep(for: .milliseconds(20))
        XCTAssertEqual(speech.chapterID, "c2"); XCTAssertEqual(engine.spoken.last?.speechString, "Second chapter.")
        XCTAssertTrue(speech.playing); XCTAssertFalse(speech.following)
        speech.stop(); _ = await session.flush()
    }

    func testUnexpectedSystemCancellationPausesInsteadOfPretendingToPlay() async throws {
        let session = try await session(), engine = SpeechSynthesizerProbe(), audio = SpeechAudioSessionProbe()
        let speech = ReaderSpeech(synthesizer: engine, audioSession: audio); speech.start(session)
        speech.speechSynthesizer(AVSpeechSynthesizer(), didCancel: try XCTUnwrap(engine.spoken.last))
        try await Task.sleep(for: .milliseconds(20))
        XCTAssertFalse(speech.playing); XCTAssertTrue(speech.paused); XCTAssertNotNil(speech.message)
        speech.toggle(session); XCTAssertTrue(speech.playing); XCTAssertEqual(engine.spoken.count, 2)
        speech.stop(); _ = await session.flush()
    }


    func testHeadingsKeepTheSameOriginalLayerTheReaderDisplays() throws {
        let passage = try JSONDecoder().decode(Passage.self, from: Data(#"{"id":"h1","text":"Original title","heading":true}"#.utf8))
        let content = ReaderSpeechContent(chapterID: "c1", passage: passage, variant: .literal, translation: ReadingTranslation(original: passage.text, literal: "标题译文"))
        XCTAssertEqual(content.layer, "original"); XCTAssertEqual(content.text, passage.text)
    }

    func testImageOnlyTailDoesNotWrapListeningBackToTheStart() async throws {
        let data = Data(#"{"id":"tail-fixture","title":"Book","author":"","kind":"pdf","sourceVersion":"v1","originalFilename":"speech.pdf","importedAt":0,"chapters":[{"id":"c1","title":"One","sourcePath":"1","passages":[{"id":"p1","text":"Earlier text.","heading":false}]},{"id":"c2","title":"Two","sourcePath":"2","passages":[{"id":"p2","text":"","heading":false}]}]}"#.utf8)
        let book = try JSONDecoder().decode(LocalBook.self, from: data), root = FileManager.default.temporaryDirectory
        let session = ReaderSession(book: book, state: ReaderState(), original: root.appendingPathComponent("isolated-speech.pdf"), directory: root, library: SpeechStateStoreProbe())
        session.go(to: 1)
        let engine = SpeechSynthesizerProbe(), speech = ReaderSpeech(synthesizer: engine, audioSession: SpeechAudioSessionProbe())
        speech.start(session)
        XCTAssertTrue(engine.spoken.isEmpty); XCTAssertFalse(speech.playing); XCTAssertNotNil(speech.message)
        XCTAssertEqual(session.chapterIndex, 1)
        _ = await session.flush()
    }

    func testChangedMarkdownDisplayStopsTheOldUtteranceEvenWhenRawSourceIsUnchanged() async throws {
        let session = try await session(source: "The **quiet** orchard stays.\n\nAnother source paragraph.", filename: "reader.md"), engine = SpeechSynthesizerProbe()
        var preferences = session.state.preferences; preferences.viewMode = .parallel; session.changePreferences(preferences)
        let speech = ReaderSpeech(synthesizer: engine, audioSession: SpeechAudioSessionProbe()); speech.start(session)
        XCTAssertFalse(try XCTUnwrap(engine.spoken.last).speechString.contains("**"))
        let other = session.chapter.passages[1]
        session.updateTranslations([other.id: ReadingTranslation(original: other.text, literal: "另一段译文", interpretive: "独立意译")])
        speech.contentChanged()
        XCTAssertFalse(speech.playing); XCTAssertNotNil(speech.message)
        _ = await session.flush()
    }


    func testStartingOnAnImageOnlyMovesForwardWithinItsChapter() async throws {
        for hasLaterText in [false, true] {
            var rows: [[String: Any]] = [["id": "p1", "text": "Earlier text.", "heading": false], ["id": "image", "text": "", "heading": false, "resourcePath": "picture.png"]]
            if hasLaterText { rows.append(["id": "p3", "text": "Later text.", "heading": false]) }
            let value: [String: Any] = ["id":"image-fixture", "title":"Book", "author":"", "kind":"txt", "sourceVersion":"v1", "originalFilename":"fixture.txt", "importedAt":0, "chapters":[["id":"c1", "title":"One", "sourcePath":"1", "passages": rows]]]
            let book = try JSONDecoder().decode(LocalBook.self, from: JSONSerialization.data(withJSONObject: value)), root = FileManager.default.temporaryDirectory
            let session = ReaderSession(book: book, state: ReaderState(), original: root.appendingPathComponent("isolated-image.txt"), directory: root, library: SpeechStateStoreProbe())
            session.go(to: 0, anchor: ReadingAnchor(chapterID: "c1", passageID: "image"))
            let engine = SpeechSynthesizerProbe(), speech = ReaderSpeech(synthesizer: engine, audioSession: SpeechAudioSessionProbe())
            speech.start(session)
            XCTAssertEqual(engine.spoken.last?.speechString, hasLaterText ? "Later text." : nil)
            speech.stop(); _ = await session.flush()
        }
    }

    func testPauseBeforeTheSynthesizerIsReadyStillWaitsForExplicitResume() async throws {
        let session = try await session(), synthesizer = SpeechSynthesizerProbe(), audio = SpeechAudioSessionProbe()
        synthesizer.pauseAccepted = false
        let speech = ReaderSpeech(synthesizer: synthesizer, audioSession: audio)
        speech.start(session)

        speech.pause()

        XCTAssertTrue(speech.paused, "A system pause rejection must not discard the reader's pause intent")
        XCTAssertFalse(speech.playing)
        XCTAssertEqual(audio.activations.last, false)
        XCTAssertEqual(synthesizer.spoken.count, 1)
        speech.speed = 1.5
        speech.restartVoice()
        XCTAssertEqual(synthesizer.spoken.count, 1)
        speech.toggle(session)
        XCTAssertTrue(speech.playing)
        XCTAssertEqual(synthesizer.spoken.count, 2)
        XCTAssertEqual(synthesizer.continuations, 0, "A rejected system pause needs a fresh utterance only after explicit resume")
    }

    func testLateFinishAfterPauseDoesNotAdvanceToTheNextPassage() async throws {
        let session = try await session(source: "First passage stays paused.\n\nSecond passage must not start."), synthesizer = SpeechSynthesizerProbe(), audio = SpeechAudioSessionProbe()
        let speech = ReaderSpeech(synthesizer: synthesizer, audioSession: audio)
        speech.start(session)
        let first = try XCTUnwrap(synthesizer.spoken.first)
        speech.pause()

        speech.speechSynthesizer(AVSpeechSynthesizer(), didFinish: first)
        try await Task.sleep(for: .milliseconds(30))

        XCTAssertEqual(speech.position, 0)
        XCTAssertEqual(synthesizer.spoken.count, 1, "A finish callback queued before pause must not start the next passage")
        XCTAssertTrue(speech.paused)
        XCTAssertFalse(speech.playing)
        speech.toggle(session)
        XCTAssertEqual(synthesizer.spoken.count, 2)
        XCTAssertEqual(synthesizer.spoken.last?.speechString, "First passage stays paused.")
        XCTAssertTrue(speech.playing)
    }

    func testChangingSpeedWhilePausedWaitsForExplicitResume() async throws {
        let session = try await session(), synthesizer = SpeechSynthesizerProbe(), audio = SpeechAudioSessionProbe()
        let speech = ReaderSpeech(synthesizer: synthesizer, audioSession: audio)
        speech.start(session)
        speech.pause()
        let activations = audio.activations.filter { $0 }.count

        speech.speed = 1.5
        speech.restartVoice()

        XCTAssertTrue(speech.paused)
        XCTAssertFalse(speech.playing)
        XCTAssertEqual(synthesizer.spoken.count, 1, "Changing a paused preference must not enqueue speech")
        XCTAssertEqual(audio.activations.filter { $0 }.count, activations)

        speech.toggle(session)

        XCTAssertTrue(speech.playing)
        XCTAssertFalse(speech.paused)
        XCTAssertEqual(synthesizer.spoken.count, 2)
        XCTAssertEqual(synthesizer.spoken.last?.rate ?? 0, AVSpeechUtteranceDefaultSpeechRate * 1.5, accuracy: 0.001)
        XCTAssertEqual(synthesizer.continuations, 0, "Resume must rebuild the passage with the chosen speed")
    }

    func testChangingVoiceWhilePausedWaitsForExplicitResume() async throws {
        let session = try await session(), synthesizer = SpeechSynthesizerProbe(), audio = SpeechAudioSessionProbe()
        let speech = ReaderSpeech(synthesizer: synthesizer, audioSession: audio)
        speech.start(session)
        speech.pause()
        let voice = try XCTUnwrap(speech.voices.first)

        speech.voiceID = voice.identifier
        speech.restartVoice()

        XCTAssertTrue(speech.paused)
        XCTAssertFalse(speech.playing)
        XCTAssertEqual(synthesizer.spoken.count, 1)
        speech.toggle(session)
        XCTAssertEqual(synthesizer.spoken.count, 2)
        XCTAssertEqual(synthesizer.spoken.last?.voice?.identifier, voice.identifier)
        XCTAssertTrue(speech.playing)
    }

    func testResumeWithoutPreferenceChangesContinuesPausedUtterance() async throws {
        let session = try await session(), synthesizer = SpeechSynthesizerProbe(), audio = SpeechAudioSessionProbe()
        let speech = ReaderSpeech(synthesizer: synthesizer, audioSession: audio)
        speech.start(session)
        speech.pause()
        speech.toggle(session)
        XCTAssertEqual(synthesizer.spoken.count, 1)
        XCTAssertEqual(synthesizer.continuations, 1)
        XCTAssertTrue(speech.playing)
        XCTAssertFalse(speech.paused)
    }

    func testChangingPreferencesDuringPlaybackRestartsWithNewSpeed() async throws {
        let session = try await session(), synthesizer = SpeechSynthesizerProbe(), audio = SpeechAudioSessionProbe()
        let speech = ReaderSpeech(synthesizer: synthesizer, audioSession: audio)
        speech.start(session)
        speech.speed = 1.25
        speech.restartVoice()
        XCTAssertEqual(synthesizer.spoken.count, 2)
        XCTAssertEqual(synthesizer.spoken.last?.rate ?? 0, AVSpeechUtteranceDefaultSpeechRate * 1.25, accuracy: 0.001)
        XCTAssertTrue(speech.playing)
        XCTAssertFalse(speech.paused)
    }
}

@MainActor
private final class SpeechSynthesizerProbe: ReaderSpeechSynthesizing {
    weak var delegate: (any AVSpeechSynthesizerDelegate)?
    var spoken: [AVSpeechUtterance] = []
    var continuations = 0
    var pauseAccepted = true
    func speak(_ utterance: AVSpeechUtterance) { spoken.append(utterance) }
    func stopSpeaking(at boundary: AVSpeechBoundary) -> Bool { true }
    func pauseSpeaking(at boundary: AVSpeechBoundary) -> Bool { pauseAccepted }
    func continueSpeaking() -> Bool { continuations += 1; return true }
}

@MainActor
private final class SpeechAudioSessionProbe: ReaderSpeechAudioSession {
    var activations: [Bool] = []
    func setCategory(_ category: AVAudioSession.Category, mode: AVAudioSession.Mode, options: AVAudioSession.CategoryOptions) throws { }
    func setActive(_ active: Bool, options: AVAudioSession.SetActiveOptions) throws { activations.append(active) }
}

private actor SpeechStateStoreProbe: ReaderStateStore {
    func saveState(_ state: ReaderState, bookID: String) async throws { }
}
