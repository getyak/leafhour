import XCTest
import AVFoundation
import LeafhourCore
@testable import Leafhour

@MainActor
final class ReaderInteractionTests: XCTestCase {
    private func session() async throws -> ReaderSession {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("reader.txt")
        try Data("A quiet passage to read aloud.".utf8).write(to: file)
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .device)
        let book = try await library.importFile(file)
        return ReaderSession(book: book, state: try await library.state(book.id), original: try await library.originalURL(book.id), directory: try await library.bookDirectory(book.id), library: library)
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
    func speak(_ utterance: AVSpeechUtterance) { spoken.append(utterance) }
    func stopSpeaking(at boundary: AVSpeechBoundary) -> Bool { true }
    func pauseSpeaking(at boundary: AVSpeechBoundary) -> Bool { true }
    func continueSpeaking() -> Bool { continuations += 1; return true }
}

@MainActor
private final class SpeechAudioSessionProbe: ReaderSpeechAudioSession {
    var activations: [Bool] = []
    func setCategory(_ category: AVAudioSession.Category, mode: AVAudioSession.Mode, options: AVAudioSession.CategoryOptions) throws { }
    func setActive(_ active: Bool, options: AVAudioSession.SetActiveOptions) throws { activations.append(active) }
}
