import XCTest
import AVFoundation
import MediaPlayer
import SwiftUI
import UIKit
import LeafhourCore
@testable import Leafhour

@MainActor
final class ReaderInteractionTests: XCTestCase {
    func testQuickRecordingCannotStealAReplacementAudioOwner() async throws {
        let session = try await session(), sharedAudio = SpeechAudioSessionProbe()
        let first = ReaderSpeech(synthesizer: SpeechSynthesizerProbe(), audioSession: sharedAudio)
        let second = ReaderSpeech(synthesizer: SpeechSynthesizerProbe(), audioSession: sharedAudio)
        first.start(session)
        let revision = try XCTUnwrap(first.suspendForQuickQuestion())
        second.start(session)
        first.resumeAfterQuickQuestion(revision: revision, session: session)
        XCTAssertFalse(first.playing, "Finishing an old recording must not reclaim a newer playback owner's audio")
        XCTAssertTrue(second.playing)
        first.stop(); second.stop()
    }

    func testQuickRecordingHandoffResumesOnlyItsUnchangedPlayback() async throws {
        let session = try await session(), engine = SpeechSynthesizerProbe()
        let speech = ReaderSpeech(synthesizer: engine, audioSession: SpeechAudioSessionProbe())
        speech.start(session)
        let revision = try XCTUnwrap(speech.suspendForQuickQuestion())
        XCTAssertFalse(speech.playing); XCTAssertTrue(speech.paused)
        NotificationCenter.default.post(name: .leafhourChatMicrophoneWillStart, object: nil)
        speech.resumeAfterQuickQuestion(revision: revision, session: session)
        XCTAssertTrue(speech.playing, "The recorder's duplicate microphone handoff must not revoke our own lease")
        let cancelled = try XCTUnwrap(speech.suspendForQuickQuestion())
        speech.userNavigated()
        speech.resumeAfterQuickQuestion(revision: cancelled, session: session)
        XCTAssertFalse(speech.playing, "An intervening navigation must never resume old playback")
        speech.stop()
    }

    func testQuickRecordingCannotResumeAfterStopOrAnExplicitPause() async throws {
        let session = try await session(), engine = SpeechSynthesizerProbe()
        let speech = ReaderSpeech(synthesizer: engine, audioSession: SpeechAudioSessionProbe())
        for stop in [false, true] {
            speech.start(session)
            let revision = try XCTUnwrap(speech.suspendForQuickQuestion())
            if stop { speech.stop() } else { speech.pause() }
            speech.resumeAfterQuickQuestion(revision: revision, session: session)
            XCTAssertFalse(speech.playing)
        }
        speech.stop()
    }

    func testTranscriptSeekStartsAtTappedSentenceAndRejectsStaleText() async throws {
        let source = "First sentence. Second 🙂 sentence. Third sentence."
        let session = try await session(source: source), engine = SpeechSynthesizerProbe()
        let speech = ReaderSpeech(synthesizer: engine, audioSession: SpeechAudioSessionProbe())
        let passage = try XCTUnwrap(session.chapter.passages.first)
        let originalAnchor = session.currentAnchor
        let location = ReaderSpeechLocation(chapterID: session.chapter.id, passageID: passage.id, layer: "original", snapshot: passage.text, utf16Offset: (passage.text as NSString).range(of: "Second").location + 3)
        XCTAssertTrue(speech.seek(session, to: location))
        XCTAssertEqual(engine.spoken.last?.speechString, "Second 🙂 sentence. Third sentence.")
        let count = engine.spoken.count
        XCTAssertFalse(speech.seek(session, to: .init(chapterID: location.chapterID, passageID: location.passageID, layer: "original", snapshot: "stale text", utf16Offset: 0)))
        XCTAssertEqual(engine.spoken.count, count)
        XCTAssertTrue(speech.playing)
        XCTAssertEqual(session.currentAnchor, originalAnchor, "A listening seek does not write an invented reading position")
        speech.stop()
    }

