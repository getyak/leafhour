import AVFoundation
import Foundation

/// Local speech is written to a short-lived, single-passage PCM file. Playback
/// owns progress: synthesis can finish ahead without moving the reading cursor.
@MainActor
final class ReaderSpeechAudioPlayer: NSObject, ReaderSpeechSynthesizing {
    weak var delegate: (any AVSpeechSynthesizerDelegate)?
    var playbackRate: Float = 1 {
        didSet {
            let valid = playbackRate.isFinite ? min(5, max(0.5, playbackRate)) : 1
            if valid != playbackRate { playbackRate = valid }
            pitch.rate = valid
        }
    }
    private let synth = AVSpeechSynthesizer()
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let pitch = AVAudioUnitTimePitch()
    private var utterance: AVSpeechUtterance?
    private var generation = UUID()
    private var capture: ReaderSpeechAudioCapture?
    private var markerCollector: ReaderSpeechMarkerCollector?
    private var reading: AVAudioFile?
    private var markers: [AVSpeechSynthesisMarker] = []
    private var lastMarkerOffset = -1
    private var bytesPerFrame = 1
    private var paused = false
    private var ready = false
    private var playedFrameCount: AVAudioFramePosition = 0
    private var outputFinished = false

    override init() {
        super.init()
        engine.attach(player); engine.attach(pitch)
    }

    deinit { capture?.cancel() }

    func speak(_ utterance: AVSpeechUtterance) {
        _ = stopSpeaking(at: .immediate)
        self.utterance = utterance
        let request = generation
        let capture = ReaderSpeechAudioCapture(id: request)
        self.capture = capture
        let acceptLateMarkers: @Sendable ([AVSpeechSynthesisMarker]) -> Void = { [weak self] values in
            Task { @MainActor [weak self] in
                guard let self, self.generation == request else { return }
                self.markers.append(contentsOf: values)
                self.markers.sort {
                    $0.byteSampleOffset == $1.byteSampleOffset ? $0.textRange.location < $1.textRange.location : $0.byteSampleOffset < $1.byteSampleOffset
                }
                self.advanceMarkers()
            }
        }
        // Built-in voices can deliver timestamped words to the delegate while
        // never calling write's marker closure. Collect both paths, without
        // forwarding synthesis-ahead events as audible reading progress.
        let collector = ReaderSpeechMarkerCollector(utterance: utterance, capture: capture, lateMarkers: acceptLateMarkers, cancelled: { [weak self] in
            Task { @MainActor [weak self] in
                guard let self, self.generation == request else { return }
                self.fail()
            }
        })
        markerCollector = collector; synth.delegate = collector
        synth.write(utterance, toBufferCallback: { [weak self] buffer in
            // Write before returning to the provider. Independent actor hops for
            // each chunk could reorder PCM or let EOF overtake buffered audio.
            do {
                guard let result = try capture.receive(buffer) else { return }
                Task { @MainActor [weak self] in
                    guard let self, self.generation == request else { return }
                    self.prepare(result, generation: request)
                }
            } catch {
                Task { @MainActor [weak self] in
                    guard let self, self.generation == request else { return }
                    self.fail()
                }
            }
        }, toMarkerCallback: { values in
            collector.receiveMarkerCallback(values)
        })
    }

    @discardableResult func stopSpeaking(at boundary: AVSpeechBoundary) -> Bool {
        generation = UUID(); utterance = nil
        synth.delegate = nil; markerCollector = nil
        player.stop(); engine.stop(); engine.reset()
        synth.stopSpeaking(at: boundary)
        reading = nil; capture?.cancel(); capture = nil
        markers = []; lastMarkerOffset = -1
        ready = false; paused = false; playedFrameCount = 0; outputFinished = false
        return true
    }

    @discardableResult func pauseSpeaking(at boundary: AVSpeechBoundary) -> Bool {
        guard utterance != nil else { return false }
        paused = true; player.pause(); engine.pause()
        return true
    }

    func continueSpeaking() -> Bool {
        guard utterance != nil, paused else { return false }
        paused = false
        guard ready else { return true }
        do {
            try engine.start(); player.play(); advanceMarkers()
            if outputFinished { finished(generation: generation) }
            return true
        } catch { fail(); return false }
    }

