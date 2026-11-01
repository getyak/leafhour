import XCTest
import AVFoundation
@testable import Leafhour

@MainActor
final class ReaderSpeechPlaybackTests: XCTestCase {
    /// Built-in voices may use the delegate instead of write's marker closure.
    /// Assert the actual local provider returns timestamped word metadata.
    func testProbeSystemWriteMarkersAndDelegateRanges() async throws {
        let completed = expectation(description: "System speech PCM reached EOF")
        let trace = SystemSpeechWriteTrace(completed: completed)
        let synth = AVSpeechSynthesizer()
        synth.delegate = trace
        let value = AVSpeechUtterance(string: "A quiet page opens a new chapter. Every spoken word belongs to this sentence.")
        value.voice = try XCTUnwrap(AVSpeechSynthesisVoice(language: "en-US"))
        value.rate = AVSpeechUtteranceDefaultSpeechRate
        synth.write(value, toBufferCallback: { trace.receive($0) }, toMarkerCallback: { trace.receive($0) })
        await fulfillment(of: [completed], timeout: 20)
        let report = trace.report(voice: value.voice?.identifier ?? "nil")
        let attachment = XCTAttachment(string: report)
        attachment.name = "System write marker and delegate boundary"; attachment.lifetime = .keepAlways; add(attachment)
        XCTAssertGreaterThan(trace.frameCount, 0)
        XCTAssertGreaterThan(trace.wordOffsets.count, 5)
        XCTAssertEqual(trace.wordOffsets, trace.wordOffsets.sorted())
        XCTAssertGreaterThan(trace.wordOffsets.last ?? 0, 256 * 4, "Word offsets address the whole PCM stream, rather than reset for each small buffer")
        XCTAssertLessThan(trace.wordOffsets.last ?? 0, trace.byteCount)
        withExtendedLifetime(synth) {}
    }

    func testProbeChineseEmojiProviderRangeCoordinates() async throws {
        let source = "中文🙂，慢慢读。下一句继续。"
        let completed = expectation(description: "Chinese coordinate probe reached PCM EOF")
        let trace = UnicodeSpeechWriteTrace(completed: completed)
        let synth = AVSpeechSynthesizer()
        synth.delegate = trace
        let value = AVSpeechUtterance(string: source)
        value.voice = try XCTUnwrap(AVSpeechSynthesisVoice(language: "zh-CN"))
        value.rate = AVSpeechUtteranceDefaultSpeechRate
        synth.write(value, toBufferCallback: { trace.receive($0) }, toMarkerCallback: { trace.receive($0) })
        await fulfillment(of: [completed], timeout: 20)
        // Diagnostic only: preserve any metadata that arrives after PCM EOF.
        try await Task.sleep(for: .milliseconds(100))
        let report = UnicodeSpeechWriteTrace.coordinates(source)
            + "\nvoice=\(value.voice?.identifier ?? "nil"), speechString=\(value.speechString.debugDescription)\n"
            + trace.report()
        print("GET352_CHINESE_METADATA_PROBE\n\(report)")
        let attachment = XCTAttachment(string: report)
        attachment.name = "Chinese emoji raw provider coordinate contract"; attachment.lifetime = .keepAlways; add(attachment)
        XCTAssertGreaterThan(trace.frameCount, 0)
        withExtendedLifetime(synth) {}
    }