    func testTranslatedTranscriptSeekUsesItsOwnLayerAndRejectsInvalidOffsets() async throws {
        let session = try await session(), engine = SpeechSynthesizerProbe()
        let passage = try XCTUnwrap(session.chapter.passages.first)
        session.updateTranslations([passage.id: ReadingTranslation(original: passage.text, literal: "第一句。第二句🙂。", interpretive: "另一种译法。")])
        let speech = ReaderSpeech(synthesizer: engine, audioSession: SpeechAudioSessionProbe())
        let text = "第一句。第二句🙂。"
        XCTAssertTrue(speech.seek(session, to: .init(chapterID: session.chapter.id, passageID: passage.id, layer: "literal", snapshot: text, utf16Offset: 4)))
        XCTAssertEqual(speech.layerTitle, "直译")
        XCTAssertEqual(engine.spoken.last?.speechString, "第二句🙂。")
        for offset in [-1, 500, (text as NSString).range(of: "🙂").location + 1] {
            XCTAssertFalse(speech.seek(session, to: .init(chapterID: session.chapter.id, passageID: passage.id, layer: "literal", snapshot: text, utf16Offset: offset)))
        }
        speech.stop()
    }

    func testMissingTranslationFallbackDoesNotChangeTheChosenTranscriptLayer() async throws {
        let session = try await session(source: "First source paragraph.\n\nA paragraph with no translation."), engine = SpeechSynthesizerProbe()
        var preferences = session.state.preferences; preferences.viewMode = .translation; session.changePreferences(preferences)
        let first = session.chapter.passages[0]
        session.updateTranslations([first.id: ReadingTranslation(original: first.text, literal: "第一段的直译。")])
        let speech = ReaderSpeech(synthesizer: engine, audioSession: SpeechAudioSessionProbe())
        speech.start(session); XCTAssertEqual(speech.requestedLayer, "literal")
        speech.move(1); XCTAssertEqual(speech.layer, "original")
        XCTAssertEqual(speech.requestedLayer, "literal", "A missing row must not replace the whole transcript or selection layer")
        speech.stop()
    }

    func testSeekingAnOriginalFallbackRetainsTheConfiguredTranslationForFollowingParagraphs() async throws {
        let session = try await session(source: "Missing translation here.\n\nNext source paragraph."), engine = SpeechSynthesizerProbe()
        var preferences = session.state.preferences; preferences.viewMode = .translation; preferences.translationVariant = .literal
        session.changePreferences(preferences)
        let first = session.chapter.passages[0], next = session.chapter.passages[1]
        session.updateTranslations([next.id: ReadingTranslation(original: next.text, literal: "下一段的直译。")])
        let speech = ReaderSpeech(synthesizer: engine, audioSession: SpeechAudioSessionProbe())
        XCTAssertTrue(speech.seek(session, to: .init(chapterID: session.chapter.id, passageID: first.id, layer: "original", snapshot: first.text, utf16Offset: 0)))
        XCTAssertEqual(speech.layer, "original")
        XCTAssertEqual(speech.requestedLayer, "literal", "A displayed source fallback must not discard the configured narration layer")
        speech.move(1)
        XCTAssertEqual(speech.layer, "literal"); XCTAssertEqual(engine.spoken.last?.speechString, "下一段的直译。")
        speech.releasePresentation(); _ = await session.flush()
    }

    func testSeekingAnExplicitOriginalWithARealTranslationKeepsOriginalNarration() async throws {
        let session = try await session(source: "First source paragraph.\n\nNext source paragraph."), engine = SpeechSynthesizerProbe()
        var preferences = session.state.preferences; preferences.viewMode = .translation; session.changePreferences(preferences)
        let first = session.chapter.passages[0], next = session.chapter.passages[1]
        session.updateTranslations([first.id: ReadingTranslation(original: first.text, literal: "第一段直译。"), next.id: ReadingTranslation(original: next.text, literal: "下一段直译。")])
        let speech = ReaderSpeech(synthesizer: engine, audioSession: SpeechAudioSessionProbe())
        XCTAssertTrue(speech.seek(session, to: .init(chapterID: session.chapter.id, passageID: first.id, layer: "original", snapshot: first.text, utf16Offset: 0)))
        XCTAssertEqual(speech.requestedLayer, "original")
        speech.move(1)
        XCTAssertEqual(speech.layer, "original"); XCTAssertEqual(engine.spoken.last?.speechString, "Next source paragraph.")
        speech.releasePresentation(); _ = await session.flush()
    }