    private func prepare(_ result: ReaderSpeechAudioCapture.Result, generation request: UUID) {
        do {
            let file = try AVAudioFile(forReading: result.fileURL)
            guard file.length > 0 else { fail(); return }
            bytesPerFrame = result.bytesPerFrame
            markers.append(contentsOf: result.markers)
            markers.sort {
                $0.byteSampleOffset == $1.byteSampleOffset ? $0.textRange.location < $1.textRange.location : $0.byteSampleOffset < $1.byteSampleOffset
            }
            reading = file
            engine.connect(player, to: pitch, format: file.processingFormat)
            engine.connect(pitch, to: engine.mainMixerNode, format: file.processingFormat)
            pitch.rate = playbackRate
            // All segments reference the same unchanged PCM in source order.
            // The completion of the first sample at a word boundary proves the
            // audio reached the output, including TimePitch and device latency.
            // lastRenderTime alone observes upstream rendering and runs ahead.
            var boundaries = Set(markers.compactMap { marker -> AVAudioFramePosition? in
                let frame = AVAudioFramePosition(marker.byteSampleOffset / bytesPerFrame)
                return frame >= 0 && frame < file.length ? frame + 1 : nil
            })
            boundaries.insert(file.length)
            var start: AVAudioFramePosition = 0
            for boundary in boundaries.sorted() {
                while start < boundary {
                    let count = AVAudioFrameCount(min(boundary - start, AVAudioFramePosition(UInt32.max)))
                    let end = start + AVAudioFramePosition(count)
                    let isFinal = end == file.length
                    player.scheduleSegment(file, startingFrame: start, frameCount: count, at: nil,
                                           completionCallbackType: .dataPlayedBack) { [weak self] _ in
                        Task { @MainActor [weak self] in
                            self?.outputDidPlay(through: end, final: isFinal, generation: request)
                        }
                    }
                    start = end
                }
            }
            ready = true
            if !paused { try engine.start(); player.play() }
        } catch { fail() }
    }

    private func outputDidPlay(through frame: AVAudioFramePosition, final: Bool, generation request: UUID) {
        guard generation == request, utterance != nil else { return }
        playedFrameCount = max(playedFrameCount, frame)
        if final { outputFinished = true }
        advanceMarkers()
        if outputFinished, !paused { finished(generation: request) }
    }

    private func advanceMarkers() {
        guard ready, !paused, let utterance else { return }
        while let marker = markers.first {
            let frame = AVAudioFramePosition(marker.byteSampleOffset / bytesPerFrame)
            guard frame < playedFrameCount else { break }
            markers.removeFirst()
            let range = marker.textRange
            guard range.location > lastMarkerOffset, range.length > 0,
                  range.location <= utterance.speechString.utf16.count - range.length else { continue }
            lastMarkerOffset = range.location
            delegate?.speechSynthesizer?(synth, willSpeakRangeOfSpeechString: range, utterance: utterance)
        }
    }

    private func finished(generation request: UUID) {
        guard generation == request, let utterance else { return }
        advanceMarkers()
        // Delegate completion can queue the next passage. Invalidate this one
        // first, so late callbacks cannot tear down that new playback.
        _ = stopSpeaking(at: .immediate)
        delegate?.speechSynthesizer?(synth, didFinish: utterance)
    }

    private func fail() {
        guard let utterance else { return }
        _ = stopSpeaking(at: .immediate)
        delegate?.speechSynthesizer?(synth, didCancel: utterance)
    }
}

/// One delegate per generation keeps timestamped synthesis metadata attached to
/// its own capture, even when a stopped voice delivers a late callback.
final class ReaderSpeechMarkerCollector: NSObject, AVSpeechSynthesizerDelegate, @unchecked Sendable {
    private let utterance: AVSpeechUtterance
    private let sourceLength: Int
    private let sourceBoundaries: Set<Int>
    private let capture: ReaderSpeechAudioCapture
    private let lateMarkers: @Sendable ([AVSpeechSynthesisMarker]) -> Void
    private let cancelled: @Sendable () -> Void
    private let lock = NSLock()
    private var cancellationDelivered = false
    private var pendingWord: AVSpeechSynthesisMarker?
    private struct MarkerKey: Hashable {
        let offset: Int
        let location: Int
        let length: Int
        init(_ marker: AVSpeechSynthesisMarker) {
            offset = marker.byteSampleOffset; location = marker.textRange.location; length = marker.textRange.length
        }
    }
    private var sourceRanges: [MarkerKey: NSRange] = [:]

    init(utterance: AVSpeechUtterance, capture: ReaderSpeechAudioCapture,
         lateMarkers: @escaping @Sendable ([AVSpeechSynthesisMarker]) -> Void,
         cancelled: @escaping @Sendable () -> Void) {
        self.utterance = utterance; self.capture = capture; self.lateMarkers = lateMarkers; self.cancelled = cancelled
        sourceLength = utterance.speechString.utf16.count
        var boundaries: Set<Int> = [0], offset = 0
        for scalar in utterance.speechString.unicodeScalars {
            offset += String(scalar).utf16.count; boundaries.insert(offset)
        }
        sourceBoundaries = boundaries
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, willSpeak marker: AVSpeechSynthesisMarker, utterance: AVSpeechUtterance) {
        guard utterance === self.utterance, marker.mark == .word else { return }
        lock.lock(); defer { lock.unlock() }
        guard !cancellationDelivered else { return }
        // Marker ranges address the voice's expanded SSML. An emoji can emit
        // several internal words with no new range in the author's text.
        // Keep the latest timestamp, rather than queueing those internal words.
        pendingWord = marker.copy() as? AVSpeechSynthesisMarker
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, willSpeakRangeOfSpeechString range: NSRange, utterance: AVSpeechUtterance) {
        guard utterance === self.utterance else { return }
        lock.lock()
        guard !cancellationDelivered, let marker = pendingWord else { lock.unlock(); return }
        pendingWord = nil
        guard range.location >= 0, range.length > 0, range.location <= sourceLength - range.length,
              sourceBoundaries.contains(range.location), sourceBoundaries.contains(NSMaxRange(range)) else { lock.unlock(); return }
        sourceRanges[MarkerKey(marker)] = range
        marker.textRange = range
        lock.unlock()
        publish([marker])
    }