    func testCaptureKeepsPCMOrderAndClosesBeforePlaybackReadsTheFile() throws {
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 16_000, channels: 1))
        let first = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 64))
        let second = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 64))
        first.frameLength = 64; second.frameLength = 64
        for index in 0..<64 { first.floatChannelData![0][index] = 0.25; second.floatChannelData![0][index] = -0.5 }
        let capture = ReaderSpeechAudioCapture(id: UUID())
        XCTAssertNil(try capture.receive(first)); XCTAssertNil(try capture.receive(second))
        let end = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 1))
        end.frameLength = 0
        let result = try XCTUnwrap(capture.receive(end))
        let file = try AVAudioFile(forReading: result.fileURL)
        XCTAssertEqual(file.length, 128)
        let output = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: 128))
        try file.read(into: output)
        XCTAssertEqual(output.floatChannelData![0][0], 0.25)
        XCTAssertEqual(output.floatChannelData![0][63], 0.25)
        XCTAssertEqual(output.floatChannelData![0][64], -0.5)
        XCTAssertEqual(output.floatChannelData![0][127], -0.5)
        XCTAssertNil(try capture.receive(first), "Late callbacks cannot reopen or overwrite the sealed audio")
        capture.cancel()
        XCTAssertFalse(FileManager.default.fileExists(atPath: result.fileURL.path))
    }

    func testCaptureDeduplicatesDelegateAndClosureMarkersIncludingLateMetadata() throws {
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 16_000, channels: 1))
        let pcm = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 64))
        pcm.frameLength = 64
        let capture = ReaderSpeechAudioCapture(id: UUID())
        let first = AVSpeechSynthesisMarker(wordRange: NSRange(location: 0, length: 4), atByteSampleOffset: 0)
        XCTAssertNil(capture.appendMarkers([first, first]))
        XCTAssertNil(try capture.receive(pcm))
        let end = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 1))
        let result = try XCTUnwrap(capture.receive(end))
        XCTAssertEqual(result.markers.count, 1)
        XCTAssertEqual(capture.appendMarkers([first])?.count, 0, "A second metadata path cannot replay an already captured word")
        let second = AVSpeechSynthesisMarker(wordRange: NSRange(location: 5, length: 3), atByteSampleOffset: 128)
        XCTAssertEqual(capture.appendMarkers([second, second])?.map(\.textRange), [NSRange(location: 5, length: 3)])
        capture.cancel()
        XCTAssertNil(capture.appendMarkers([second]))
    }

    func testEmptyAudioIsAnExplicitFailureAndCancellationRejectsFurtherChunks() throws {
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 16_000, channels: 1))
        let end = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 1))
        let capture = ReaderSpeechAudioCapture(id: UUID())
        XCTAssertThrowsError(try capture.receive(end))
        capture.cancel()
        XCTAssertNil(try capture.receive(end))
    }

    func testCollectorMapsRealChineseSSMLTraceToSourceUTF16WithoutInventingEmojiWords() throws {
        let source = "中文🙂，慢慢读。下一句继续。"
        let value = AVSpeechUtterance(string: source), synth = AVSpeechSynthesizer()
        let capture = ReaderSpeechAudioCapture(id: UUID())
        defer { capture.cancel() }
        let collector = ReaderSpeechMarkerCollector(utterance: value, capture: capture, lateMarkers: { _ in }, cancelled: {})
        // Captured Tingting trace: SSML-expanded emoji words have no legacy
        // source unit. Later ranges retain their true original UTF16 offsets.
        let trace: [(Int, NSRange, NSRange?)] = [
            (0, NSRange(location: 0, length: 2), NSRange(location: 0, length: 2)),
            (37888, NSRange(location: 3, length: 1), NSRange(location: 2, length: 2)),
            (53248, NSRange(location: 4, length: 1), nil),
            (70656, NSRange(location: 5, length: 1), nil),
            (94208, NSRange(location: 6, length: 1), nil),
            (107520, NSRange(location: 7, length: 1), nil),
            (118784, NSRange(location: 8, length: 2), nil),
            (206848, NSRange(location: 33, length: 1), NSRange(location: 4, length: 1)),
            (206848, NSRange(location: 34, length: 2), NSRange(location: 5, length: 2)),
            (212992, NSRange(location: 36, length: 1), NSRange(location: 7, length: 1)),
            (238592, NSRange(location: 37, length: 1), NSRange(location: 8, length: 1)),
            (286720, NSRange(location: 38, length: 1), NSRange(location: 9, length: 1)),
            (286720, NSRange(location: 39, length: 1), NSRange(location: 10, length: 1)),
            (293888, NSRange(location: 40, length: 1), NSRange(location: 11, length: 1)),
            (315392, NSRange(location: 41, length: 2), NSRange(location: 12, length: 2)),
            (359424, NSRange(location: 43, length: 1), NSRange(location: 14, length: 1))
        ]
        for (offset, rawRange, legacyRange) in trace {
            let marker = AVSpeechSynthesisMarker(wordRange: rawRange, atByteSampleOffset: offset)
            collector.receiveMarkerCallback([marker])
            collector.speechSynthesizer(synth, willSpeak: marker, utterance: value)
            if let legacyRange { collector.speechSynthesizer(synth, willSpeakRangeOfSpeechString: legacyRange, utterance: value) }
            collector.receiveMarkerCallback([marker])
        }
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 22_050, channels: 1))
        let pcm = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 97_493))
        pcm.frameLength = 97_493
        pcm.floatChannelData![0].initialize(repeating: 0, count: Int(pcm.frameLength))
        XCTAssertNil(try capture.receive(pcm))
        let end = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 1))
        let result = try XCTUnwrap(capture.receive(end))
        let units = trace.filter { $0.2 != nil }
        XCTAssertEqual(result.markers.map(\.textRange), units.compactMap { $0.2 })
        XCTAssertEqual(result.markers.map(\.byteSampleOffset), units.map { $0.0 }, "Keep the exact captured audio offsets, including shared offsets for distinct source units")
        XCTAssertEqual(result.markers.last?.textRange, NSRange(location: 14, length: 1), "EOF must retain the final original-source unit")
    }

    func testCollectorKeepsSourceMappingWhenLegacyMetadataArrivesAfterEOF() throws {
        let value = AVSpeechUtterance(string: "中文🙂，慢慢读。下一句继续。"), synth = AVSpeechSynthesizer()
        let capture = ReaderSpeechAudioCapture(id: UUID()), received = SpeechMarkerRecorder()
        defer { capture.cancel() }
        let collector = ReaderSpeechMarkerCollector(utterance: value, capture: capture, lateMarkers: { received.record($0) }, cancelled: {})
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 16_000, channels: 1))
        let pcm = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 16))
        pcm.frameLength = 16; pcm.floatChannelData![0].initialize(repeating: 0, count: 16)
        XCTAssertNil(try capture.receive(pcm))
        let marker = AVSpeechSynthesisMarker(wordRange: NSRange(location: 41, length: 2), atByteSampleOffset: 315392)
        collector.speechSynthesizer(synth, willSpeak: marker, utterance: value)
        let end = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 1))
        XCTAssertTrue(try XCTUnwrap(capture.receive(end)).markers.isEmpty)
        collector.speechSynthesizer(synth, willSpeakRangeOfSpeechString: NSRange(location: 12, length: 2), utterance: value)
        collector.receiveMarkerCallback([marker])
        XCTAssertEqual(received.markers.map(\.textRange), [NSRange(location: 12, length: 2)])
        XCTAssertEqual(received.markers.map(\.byteSampleOffset), [315392])
    }

    func testCollectorForwardsOnlyItsCurrentCancellationOnceAndRejectsLateCapture() throws {
        let capture = ReaderSpeechAudioCapture(id: UUID())
        let value = AVSpeechUtterance(string: "The current passage.")
        let other = AVSpeechUtterance(string: value.speechString)
        let counter = SpeechCancellationCounter()
        let collector = ReaderSpeechMarkerCollector(utterance: value, capture: capture, lateMarkers: { _ in }, cancelled: { counter.record() })
        let synth = AVSpeechSynthesizer()
        collector.speechSynthesizer(synth, didCancel: other)
        XCTAssertEqual(counter.count, 0, "Equal text in an old utterance cannot cancel this capture")
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 16_000, channels: 1))
        let pcm = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 16))
        pcm.frameLength = 16
        for index in 0..<16 { pcm.floatChannelData![0][index] = 0 }
        XCTAssertNil(try capture.receive(pcm))
        collector.speechSynthesizer(synth, didCancel: value)
        XCTAssertEqual(counter.count, 1)
        collector.speechSynthesizer(synth, didCancel: value)
        collector.speechSynthesizer(synth, didCancel: other)
        XCTAssertEqual(counter.count, 1, "Duplicate or old provider cancellation is idempotent")
        let marker = AVSpeechSynthesisMarker(wordRange: NSRange(location: 0, length: 3), atByteSampleOffset: 0)
        XCTAssertNil(capture.appendMarkers([marker]))
        XCTAssertNil(try capture.receive(pcm))
        let end = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 1))
        XCTAssertNil(try capture.receive(end), "A cancellation before EOF cannot prepare playback from a partial file")
    }

    func testOwnStopDuringSynthesisDoesNotForwardProviderCancellationOrCompletion() async throws {
        let unexpected = expectation(description: "Stopped audio cannot complete or report a provider failure")
        unexpected.isInverted = true
        let probe = PlaybackProbe(completed: unexpected), player = ReaderSpeechAudioPlayer()
        player.delegate = probe
        let value = AVSpeechUtterance(string: "This local passage is stopped while the system is still preparing its audio, before it can begin playing.")
        value.voice = try XCTUnwrap(AVSpeechSynthesisVoice(language: "en-US"))
        value.rate = AVSpeechUtteranceDefaultSpeechRate
        player.speak(value)
        XCTAssertTrue(player.stopSpeaking(at: .immediate))
        await fulfillment(of: [unexpected], timeout: 0.4)
        XCTAssertFalse(probe.cancelled)
        XCTAssertNil(probe.finishedAt)
        XCTAssertTrue(probe.ranges.isEmpty)
    }

    func testActualAudioPauseFreezesMarkersAndChangingRateDoesNotResume() async throws {
        let audio = AVAudioSession.sharedInstance()
        try audio.setCategory(.playback, mode: .spokenAudio); try audio.setActive(true)
        defer { try? audio.setActive(false, options: .notifyOthersOnDeactivation) }
        let completed = expectation(description: "Playback explicitly resumed")
        let probe = PlaybackProbe(completed: completed), player = ReaderSpeechAudioPlayer()
        player.delegate = probe
        let value = AVSpeechUtterance(string: "This is a longer sentence that keeps its exact playing position while the reader changes the speed and pauses the local audio.")
        value.voice = try XCTUnwrap(AVSpeechSynthesisVoice(language: "en-US")); value.rate = AVSpeechUtteranceDefaultSpeechRate
        player.speak(value)
        let firstWord = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in probe.firstWordAt != nil }, object: nil)
        await fulfillment(of: [firstWord], timeout: 20)
        XCTAssertTrue(player.pauseSpeaking(at: .immediate))
        // Flush the one callback already delivered before the pause.
        await Task.yield()
        let count = probe.ranges.count
        player.playbackRate = 5
        try await Task.sleep(for: .milliseconds(350))
        XCTAssertEqual(probe.ranges.count, count)
        XCTAssertNil(probe.finishedAt)
        XCTAssertTrue(player.continueSpeaking())
        await fulfillment(of: [completed], timeout: 20)
        XCTAssertFalse(probe.cancelled)
        _ = player.stopSpeaking(at: .immediate)
    }

    func testRealLocalPlaybackHasWordMarkersAndFiveIsFasterThanTwoPointFive() async throws {
        let audio = AVAudioSession.sharedInstance()
        try audio.setCategory(.playback, mode: .spokenAudio)
        try audio.setActive(true)
        defer { try? audio.setActive(false, options: .notifyOthersOnDeactivation) }
        var measurements: [Double] = []
        for rate: Float in [2.5, 5] {
            let completed = expectation(description: "Actual audio output completed at \(rate)×")
            let probe = PlaybackProbe(completed: completed)
            let player = ReaderSpeechAudioPlayer()
            player.delegate = probe; player.playbackRate = rate
            let value = AVSpeechUtterance(string: "A quiet page opens a new chapter. Every spoken word belongs to this sentence. The reader can follow the whole passage.")
            value.voice = try XCTUnwrap(AVSpeechSynthesisVoice(language: "en-US"))
            value.rate = AVSpeechUtteranceDefaultSpeechRate
            player.speak(value)
            await fulfillment(of: [completed], timeout: 35)
            XCTAssertFalse(probe.cancelled, "The real audio renderer must complete rather than fall back to a cancelled synthesizer")
            XCTAssertGreaterThan(probe.ranges.count, 5, "Word markers must come from the local voice and actual player clock")
            XCTAssertEqual(probe.ranges.map(\.location), probe.ranges.map(\.location).sorted())
            let duration = try XCTUnwrap(probe.finishedAt).timeIntervalSince(try XCTUnwrap(probe.firstWordAt))
            XCTAssertGreaterThan(duration, 0.1)
            measurements.append(duration)
            let report = "rate=\(rate), audible-marker-duration=\(duration), word-markers=\(probe.ranges.count)"
            print("GET352_LOCAL_PCM_OUTPUT \(report)")
            let attachment = XCTAttachment(string: report)
            attachment.name = "Local PCM output speed \(rate)×"; attachment.lifetime = .keepAlways; add(attachment)
            _ = player.stopSpeaking(at: .immediate)
        }
        XCTAssertLessThan(measurements[1], measurements[0] * 0.8, "5× must have a distinct faster output, rather than clamp to the same synthesis-rate maximum")
    }

    func testChineseAndEmojiKeepUTF16WordRangesAtActualHalfAndFiveTimesOutput() async throws {
        let audio = AVAudioSession.sharedInstance()
        try audio.setCategory(.playback, mode: .spokenAudio); try audio.setActive(true)
        defer { try? audio.setActive(false, options: .notifyOthersOnDeactivation) }
        let source = "中文🙂，慢慢读。下一句继续。"
        let nextSentence = (source as NSString).range(of: "下一句")
        let continuation = (source as NSString).range(of: "继续")
        var scalarBoundaries: Set<Int> = [0], scalarEnd = 0
        for scalar in source.unicodeScalars {
            scalarEnd += String(scalar).utf16.count; scalarBoundaries.insert(scalarEnd)
        }
        var measurements: [Double] = []
        var firstRanges: [NSRange] = []
        for rate: Float in [0.5, 5] {
            let completed = expectation(description: "Chinese PCM output completed at \(rate)×")
            let probe = PlaybackProbe(completed: completed), player = ReaderSpeechAudioPlayer()
            player.delegate = probe; player.playbackRate = rate
            let value = AVSpeechUtterance(string: source)
            value.voice = try XCTUnwrap(AVSpeechSynthesisVoice(language: "zh-CN"))
            XCTAssertTrue(value.voice?.language.hasPrefix("zh") == true)
            value.rate = AVSpeechUtteranceDefaultSpeechRate
            player.speak(value)
            await fulfillment(of: [completed], timeout: 30)
            XCTAssertFalse(probe.cancelled)
            XCTAssertGreaterThan(probe.ranges.count, 2, "The real Chinese voice must supply words at the audible output boundaries")
            XCTAssertEqual(Set(probe.ranges.map(\.location)).count, probe.ranges.count, "A word cannot advance twice through the two system metadata paths")
            for range in probe.ranges {
                XCTAssertTrue(scalarBoundaries.contains(range.location) && scalarBoundaries.contains(NSMaxRange(range)), "Actual UTF16 source ranges must not split the emoji's surrogate pair")
            }
            XCTAssertTrue(probe.ranges.contains { $0.location >= nextSentence.location }, "The sentence after the emoji must retain its original UTF16 offset")
            for offset in nextSentence.location..<NSMaxRange(continuation) {
                XCTAssertTrue(probe.ranges.contains { $0.location <= offset && offset < NSMaxRange($0) }, "Every original UTF16 character in 下一句继续 must have a real audible source unit")
            }
            if firstRanges.isEmpty { firstRanges = probe.ranges }
            else { XCTAssertEqual(probe.ranges, firstRanges, "Playback speed must preserve the source ranges and emit every word") }
            let duration = try XCTUnwrap(probe.finishedAt).timeIntervalSince(try XCTUnwrap(probe.firstWordAt))
            XCTAssertGreaterThan(duration, 0.1)
            measurements.append(duration)
            let report = "voice=\(value.voice?.identifier ?? "nil"), rate=\(rate), audible-marker-duration=\(duration), UTF16-word-ranges=\(probe.ranges)"
            print("GET352_CHINESE_PCM_OUTPUT \(report)")
            let attachment = XCTAttachment(string: report)
            attachment.name = "Chinese UTF16 PCM output \(rate)×"; attachment.lifetime = .keepAlways; add(attachment)
            _ = player.stopSpeaking(at: .immediate)
        }
        XCTAssertLessThan(measurements[1], measurements[0] * 0.5, "The two slider endpoints must produce distinctly different real output durations")
    }

    func testPlaybackRateBoundsRemainFinite() {
        let player = ReaderSpeechAudioPlayer()
        player.playbackRate = .infinity; XCTAssertEqual(player.playbackRate, 1)
        player.playbackRate = 0; XCTAssertEqual(player.playbackRate, 0.5)
        player.playbackRate = 8; XCTAssertEqual(player.playbackRate, 5)
        _ = player.stopSpeaking(at: .immediate)
    }
}