    func testParallelSeekOfAMissingRowRetainsTheActiveTranslatedNarrationLayer() async throws {
        let session = try await session(source: "First source paragraph.\n\nMissing translation here.\n\nLast source paragraph."), engine = SpeechSynthesizerProbe()
        var preferences = session.state.preferences; preferences.viewMode = .parallel; session.changePreferences(preferences)
        let first = session.chapter.passages[0], missing = session.chapter.passages[1], last = session.chapter.passages[2]
        session.updateTranslations([first.id: ReadingTranslation(original: first.text, literal: "第一段直译。"), last.id: ReadingTranslation(original: last.text, literal: "最后一段直译。")])
        let speech = ReaderSpeech(synthesizer: engine, audioSession: SpeechAudioSessionProbe())
        XCTAssertTrue(speech.seek(session, to: .init(chapterID: session.chapter.id, passageID: first.id, layer: "literal", snapshot: "第一段直译。", utf16Offset: 0)))
        XCTAssertTrue(speech.seek(session, to: .init(chapterID: session.chapter.id, passageID: missing.id, layer: "original", snapshot: missing.text, utf16Offset: 0)))
        XCTAssertEqual(speech.requestedLayer, "literal")
        speech.move(1)
        XCTAssertEqual(engine.spoken.last?.speechString, "最后一段直译。")
        speech.releasePresentation(); _ = await session.flush()
    }

    func testTemporarySpeedBoostIsBoundedAndRestoresOnPauseStopAndRelease() async throws {
        let session = try await session(), engine = SpeechSynthesizerProbe()
        let speech = ReaderSpeech(synthesizer: engine, audioSession: SpeechAudioSessionProbe())
        speech.speed = 1.25; speech.start(session)
        speech.beginSpeedBoost(); XCTAssertGreaterThan(speech.speed, 1.25)
        for _ in 0..<30 { speech.increaseSpeedBoost() }
        XCTAssertEqual(speech.speed, 5)
        speech.endSpeedBoost(); XCTAssertEqual(speech.speed, 1.25)
        speech.beginSpeedBoost(); speech.pause(); XCTAssertEqual(speech.speed, 1.25)
        speech.toggle(session); speech.beginSpeedBoost(); speech.stop(); XCTAssertEqual(speech.speed, 1.25)
        XCTAssertEqual(session.state.preferences.speechSpeed, 1, "A temporary boost must not persist")
    }

    func testListeningSpeedSanitizesInvalidValuesAndKeepsTheRequestedEndpoints() {
        let speech = ReaderSpeech(synthesizer: SpeechSynthesizerProbe(), audioSession: SpeechAudioSessionProbe())
        speech.speed = .nan
        XCTAssertEqual(speech.speed, 1)
        speech.speed = -.infinity
        XCTAssertEqual(speech.speed, 1)
        speech.speed = 0.1
        XCTAssertEqual(speech.speed, 0.5)
        speech.speed = 8
        XCTAssertEqual(speech.speed, 5)
        speech.speed = 0.5
        XCTAssertEqual(speech.speed, 0.5)
        speech.speed = 5
        XCTAssertEqual(speech.speed, 5)
    }

    func testBackgroundRestoresBoostAndCheckpointsWithoutPausingAuthorizedOutput() async throws {
        let session = try await session(), engine = ListeningOutputProbe(), audio = SpeechAudioSessionProbe()
        let speech = ReaderSpeech(synthesizer: engine, audioSession: audio)
        speech.speed = 1.25; speech.start(session); engine.output(true)
        XCTAssertEqual(audio.categoryOptions.first, [], "Long-form listening must own primary playback, not duck/mix with another Now Playing app")
        speech.beginSpeedBoost()
        let pauses = engine.pauses, deactivations = audio.activations.filter { !$0 }.count
        speech.applicationDidBackground()
        XCTAssertTrue(speech.playing); XCTAssertTrue(speech.isOutputPlaying); XCTAssertFalse(speech.paused)
        XCTAssertFalse(speech.boosting); XCTAssertEqual(speech.speed, 1.25)
        XCTAssertEqual(engine.pauses, pauses)
        XCTAssertEqual(audio.activations.filter { !$0 }.count, deactivations)
        XCTAssertNotNil(session.state.listeningPosition)
        speech.releasePresentation(); _ = await session.flush()
    }