    func receiveMarkerCallback(_ values: [AVSpeechSynthesisMarker]) {
        lock.lock()
        guard !cancellationDelivered else { lock.unlock(); return }
        let mapped = values.compactMap { value -> AVSpeechSynthesisMarker? in
            guard value.mark == .word, let range = sourceRanges[MarkerKey(value)],
                  let copy = value.copy() as? AVSpeechSynthesisMarker else { return nil }
            copy.textRange = range
            return copy
        }
        lock.unlock()
        // Never forward raw SSML coordinates as author-text anchors. Metadata
        // arriving before its delegate pair is supplied by that pair instead;
        // arriving afterwards is normalized and deduplicated by the capture.
        publish(mapped)
    }

    private func publish(_ markers: [AVSpeechSynthesisMarker]) {
        guard !markers.isEmpty else { return }
        if let late = capture.appendMarkers(markers), !late.isEmpty { lateMarkers(late) }
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        guard utterance === self.utterance else { return }
        lock.lock()
        let deliver = !cancellationDelivered
        cancellationDelivered = true; pendingWord = nil; sourceRanges = [:]
        lock.unlock()
        guard deliver else { return }
        // EOF may never arrive after a provider cancellation. Seal the capture
        // now and let the renderer restore its recoverable paused state.
        capture.cancel()
        cancelled()
    }
    // Synthesis didFinish is intentionally not forwarded: only the audio
    // player's dataPlayedBack callback can finish the audible passage.
}

/// Synthesis callbacks serialize their PCM writes here, including EOF. The
/// single completed file crosses to the main actor; provider memory never does.
final class ReaderSpeechAudioCapture: @unchecked Sendable {
    struct Result {
        let fileURL: URL
        let bytesPerFrame: Int
        let markers: [AVSpeechSynthesisMarker]
    }
    private let lock = NSLock()
    private let fileURL: URL
    private var writer: AVAudioFile?
    private var markers: [AVSpeechSynthesisMarker] = []
    private var markerKeys: Set<MarkerKey> = []
    private struct MarkerKey: Hashable {
        let offset: Int
        let location: Int
        let length: Int
    }
    private var bytesPerFrame = 1
    private var sealed = false
    private var cancelled = false
    init(id: UUID) { fileURL = FileManager.default.temporaryDirectory.appendingPathComponent("leafhour-speech-\(id.uuidString).caf") }
    deinit { cancel() }

    func receive(_ buffer: AVAudioBuffer) throws -> Result? {
        lock.lock(); defer { lock.unlock() }
        guard !cancelled, !sealed else { return nil }
        guard let pcm = buffer as? AVAudioPCMBuffer else { throw CocoaError(.fileReadCorruptFile) }
        if pcm.frameLength == 0 {
            guard writer != nil else { throw CocoaError(.fileReadCorruptFile) }
            writer = nil; sealed = true
            let result = Result(fileURL: fileURL, bytesPerFrame: bytesPerFrame, markers: markers)
            markers = []
            return result
        }
        if writer == nil {
            bytesPerFrame = max(1, Int(pcm.format.streamDescription.pointee.mBytesPerFrame))
            writer = try AVAudioFile(forWriting: fileURL, settings: pcm.format.settings,
                                     commonFormat: pcm.format.commonFormat, interleaved: pcm.format.isInterleaved)
        }
        try writer?.write(from: pcm)
        return nil
    }

    func appendMarkers(_ values: [AVSpeechSynthesisMarker]) -> [AVSpeechSynthesisMarker]? {
        lock.lock(); defer { lock.unlock() }
        guard !cancelled else { return nil }
        let words = values.filter { marker in
            guard marker.mark == .word, marker.textRange.length > 0 else { return false }
            let key = MarkerKey(offset: marker.byteSampleOffset, location: marker.textRange.location, length: marker.textRange.length)
            return markerKeys.insert(key).inserted
        }.compactMap { $0.copy() as? AVSpeechSynthesisMarker }
        if sealed { return words }
        markers.append(contentsOf: words)
        return nil
    }

    func cancel() {
        lock.lock(); defer { lock.unlock() }
        cancelled = true; writer = nil; markers = []; markerKeys = []
        try? FileManager.default.removeItem(at: fileURL)
    }
}
