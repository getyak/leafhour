import AVFoundation
import NaturalLanguage
import Observation
import LeafhourCore

@MainActor
protocol ReaderSpeechSynthesizing: AnyObject {
    var delegate: (any AVSpeechSynthesizerDelegate)? { get set }
    func speak(_ utterance: AVSpeechUtterance)
    @discardableResult func stopSpeaking(at boundary: AVSpeechBoundary) -> Bool
    @discardableResult func pauseSpeaking(at boundary: AVSpeechBoundary) -> Bool
    func continueSpeaking() -> Bool
}
extension AVSpeechSynthesizer: ReaderSpeechSynthesizing { }

@MainActor
protocol ReaderSpeechAudioSession: AnyObject {
    func setCategory(_ category: AVAudioSession.Category, mode: AVAudioSession.Mode, options: AVAudioSession.CategoryOptions) throws
    func setActive(_ active: Bool, options: AVAudioSession.SetActiveOptions) throws
}
extension AVAudioSession: ReaderSpeechAudioSession { }

/// One passage at a time keeps a long chapter out of the synthesizer's queue.
@MainActor @Observable
final class ReaderSpeech: NSObject, AVSpeechSynthesizerDelegate {
    private(set) var playing = false
    private(set) var paused = false
    private(set) var passageID: String?
    private(set) var text = ""
    private(set) var position = 0
    private(set) var count = 0
    var speed = 1.0
    var voiceID = ""
    var message: String?
    @ObservationIgnored private let synthesizer: any ReaderSpeechSynthesizing
    @ObservationIgnored private let audioSession: any ReaderSpeechAudioSession
    @ObservationIgnored private var passages: [Passage] = []
    @ObservationIgnored private var kind: BookKind = .txt
    @ObservationIgnored private var utterance: AVSpeechUtterance?
    @ObservationIgnored private var voiceChangePending = false
    @ObservationIgnored private var interruption: NSObjectProtocol?

    override convenience init() {
        self.init(synthesizer: AVSpeechSynthesizer(), audioSession: AVAudioSession.sharedInstance())
    }
    init(synthesizer: any ReaderSpeechSynthesizing, audioSession: any ReaderSpeechAudioSession) {
        self.synthesizer = synthesizer
        self.audioSession = audioSession
        super.init()
        synthesizer.delegate = self
        interruption = NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor [weak self] in self?.pause() }
        }
    }
    deinit { if let interruption { NotificationCenter.default.removeObserver(interruption) } }
    var voices: [AVSpeechSynthesisVoice] { AVSpeechSynthesisVoice.speechVoices().sorted { ($0.language, $0.name) < ($1.language, $1.name) } }
    var canPrevious: Bool { position > 0 }
    var canNext: Bool { position + 1 < count }

    func start(_ session: ReaderSession) {
        stop()
        kind = session.book.rendersMarkdown ? .markdown : session.book.kind
        passages = session.chapter.passages.filter { $0.resourcePath == nil && !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        count = passages.count
        guard count > 0 else { message = "这一页还没有可朗读的文字。扫描 PDF 可以继续看原页。"; return }
        position = passages.firstIndex { $0.id == session.currentAnchor?.passageID } ?? 0
        speakCurrent()
    }
    func toggle(_ session: ReaderSession) {
        if paused {
            if voiceChangePending { speakCurrent(); return }
            do {
                try audioSession.setActive(true, options: [])
                playing = synthesizer.continueSpeaking(); paused = !playing
            } catch { message = "声音暂时无法继续，请检查音频设备后重试。" }
        }
        else if playing { pause() }
        else { start(session) }
    }
    func pause() {
        guard playing else { return }
        paused = true; playing = false
        // The engine can reject a pause while preparing or finishing an utterance.
        // Keep the reader's intent and rebuild only after an explicit resume.
        if !synthesizer.pauseSpeaking(at: .immediate) {
            utterance = nil
            synthesizer.stopSpeaking(at: .immediate)
            voiceChangePending = true
        }
        try? audioSession.setActive(false, options: .notifyOthersOnDeactivation)
    }
    func stop() {
        voiceChangePending = false
        utterance = nil
        synthesizer.stopSpeaking(at: .immediate)
        playing = false; paused = false
        try? audioSession.setActive(false, options: .notifyOthersOnDeactivation)
    }
    func move(_ delta: Int) {
        let next = position + delta
        guard passages.indices.contains(next) else { return }
        position = next; speakCurrent()
    }
    func restartVoice() {
        if playing { speakCurrent() }
        else if paused { voiceChangePending = true }
    }
    private func speakCurrent() {
        guard passages.indices.contains(position) else { stop(); return }
        utterance = nil; synthesizer.stopSpeaking(at: .immediate)
        do {
            let audio = audioSession
            try audio.setCategory(.playback, mode: .spokenAudio, options: .duckOthers)
            try audio.setActive(true, options: [])
        } catch { message = "声音暂时无法播放，请检查当前音频设备后重试。"; playing = false; paused = false; return }
        let passage = passages[position]
        text = Self.spokenText(passage.text, kind: kind); passageID = passage.id
        let value = AVSpeechUtterance(string: text)
        value.rate = min(AVSpeechUtteranceMaximumSpeechRate, max(AVSpeechUtteranceMinimumSpeechRate, AVSpeechUtteranceDefaultSpeechRate * Float(speed)))
        let recognizer = NLLanguageRecognizer(); recognizer.processString(String(text.prefix(4000)))
        value.voice = voiceID.isEmpty ? recognizer.dominantLanguage.flatMap { AVSpeechSynthesisVoice(language: $0.rawValue) } : AVSpeechSynthesisVoice(identifier: voiceID)
        utterance = value; voiceChangePending = false; paused = false; playing = true
        synthesizer.speak(value)
    }
    static func spokenText(_ source: String, kind: BookKind) -> String {
        kind == .markdown ? MarkdownDocument(source: source).text : source
    }
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor [weak self] in
            guard let self, self.utterance === utterance else { return }
            if self.paused {
                self.utterance = nil; self.voiceChangePending = true
                return
            }
            guard self.playing else { return }
            if self.canNext { self.position += 1; self.speakCurrent() }
            else { self.stop() }
        }
    }
}