    func testMediaStateWaitsForPCMOutputAndRemotePlayDoesNotTogglePlayingAudio() async throws {
        let session = try await session(), engine = ListeningOutputProbe()
        let sink = ListeningMediaSink(), commands = ListeningRemoteCommands()
        let center = ReaderNowPlayingCenter(sink: sink, commands: commands)
        let speech = ReaderSpeech(synthesizer: engine, audioSession: SpeechAudioSessionProbe(), nowPlayingCenter: center)
        speech.start(session)
        XCTAssertTrue(speech.playing); XCTAssertFalse(speech.isOutputPlaying)
        XCTAssertEqual(sink.nowPlayingInfo?[MPNowPlayingInfoPropertyPlaybackRate] as? Double, 0)
        engine.output(true)
        XCTAssertTrue(speech.isOutputPlaying)
        XCTAssertEqual(sink.nowPlayingInfo?[MPNowPlayingInfoPropertyPlaybackRate] as? Double, 1)
        let play = try XCTUnwrap(commands.handlers[.play])
        XCTAssertEqual(play(), .success)
        XCTAssertTrue(speech.playing); XCTAssertEqual(engine.pauses, 0)
        XCTAssertEqual(try XCTUnwrap(commands.handlers[.pause])(), .success)
        XCTAssertFalse(speech.playing); XCTAssertTrue(speech.paused)
        XCTAssertEqual(sink.nowPlayingInfo?[MPNowPlayingInfoPropertyPlaybackRate] as? Double, 0)
        XCTAssertEqual(play(), .success)
        XCTAssertTrue(speech.playing); XCTAssertEqual(engine.continuations, 1)
        speech.releasePresentation()
        XCTAssertNil(sink.nowPlayingInfo)
        engine.output(true)
        XCTAssertFalse(speech.isOutputPlaying)
        XCTAssertNil(sink.nowPlayingInfo, "A late engine callback after teardown cannot restore lock-screen identity")
        XCTAssertEqual(play(), .commandFailed)
        _ = await session.flush()
    }

