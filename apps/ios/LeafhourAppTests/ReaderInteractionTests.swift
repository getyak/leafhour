import XCTest
import AVFoundation
import SwiftUI
import UIKit
import LeafhourCore
@testable import Leafhour

@MainActor
final class ReaderInteractionTests: XCTestCase {
    private func session(source: String = "A quiet passage to read aloud.") async throws -> ReaderSession {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("reader.txt")
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