@MainActor
private final class PlaybackProbe: NSObject, AVSpeechSynthesizerDelegate {
    let completed: XCTestExpectation
    var ranges: [NSRange] = []
    var firstWordAt: Date?
    var finishedAt: Date?
    var cancelled = false
    init(completed: XCTestExpectation) { self.completed = completed }
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, willSpeakRangeOfSpeechString range: NSRange, utterance: AVSpeechUtterance) {
        Task { @MainActor in
            if self.firstWordAt == nil { self.firstWordAt = Date() }
            self.ranges.append(range)
        }
    }
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in self.finishedAt = Date(); self.completed.fulfill() }
    }
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in self.cancelled = true; self.completed.fulfill() }
    }
}

private final class SystemSpeechWriteTrace: NSObject, AVSpeechSynthesizerDelegate, @unchecked Sendable {
    private let lock = NSLock()
    private let completed: XCTestExpectation
    private var frames: AVAudioFramePosition = 0
    private var delegateWords: [Int] = []
    private var callbackWords: [Int] = []
    private var bytesPerFrame = 0
    private var chunks = 0
    private var sealed = false
    init(completed: XCTestExpectation) { self.completed = completed }
    var frameCount: AVAudioFramePosition { lock.lock(); defer { lock.unlock() }; return frames }
    var byteCount: Int { lock.lock(); defer { lock.unlock() }; return Int(frames) * bytesPerFrame }
    var wordOffsets: [Int] {
        lock.lock(); defer { lock.unlock() }
        var seen: Set<Int> = []
        return (delegateWords.isEmpty ? callbackWords : delegateWords).filter { seen.insert($0).inserted }
    }
    func receive(_ buffer: AVAudioBuffer) {
        lock.lock(); defer { lock.unlock() }
        guard !sealed, let pcm = buffer as? AVAudioPCMBuffer else { return }
        frames += AVAudioFramePosition(pcm.frameLength)
        bytesPerFrame = Int(pcm.format.streamDescription.pointee.mBytesPerFrame)
        chunks += 1
        if pcm.frameLength == 0 { sealed = true; completed.fulfill() }
    }
    func receive(_ values: [AVSpeechSynthesisMarker]) {
        lock.lock(); defer { lock.unlock() }
        callbackWords += values.filter { $0.mark == .word }.map(\.byteSampleOffset)
    }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, willSpeak marker: AVSpeechSynthesisMarker, utterance: AVSpeechUtterance) {
        lock.lock(); defer { lock.unlock() }
        if marker.mark == .word { delegateWords.append(marker.byteSampleOffset) }
    }
    func report(voice: String) -> String {
        lock.lock(); defer { lock.unlock() }
        return "voice=\(voice), PCM frames=\(frames), bytes/frame=\(bytesPerFrame), chunks=\(chunks), delegate words=\(delegateWords.count), closure words=\(callbackWords.count), absolute word byte offsets=\(Array(Set(delegateWords + callbackWords)).sorted())"
    }
}