    func testListeningChapterCommandsSkipImageOnlyChaptersAndNeverBecomeParagraphSteps() async throws {
        let data = Data(#"{"id":"chapter-controls","title":"Actual Book","author":"Actual Author","kind":"txt","sourceVersion":"v1","originalFilename":"fixture.txt","importedAt":0,"chapters":[{"id":"c1","title":"One","sourcePath":"1","passages":[{"id":"p1","text":"First chapter starts.","heading":false},{"id":"p2","text":"First chapter continues.","heading":false}]},{"id":"c2","title":"Image only","sourcePath":"2","passages":[{"id":"image","text":"","heading":false,"resourcePath":"image.png"}]},{"id":"c3","title":"Three","sourcePath":"3","passages":[{"id":"p3","text":"Third chapter starts.","heading":false},{"id":"p4","text":"Third chapter continues.","heading":false}]}]}"#.utf8)
        let book = try JSONDecoder().decode(LocalBook.self, from: data), root = FileManager.default.temporaryDirectory
        let session = ReaderSession(book: book, state: ReaderState(), original: root.appendingPathComponent("chapter-controls.txt"), directory: root, library: SpeechStateStoreProbe())
        let engine = ListeningOutputProbe(), sink = ListeningMediaSink(), commands = ListeningRemoteCommands()
        let speech = ReaderSpeech(synthesizer: engine, audioSession: SpeechAudioSessionProbe(), nowPlayingCenter: ReaderNowPlayingCenter(sink: sink, commands: commands))
        speech.start(session); speech.move(1)
        XCTAssertFalse(speech.canPreviousChapter); XCTAssertTrue(speech.canNextChapter)
        XCTAssertEqual(try XCTUnwrap(commands.handlers[.nextChapter])(), .success)
        XCTAssertEqual(speech.chapterID, "c3"); XCTAssertEqual(speech.passageID, "p3")
        XCTAssertEqual(engine.spoken.last?.speechString, "Third chapter starts.")
        XCTAssertTrue(speech.canPreviousChapter); XCTAssertFalse(speech.canNextChapter)
        XCTAssertEqual(sink.nowPlayingInfo?[MPMediaItemPropertyAlbumTitle] as? String, "Three")
        speech.move(1); speech.moveChapter(-1)
        XCTAssertEqual(speech.chapterID, "c1"); XCTAssertEqual(speech.passageID, "p1")
        XCTAssertEqual(session.chapterIndex, 0, "Listening chapter navigation does not write an invented reading position")
        speech.releasePresentation(); _ = await session.flush()
    }

    func testPausedChapterNavigationChangesChapterWithoutStartingAudio() async throws {
        let book = try JSONDecoder().decode(LocalBook.self, from: Data(#"{"id":"paused-chapters","title":"Paused chapters","author":"","kind":"txt","sourceVersion":"v1","originalFilename":"fixture.txt","importedAt":0,"chapters":[{"id":"c1","title":"One","sourcePath":"1","passages":[{"id":"p1","text":"First chapter starts.","heading":false}]},{"id":"c2","title":"Two","sourcePath":"2","passages":[{"id":"p2","text":"Second chapter starts.","heading":false}]}]}"#.utf8))
        let root = FileManager.default.temporaryDirectory
        let session = ReaderSession(book: book, state: ReaderState(), original: root.appendingPathComponent("paused-chapters.txt"), directory: root, library: SpeechStateStoreProbe())
        let engine = ListeningOutputProbe(), audio = SpeechAudioSessionProbe()
        let speech = ReaderSpeech(synthesizer: engine, audioSession: audio)
        speech.start(session); engine.output(true); speech.pause()
        let spoken = engine.spoken.count, activations = audio.activations.filter { $0 }.count

        speech.moveChapter(1)

        XCTAssertEqual(speech.chapterID, "c2"); XCTAssertEqual(speech.passageID, "p2")
        XCTAssertEqual(speech.activeSentence, "Second chapter starts.")
        XCTAssertFalse(speech.playing); XCTAssertTrue(speech.paused); XCTAssertFalse(speech.isOutputPlaying)
        XCTAssertEqual(engine.spoken.count, spoken, "Selecting a chapter while paused must not synthesize or begin playing")
        XCTAssertEqual(audio.activations.filter { $0 }.count, activations, "A paused chapter selection must not claim audio output")
        XCTAssertEqual(engine.continuations, 0)
        XCTAssertEqual(session.state.listeningPosition?.chapterID, "c2", "The paused destination is the next explicit resume position")

        speech.toggle(session)
        XCTAssertTrue(speech.playing); XCTAssertFalse(speech.paused)
        XCTAssertEqual(engine.spoken.last?.speechString, "Second chapter starts.")
        XCTAssertEqual(engine.spoken.count, spoken + 1)
        XCTAssertEqual(engine.continuations, 0, "The previous chapter's paused buffer must not be resumed")
        speech.releasePresentation(); _ = await session.flush()
    }

    func testChapterNavigationFromBrowsedChapterSelectsItsNeighborWithoutPlayingIntermediateChapters() async throws {
        let book = try JSONDecoder().decode(LocalBook.self, from: Data(#"{"id":"browsed-chapters","title":"Browsed chapters","author":"","kind":"txt","sourceVersion":"v1","originalFilename":"fixture.txt","importedAt":0,"chapters":[{"id":"c1","title":"One","sourcePath":"1","passages":[{"id":"p1","text":"First chapter starts.","heading":false}]},{"id":"c2","title":"Two","sourcePath":"2","passages":[{"id":"p2","text":"Second chapter starts.","heading":false}]},{"id":"c3","title":"Three","sourcePath":"3","passages":[{"id":"p3","text":"Third chapter starts.","heading":false}]}]}"#.utf8))
        let root = FileManager.default.temporaryDirectory
        let session = ReaderSession(book: book, state: ReaderState(), original: root.appendingPathComponent("browsed-chapters.txt"), directory: root, library: SpeechStateStoreProbe())
        let engine = ListeningOutputProbe(), audio = SpeechAudioSessionProbe()
        let speech = ReaderSpeech(synthesizer: engine, audioSession: audio)
        speech.start(session)
        XCTAssertEqual(speech.chapterID, "c1")
        XCTAssertEqual(speech.chapterID(adjacentTo: "c3", delta: -1), "c2", "Transport follows the displayed chapter, independently of the audio chapter")
        XCTAssertNil(speech.chapterID(adjacentTo: "c3", delta: 1))
        XCTAssertTrue(speech.selectChapter("c2"))
        XCTAssertEqual(speech.chapterID, "c2"); XCTAssertTrue(speech.playing)
        XCTAssertEqual(engine.spoken.map(\.speechString), ["First chapter starts.", "Second chapter starts."])
        XCTAssertFalse(speech.selectChapter("outside-book"))
        XCTAssertEqual(engine.spoken.count, 2)

        let replacement = ReaderSpeech(synthesizer: ListeningOutputProbe(), audioSession: audio)
        replacement.start(session)
        XCTAssertFalse(speech.selectChapter("c3"), "A superseded reader must not take back another reader's audio through navigation")
        XCTAssertEqual(engine.spoken.count, 2)
        speech.releasePresentation(); replacement.releasePresentation(); _ = await session.flush()
    }

    func testOldReaderTeardownCannotDeactivateAReplacementReadersAudioSession() async throws {
        let session = try await session(), sink = ListeningMediaSink(), commands = ListeningRemoteCommands()
        let center = ReaderNowPlayingCenter(sink: sink, commands: commands), audio = SpeechAudioSessionProbe()
        let firstEngine = ListeningOutputProbe(), secondEngine = ListeningOutputProbe()
        let first = ReaderSpeech(synthesizer: firstEngine, audioSession: audio, nowPlayingCenter: center)
        let second = ReaderSpeech(synthesizer: secondEngine, audioSession: audio, nowPlayingCenter: center)
        first.start(session); second.start(session)
        XCTAssertEqual(firstEngine.pauses, 1, "A replacement must pause the prior PCM before taking the shared audio session")
        XCTAssertFalse(first.playing); XCTAssertTrue(first.paused)
        let deactivations = audio.activations.filter { !$0 }.count
        first.releasePresentation()
        XCTAssertEqual(audio.activations.filter { !$0 }.count, deactivations, "A superseded reader releases its own engine without deactivating the current shared audio session")
        XCTAssertNotNil(sink.nowPlayingInfo)
        second.releasePresentation(); _ = await session.flush()
    }

    func testSupersededReadersLateRateUpdateCannotReclaimNewRemoteCommands() async throws {
        let session = try await session(), sink = ListeningMediaSink(), commands = ListeningRemoteCommands()
        let center = ReaderNowPlayingCenter(sink: sink, commands: commands), audio = SpeechAudioSessionProbe()
        let first = ReaderSpeech(synthesizer: ListeningOutputProbe(), audioSession: audio, nowPlayingCenter: center)
        let second = ReaderSpeech(synthesizer: ListeningOutputProbe(), audioSession: audio, nowPlayingCenter: center)
        first.start(session); second.start(session)
        let currentPlay = try XCTUnwrap(commands.handlers[.play])
        first.speed = 1.5
        XCTAssertEqual(currentPlay(), .success, "A paused former reader's late state or artwork update cannot reclaim the replacement's media session")
        XCTAssertTrue(second.playing)
        first.toggle(session)
        XCTAssertTrue(first.playing); XCTAssertTrue(second.paused)
        XCTAssertEqual(sink.nowPlayingInfo?[MPNowPlayingInfoPropertyPlaybackRate] as? Double, 1.5,
                       "Only explicit resume may take ownership back")
        first.releasePresentation(); second.releasePresentation(); _ = await session.flush()
    }

    func testReleasedArtworkCannotPublishWhenItsOldLoadCompletes() async throws {
        let session = try await session(), loader = SuspendedListeningCoverLoader()
        let engine = ListeningOutputProbe(), sink = ListeningMediaSink(), commands = ListeningRemoteCommands()
        let speech = ReaderSpeech(synthesizer: engine, audioSession: SpeechAudioSessionProbe(), nowPlayingCenter: ReaderNowPlayingCenter(sink: sink, commands: commands), coverLoader: loader)
        let loading = expectation(description: "Isolated cover load starts")
        loader.started = loading
        let preparing = Task { await speech.prepareArtwork(session, cloud: nil, library: nil, traits: UITraitCollection(userInterfaceStyle: .light)) }
        await fulfillment(of: [loading], timeout: 2)
        speech.start(session); speech.releasePresentation()
        let cover = UIGraphicsImageRenderer(size: CGSize(width: 4, height: 8)).image { context in
            UIColor.red.setFill(); context.fill(CGRect(x: 0, y: 0, width: 4, height: 8))
        }
        loader.complete(cover); await preparing.value
        XCTAssertNil(speech.bookCoverImage); XCTAssertNil(speech.lockScreenArtwork)
        XCTAssertNil(sink.nowPlayingInfo)
        XCTAssertFalse(speech.playing)
        _ = await session.flush()
    }

    func testMicrophoneHandoffPausesAndRevokesRemotePlaybackUntilExplicitContinue() async throws {
        let session = try await session(), engine = ListeningOutputProbe(), sink = ListeningMediaSink(), commands = ListeningRemoteCommands()
        let speech = ReaderSpeech(synthesizer: engine, audioSession: SpeechAudioSessionProbe(), nowPlayingCenter: ReaderNowPlayingCenter(sink: sink, commands: commands))
        speech.start(session); engine.output(true)
        let play = try XCTUnwrap(commands.handlers[.play])
        NotificationCenter.default.post(name: .leafhourChatMicrophoneWillStart, object: nil)
        await Task.yield()
        XCTAssertTrue(speech.paused); XCTAssertFalse(speech.playing); XCTAssertFalse(speech.isOutputPlaying)
        XCTAssertNotNil(session.state.listeningPosition)
        XCTAssertNil(sink.nowPlayingInfo)
        XCTAssertEqual(play(), .commandFailed, "An old lock-screen play command cannot take audio back from microphone capture")
        speech.speed = 1.5
        XCTAssertNil(sink.nowPlayingInfo)
        speech.toggle(session)
        XCTAssertTrue(speech.playing)
        XCTAssertEqual(engine.spoken.count, 2, "After handoff, explicit continue rebuilds the saved passage rather than retaining a microphone-competing PCM engine")
        speech.releasePresentation(); _ = await session.flush()
    }

    func testLostAudioRoutePausesWithoutResumingForANewDeviceOrEndedInterruption() async throws {
        let session = try await session(), engine = ListeningOutputProbe()
        let speech = ReaderSpeech(synthesizer: engine, audioSession: SpeechAudioSessionProbe())
        speech.start(session); engine.output(true); speech.beginSpeedBoost()
        NotificationCenter.default.post(name: AVAudioSession.routeChangeNotification, object: nil,
            userInfo: [AVAudioSessionRouteChangeReasonKey: AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue])
        try await Task.sleep(for: .milliseconds(20))
        XCTAssertFalse(speech.playing); XCTAssertTrue(speech.paused); XCTAssertFalse(speech.boosting)
        NotificationCenter.default.post(name: AVAudioSession.routeChangeNotification, object: nil,
            userInfo: [AVAudioSessionRouteChangeReasonKey: AVAudioSession.RouteChangeReason.newDeviceAvailable.rawValue])
        NotificationCenter.default.post(name: AVAudioSession.interruptionNotification, object: nil,
            userInfo: [AVAudioSessionInterruptionTypeKey: AVAudioSession.InterruptionType.ended.rawValue,
                       AVAudioSessionInterruptionOptionKey: AVAudioSession.InterruptionOptions.shouldResume.rawValue])
        try await Task.sleep(for: .milliseconds(20))
        XCTAssertFalse(speech.playing); XCTAssertEqual(engine.continuations, 0)
        speech.releasePresentation(); _ = await session.flush()
    }

    private func session(source: String = "A quiet passage to read aloud.", filename: String = "reader.txt") async throws -> ReaderSession {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent(filename)
        try Data(source.utf8).write(to: file)
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .device)
        let book = try await library.importFile(file)
        var state = try await library.state(book.id)
        state.translationSettings = BookTranslationSettings(sourceLanguage: .en, targetLanguage: .zh)
        return ReaderSession(book: book, state: state, original: try await library.originalURL(book.id), directory: try await library.bookDirectory(book.id), library: library)
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
        XCTAssertEqual(synthesizer.spoken.last?.rate ?? 0, AVSpeechUtteranceDefaultSpeechRate, accuracy: 0.001)
        XCTAssertEqual(synthesizer.playbackRate, 1.5, accuracy: 0.001)
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
        XCTAssertEqual(synthesizer.spoken.last?.rate ?? 0, AVSpeechUtteranceDefaultSpeechRate, accuracy: 0.001)
        XCTAssertEqual(synthesizer.playbackRate, 1.25, accuracy: 0.001)
        XCTAssertTrue(speech.playing)
        XCTAssertFalse(speech.paused)
    }
}

@MainActor
private final class SpeechSynthesizerProbe: ReaderSpeechSynthesizing {
    weak var delegate: (any AVSpeechSynthesizerDelegate)?
    var playbackRate: Float = 1
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
    var categoryOptions: [AVAudioSession.CategoryOptions] = []
    func setCategory(_ category: AVAudioSession.Category, mode: AVAudioSession.Mode, options: AVAudioSession.CategoryOptions) throws { categoryOptions.append(options) }
    func setActive(_ active: Bool, options: AVAudioSession.SetActiveOptions) throws { activations.append(active) }
}

private actor SpeechStateStoreProbe: ReaderStateStore {
    func saveState(_ state: ReaderState, bookID: String) async throws { }
}

@MainActor private final class ListeningOutputProbe: ReaderSpeechSynthesizing {
    weak var delegate: (any AVSpeechSynthesizerDelegate)?
    var playbackRate: Float = 1
    var isOutputPlaying = false
    var onOutputStateChange: (@MainActor (Bool) -> Void)?
    var spoken: [AVSpeechUtterance] = []
    var pauses = 0
    var continuations = 0
    func output(_ playing: Bool) { isOutputPlaying = playing; onOutputStateChange?(playing) }
    func speak(_ utterance: AVSpeechUtterance) { spoken.append(utterance); output(false) }
    func stopSpeaking(at boundary: AVSpeechBoundary) -> Bool { output(false); return true }
    func pauseSpeaking(at boundary: AVSpeechBoundary) -> Bool { pauses += 1; output(false); return true }
    func continueSpeaking() -> Bool { continuations += 1; output(true); return true }
}

@MainActor private final class ListeningMediaSink: ReaderNowPlayingSink {
    var nowPlayingInfo: [String: Any]?
}

@MainActor private final class ListeningRemoteCommands: ReaderRemoteCommandRegistering {
    var handlers: [ReaderRemoteCommand: @MainActor () -> MPRemoteCommandHandlerStatus] = [:]
    var registrations: [UUID: ReaderRemoteCommand] = [:]
    func register(_ command: ReaderRemoteCommand, handler: @escaping @MainActor () -> MPRemoteCommandHandlerStatus) -> UUID {
        let token = UUID(); registrations[token] = command; handlers[command] = handler; return token
    }
    func remove(_ token: UUID) { if let command = registrations.removeValue(forKey: token) { handlers[command] = nil } }
    func setEnabled(_ enabled: Bool, for command: ReaderRemoteCommand) {}
}

@MainActor private final class SuspendedListeningCoverLoader: ReaderListeningCoverLoading {
    var pending: CheckedContinuation<UIImage?, Never>?
    var started: XCTestExpectation?
    func load(book: LocalBook, original: URL, directory: URL, cloud: CloudLibraryClient?, library: OfflineLibrary?) async -> UIImage? {
        await withCheckedContinuation { pending = $0; started?.fulfill() }
    }
    func complete(_ image: UIImage?) { let continuation = pending; pending = nil; continuation?.resume(returning: image) }
}
