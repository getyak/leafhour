import AVFoundation
import Speech
import Observation
import LeafhourCore

struct ChatRecordedVoice {
    let id: UUID
    let url: URL
    let durationMs: Int
    let transcript: String
}

/// One microphone capture feeds both the original audio file and Speech.
/// Source: https://developer.apple.com/documentation/speech/recognizing-speech-in-live-audio
@MainActor @Observable
final class ChatSpeechRecorder {
    private(set) var recording = false
    private(set) var preparing = false
    private(set) var finishing = false
    var error: String?
    var isActive: Bool { recording || preparing || finishing }
    var needsCaptureRecovery: Bool { recording && engine?.isRunning != true }
    @ObservationIgnored private var engine: AVAudioEngine?
    @ObservationIgnored private var request: SFSpeechAudioBufferRecognitionRequest?
    @ObservationIgnored private var task: SFSpeechRecognitionTask?
    @ObservationIgnored private var file: AVAudioFile?
    @ObservationIgnored private var url: URL?
    @ObservationIgnored private var identity = UUID()
    @ObservationIgnored private var composition = ChatVoiceComposition()
    @ObservationIgnored private var started = Date()
    @ObservationIgnored private var finalWaiter: CheckedContinuation<Void, Never>?
    @ObservationIgnored private var finalTimeout: Task<Void, Never>?
    @ObservationIgnored private var finalized = false
    @ObservationIgnored private var update: ((String) -> Void)?

    func start(draft: String, update: @escaping (String) -> Void) async {
        guard !isActive else { return }
        let marker = UUID(); identity = marker; preparing = true; error = nil
        NotificationCenter.default.post(name: .leafhourChatMicrophoneWillStart, object: nil)
        composition.begin(draft: draft); self.update = update
        let authorization = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
        }
        guard identity == marker else { return }
        guard authorization == .authorized else { fail("请在系统设置中允许语音识别，仍可继续打字。", marker: marker); return }
        let permitted = await withCheckedContinuation { continuation in
            AVAudioSession.sharedInstance().requestRecordPermission { continuation.resume(returning: $0) }
        }
        guard identity == marker else { return }
        guard permitted else { fail("请在系统设置中允许使用麦克风，仍可继续打字。", marker: marker); return }
        guard let recognizer = SFSpeechRecognizer(locale: Locale.current), recognizer.isAvailable else {
            fail("系统语音识别暂不可用，请稍后再试。", marker: marker); return
        }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker, .allowBluetooth])
            try session.setActive(true)
            let engine = AVAudioEngine(), request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = true; request.addsPunctuation = true
            request.requiresOnDeviceRecognition = recognizer.supportsOnDeviceRecognition
            let input = engine.inputNode, format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else { throw LibraryError.invalid("麦克风暂不可用。") }
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("leafhour-voice-" + marker.uuidString + ".caf")
            let file = try AVAudioFile(forWriting: url, settings: format.settings)
            self.engine = engine; self.request = request; self.file = file; self.url = url
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
                request.append(buffer)
                do { try file.write(from: buffer) }
                catch { Task { @MainActor [weak self] in self?.fail("录音暂时无法保存，文字仍保留。", marker: marker) } }
            }
            finalized = false
            task = recognizer.recognitionTask(with: request) { [weak self] result, failure in
                Task { @MainActor in
                    guard let self, self.identity == marker else { return }
                    if let result { self.update?(self.composition.transcribe(result.bestTranscription.formattedString)) }
                    if result?.isFinal == true || failure != nil {
                        self.finalized = true; self.finalWaiter?.resume(); self.finalWaiter = nil
                        if failure != nil && self.recording { self.error = "文字识别暂时中断，录音仍在继续。" }
                    }
                }
            }
            engine.prepare(); try engine.start()
            started = Date(); preparing = false; recording = true
        } catch { fail(error.localizedDescription, marker: marker) }
    }

    func finish() async throws -> ChatRecordedVoice {
        guard recording, let url else { throw LibraryError.invalid("录音尚未准备好。") }
        let marker = identity, duration = max(1, Int(Date().timeIntervalSince(started) * 1000))
        recording = false; finishing = true
        stopCapture(); request?.endAudio()
        if !finalized {
            await withCheckedContinuation { continuation in
                finalWaiter = continuation
                // Apple's final recognition callback can be absent after an interruption.
                // The retained original and latest transcript remain sendable.
                finalTimeout = Task { [weak self] in
                    try? await Task.sleep(for: .seconds(3))
                    guard !Task.isCancelled, let self, self.identity == marker else { return }
                    self.finalWaiter?.resume(); self.finalWaiter = nil
                }
            }
        }
        finalTimeout?.cancel(); finalTimeout = nil
        guard identity == marker, !Task.isCancelled else { throw CancellationError() }
        let transcript = composition.finish()
        releaseAudio(); finishing = false; self.url = nil
        return ChatRecordedVoice(id: marker, url: url, durationMs: duration, transcript: transcript)
    }

    @discardableResult func cancel() -> String {
        let draft = composition.cancel(); identity = UUID()
        finalTimeout?.cancel(); finalTimeout = nil; finalWaiter?.resume(); finalWaiter = nil
        stopCapture(); releaseAudio()
        if let url { try? FileManager.default.removeItem(at: url) }; url = nil
        recording = false; preparing = false; finishing = false; update = nil; error = nil
        return draft
    }
    private func fail(_ message: String, marker: UUID) {
        guard identity == marker else { return }
        let notify = update, restore = cancel(); notify?(restore); error = message
    }
    private func stopCapture() { engine?.stop(); engine?.inputNode.removeTap(onBus: 0); engine = nil; file = nil }
    private func releaseAudio() {
        task?.cancel(); task = nil; request = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