private final class SpeechCancellationCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0
    var count: Int { lock.lock(); defer { lock.unlock() }; return value }
    func record() { lock.lock(); defer { lock.unlock() }; value += 1 }
}

private final class UnicodeSpeechWriteTrace: NSObject, AVSpeechSynthesizerDelegate, @unchecked Sendable {
    private let lock = NSLock()
    private let completed: XCTestExpectation
    private var frames: AVAudioFramePosition = 0
    private var chunks = 0
    private var sealed = false
    private var events: [String] = []
    init(completed: XCTestExpectation) { self.completed = completed }
    var frameCount: AVAudioFramePosition { lock.lock(); defer { lock.unlock() }; return frames }
    func receive(_ buffer: AVAudioBuffer) {
        lock.lock(); defer { lock.unlock() }
        guard !sealed, let pcm = buffer as? AVAudioPCMBuffer else { return }
        frames += AVAudioFramePosition(pcm.frameLength); chunks += 1
        if chunks <= 3 || pcm.frameLength == 0 {
            events.append("buffer frames=\(pcm.frameLength), capturedFrame=\(frames), sampleRate=\(pcm.format.sampleRate), bytesPerFrame=\(pcm.format.streamDescription.pointee.mBytesPerFrame)")
        }
        if pcm.frameLength == 0 { sealed = true; completed.fulfill() }
    }
    func receive(_ values: [AVSpeechSynthesisMarker]) {
        lock.lock(); defer { lock.unlock() }
        events.append("closure markers=\(values.count), capturedFrame=\(frames), afterEOF=\(sealed)")
        events += values.map { "closure marker type=\($0.mark), byteOffset=\($0.byteSampleOffset), range=\($0.textRange)" }
    }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, willSpeak marker: AVSpeechSynthesisMarker, utterance: AVSpeechUtterance) {
        lock.lock(); defer { lock.unlock() }
        events.append("delegate marker type=\(marker.mark), byteOffset=\(marker.byteSampleOffset), range=\(marker.textRange), capturedFrame=\(frames), afterEOF=\(sealed)")
    }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, willSpeakRangeOfSpeechString range: NSRange, utterance: AVSpeechUtterance) {
        lock.lock(); defer { lock.unlock() }
        events.append("legacy word range=\(range), capturedFrame=\(frames), afterEOF=\(sealed), speechString=\(utterance.speechString.debugDescription)")
    }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        lock.lock(); defer { lock.unlock() }; events.append("delegate didFinish capturedFrame=\(frames), afterEOF=\(sealed)")
    }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        lock.lock(); defer { lock.unlock() }; events.append("delegate didCancel capturedFrame=\(frames), afterEOF=\(sealed)")
    }
    func report() -> String { lock.lock(); defer { lock.unlock() }; return events.joined(separator: "\n") }
    static func coordinates(_ source: String) -> String {
        var utf16Offset = 0, utf8Offset = 0
        let scalars = source.unicodeScalars.enumerated().map { ordinal, scalar -> String in
            let item = "scalar[\(ordinal)] U+\(String(scalar.value, radix: 16).uppercased()) \(String(scalar).debugDescription) utf16=\(utf16Offset), utf8=\(utf8Offset)"
            utf16Offset += String(scalar).utf16.count; utf8Offset += String(scalar).utf8.count
            return item
        }
        let utf16 = source.utf16.enumerated().map { "utf16[\($0.offset)]=0x\(String($0.element, radix: 16).uppercased())" }
        let utf8 = source.utf8.enumerated().map { "utf8[\($0.offset)]=0x\(String($0.element, radix: 16).uppercased())" }
        return "source=\(source.debugDescription), UTF16-count=\(source.utf16.count), scalar-count=\(source.unicodeScalars.count), UTF8-count=\(source.utf8.count)\n"
            + (scalars + utf16 + utf8).joined(separator: "\n")
    }
}

private final class SpeechMarkerRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var value: [AVSpeechSynthesisMarker] = []
    var markers: [AVSpeechSynthesisMarker] { lock.lock(); defer { lock.unlock() }; return value }
    func record(_ markers: [AVSpeechSynthesisMarker]) { lock.lock(); defer { lock.unlock() }; value += markers }
}
