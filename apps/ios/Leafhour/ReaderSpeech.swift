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

/// One passage is queued at a time. Actual synthesis callbacks own the cursor;
/// local sentence ranges provide display semantics, never an invented timer.
@MainActor @Observable
final class ReaderSpeech: NSObject, AVSpeechSynthesizerDelegate {
    private(set) var playing = false
    private(set) var paused = false
    private(set) var passageID: String?
    private(set) var text = ""
    private(set) var activeSentence = ""
    private(set) var highlight: ReaderSpeechHighlight?
    private(set) var position = 0
    private(set) var count = 0
    var following = true
    var speed = 1.0
    var voiceID = ""
    var message: String?
    @ObservationIgnored private let synthesizer: any ReaderSpeechSynthesizing
    @ObservationIgnored private let audioSession: any ReaderSpeechAudioSession
    @ObservationIgnored private weak var session: ReaderSession?
    @ObservationIgnored private var passages: [(chapter: Int, passage: Int)] = []
    @ObservationIgnored private var content: ReaderSpeechContent?
    @ObservationIgnored private var visible: ReaderSpeechLocation?
    @ObservationIgnored private var manuallyMoved = false
    @ObservationIgnored var readerIsInteracting = false
    @ObservationIgnored private var variant: ReaderTranslationVariant?
    @ObservationIgnored private var markdown: (chapter: Int, layout: MarkdownChapterLayout)?
    @ObservationIgnored private var utterance: AVSpeechUtterance?
    @ObservationIgnored private var utteranceStart = 0
    @ObservationIgnored private var spokenOffset = 0
    @ObservationIgnored private var voiceChangePending = false
    @ObservationIgnored private var lastCheckpoint = Date.distantPast
    @ObservationIgnored private var interruption: NSObjectProtocol?

    override convenience init() { self.init(synthesizer: AVSpeechSynthesizer(), audioSession: AVAudioSession.sharedInstance()) }
    init(synthesizer: any ReaderSpeechSynthesizing, audioSession: any ReaderSpeechAudioSession) {
        self.synthesizer = synthesizer; self.audioSession = audioSession
        super.init(); synthesizer.delegate = self
        interruption = NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor [weak self] in self?.pause() }
        }
    }
    deinit { if let interruption { NotificationCenter.default.removeObserver(interruption) } }
    var voices: [AVSpeechSynthesisVoice] { AVSpeechSynthesisVoice.speechVoices().sorted { ($0.language, $0.name) < ($1.language, $1.name) } }
    var canPrevious: Bool { position > 0 }
    var canNext: Bool { position + 1 < count }
    var chapterID: String? { content?.chapterID }
    var layerTitle: String { content?.layer == "literal" ? "直译" : content?.layer == "interpretive" ? "意译" : "原文" }
    func hasResumePosition(_ session: ReaderSession) -> Bool {
        guard !manuallyMoved, let saved = session.state.listeningPosition,
              saved.sourceVersion == session.book.sourceVersion, saved.viewport == session.currentAnchor,
              saved.layer == "original" || (session.state.preferences.viewMode != .source && saved.layer == session.state.preferences.translationVariant.rawValue),
              let chapter = session.book.chapters.first(where: { $0.id == saved.chapterID }),
              let passage = chapter.passages.first(where: { $0.id == saved.passageID }) else { return false }
        let chosen: ReaderTranslationVariant? = session.state.preferences.viewMode == .source ? nil
            : session.state.preferences.viewMode == .parallel && saved.layer == "original" ? nil : session.state.preferences.translationVariant
        let current = ReaderSpeechContent(chapterID: chapter.id, passage: passage, variant: chosen, translation: session.translations[passage.id])
        return current.layer == saved.layer && current.fingerprint == saved.textFingerprint && (0...current.source.utf16.count).contains(saved.utf16Offset)
    }
    func updateVisible(_ location: ReaderSpeechLocation) { visible = location }
    func userNavigated() { manuallyMoved = true; if playing || paused { following = false } }

    func start(_ session: ReaderSession, useSavedPosition: Bool = true) {
        stop(); self.session = session; message = nil; following = true; markdown = nil
        let anchor = session.currentAnchor
        let location = visible.flatMap { $0.chapterID == session.chapter.id && (anchor == nil || $0.passageID == anchor?.passageID) ? $0 : nil }
        switch session.state.preferences.viewMode {
        case .source: variant = nil
        case .translation: variant = session.state.preferences.translationVariant
        case .parallel: variant = location?.layer == session.state.preferences.translationVariant.rawValue ? session.state.preferences.translationVariant : nil
        }
        passages = session.book.chapters.enumerated().flatMap { chapter, value in
            value.passages.enumerated().compactMap { passage, item in
                item.resourcePath == nil && !item.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? (chapter, passage) : nil
            }
        }
        count = passages.count
        guard count > 0 else { message = "这一页还没有可朗读的文字。扫描 PDF 可以继续看原页。"; return }
        let currentPassageIndex = session.chapter.passages.firstIndex { $0.id == (location?.passageID ?? anchor?.passageID) } ?? 0
        let initialPosition = passages.firstIndex { ref in
            let chapter = session.book.chapters[ref.chapter]
            return chapter.id == session.chapter.id && chapter.passages[ref.passage].id == (location?.passageID ?? anchor?.passageID)
        } ?? passages.firstIndex { $0.chapter > session.chapterIndex || ($0.chapter == session.chapterIndex && $0.passage >= currentPassageIndex) }
        guard let initialPosition else {
            count = 0; passages = []; content = nil; text = ""; activeSentence = ""
            message = "当前位置之后没有可朗读的文字。原页仍可继续阅读。"; return
        }
        position = initialPosition
        let readingPosition = position
        let saved = useSavedPosition && !manuallyMoved ? session.state.listeningPosition : nil
        if let saved, saved.sourceVersion == session.book.sourceVersion, saved.viewport == anchor,
           saved.layer == "original" || saved.layer == session.state.preferences.translationVariant.rawValue,
           let resumeIndex = passages.firstIndex(where: { ref in
               let chapter = session.book.chapters[ref.chapter]
               return chapter.id == saved.chapterID && chapter.passages[ref.passage].id == saved.passageID
           }) {
            let previousVariant = variant
            if session.state.preferences.viewMode == .parallel { variant = ReaderTranslationVariant(rawValue: saved.layer) }
            position = resumeIndex; content = makeContent()
            if let content, content.layer == saved.layer, content.fingerprint == saved.textFingerprint,
               (0...content.source.utf16.count).contains(saved.utf16Offset) {
                manuallyMoved = false; speakCurrent(sourceOffset: saved.utf16Offset); return
            }
            variant = previousVariant; position = readingPosition
        }
        content = makeContent()
        guard let content else { return }
        let offset = location.flatMap { $0.snapshot == content.source && $0.layer == content.layer ? $0.utf16Offset : nil }
            ?? (content.layer == "original" ? SourceTextOffsets(content.source).utf16Offset(forScalarOffset: anchor?.characterOffset ?? 0) : 0)
        manuallyMoved = false
        speakCurrent(sourceOffset: offset)
    }
    func toggle(_ session: ReaderSession) {
        if playing { pause(); return }
        guard paused, self.session === session else { start(session); return }
        if voiceChangePending { speakCurrent(sourceOffset: content?.sourceOffset(at: spokenOffset) ?? 0); return }
        do {
            try audioSession.setActive(true, options: [])
            if synthesizer.continueSpeaking() { playing = true; paused = false; message = nil }
            else { speakCurrent(sourceOffset: content?.sourceOffset(at: spokenOffset) ?? 0) }
        } catch { message = "声音暂时无法继续，请检查音频设备后重试。" }
    }
    func pause() {
        guard playing else { return }
        checkpoint(force: true); paused = true; playing = false
        if !synthesizer.pauseSpeaking(at: .immediate) {
            utterance = nil; synthesizer.stopSpeaking(at: .immediate); voiceChangePending = true
        }
        try? audioSession.setActive(false, options: .notifyOthersOnDeactivation)
    }
    func stop() {
        checkpoint(force: true)
        utterance = nil; voiceChangePending = false
        synthesizer.stopSpeaking(at: .immediate)
        playing = false; paused = false; highlight = nil
        try? audioSession.setActive(false, options: .notifyOthersOnDeactivation)
    }
    func move(_ delta: Int) {
        let next = position + delta
        guard passages.indices.contains(next) else { return }
        checkpoint(force: true); position = next; content = nil; following = true
        speakCurrent(sourceOffset: 0)
    }
    func restartVoice() {
        if playing { speakCurrent(sourceOffset: content?.sourceOffset(at: spokenOffset) ?? 0) }
        else if paused { voiceChangePending = true }
    }
    func contentChanged() {
        guard playing || paused, let current = content, let fresh = makeContent(), current.source != fresh.source || current.layer != fresh.layer || current.text != fresh.text else { return }
        stop(); message = "当前正文或译文已更新，已暂停听书。可以从当前书页重新开始。"
    }
    private func makeContent() -> ReaderSpeechContent? {
        guard let session, passages.indices.contains(position) else { return nil }
        let ref = passages[position], chapter = session.book.chapters[ref.chapter], passage = chapter.passages[ref.passage]
        let usesMarkdown = session.book.rendersMarkdown && (session.state.preferences.viewMode == .source
            || !chapter.passages.contains { session.translations[$0.id]?.text(session.state.preferences.translationVariant) != nil })
        if usesMarkdown, markdown?.chapter != ref.chapter {
            markdown = (ref.chapter, MarkdownChapterLayout(book: session.book, chapter: chapter, original: session.original))
        }
        return ReaderSpeechContent(chapterID: chapter.id, passage: passage, variant: variant,
            translation: session.translations[passage.id], markdown: usesMarkdown ? markdown?.layout : nil, passageIndex: ref.passage)
    }
    private func speakCurrent(sourceOffset: Int) {
        utterance = nil; synthesizer.stopSpeaking(at: .immediate)
        content = makeContent()
        while let current = content, current.sentences.isEmpty, canNext { position += 1; content = makeContent() }
        guard let content, let sentence = content.sentence(at: content.spokenOffset(at: sourceOffset)) else {
            self.content = nil; stop(); message = "当前位置之后没有可朗读的正文。"; return
        }
        do {
            try audioSession.setCategory(.playback, mode: .spokenAudio, options: .duckOthers)
            try audioSession.setActive(true, options: [])
        } catch { message = "声音暂时无法播放，请检查当前音频设备后重试。"; playing = false; paused = false; return }
        message = nil; text = content.text; passageID = content.passageID
        utteranceStart = sentence.location; spokenOffset = utteranceStart
        activeSentence = (text as NSString).substring(with: sentence)
        highlight = nil
        let value = AVSpeechUtterance(string: (text as NSString).substring(from: utteranceStart))
        value.rate = min(AVSpeechUtteranceMaximumSpeechRate, max(AVSpeechUtteranceMinimumSpeechRate, AVSpeechUtteranceDefaultSpeechRate * Float(speed)))
        let recognizer = NLLanguageRecognizer(); recognizer.processString(String(value.speechString.prefix(4000)))
        value.voice = voiceID.isEmpty ? recognizer.dominantLanguage.flatMap { AVSpeechSynthesisVoice(language: $0.rawValue) } : AVSpeechSynthesisVoice(identifier: voiceID)
        utterance = value; voiceChangePending = false; paused = false; playing = true
        synthesizer.speak(value)
    }
    private func checkpoint(force: Bool = false) {
        guard let session, let content, playing || paused,
              force || Date().timeIntervalSince(lastCheckpoint) >= 5 else { return }
        let value = ReaderListeningPosition(sourceVersion: session.book.sourceVersion, chapterID: content.chapterID, passageID: content.passageID,
            layer: content.layer, utf16Offset: content.sourceOffset(at: spokenOffset), textFingerprint: content.fingerprint, viewport: session.currentAnchor)
        guard value != session.state.listeningPosition else { return }
        lastCheckpoint = Date(); session.state.listeningPosition = value; session.save()
    }
    private func spoken(_ range: NSRange, utterance: AVSpeechUtterance) {
        guard self.utterance === utterance, playing, !paused, let content,
              range.location >= 0, range.length > 0, range.location <= utterance.speechString.utf16.count - range.length else { return }
        let word = NSRange(location: utteranceStart + range.location, length: range.length)
        guard word.location >= spokenOffset, let sentence = content.sentence(at: word.location) else { return }
        spokenOffset = word.location
        activeSentence = (content.text as NSString).substring(with: sentence)
        highlight = ReaderSpeechHighlight(location: content.location(at: word.location), sentenceRange: content.sourceRange(sentence), wordRange: content.sourceRange(word))
        checkpoint()
    }
    static func spokenText(_ source: String, kind: BookKind) -> String { kind == .markdown ? MarkdownDocument(source: source).text : source }
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, willSpeakRangeOfSpeechString characterRange: NSRange, utterance: AVSpeechUtterance) {
        Task { @MainActor [weak self] in self?.spoken(characterRange, utterance: utterance) }
    }
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor [weak self] in
            guard let self, self.utterance === utterance, self.playing else { return }
            self.checkpoint(force: true); self.utterance = nil; self.playing = false; self.paused = true; self.voiceChangePending = true
            self.message = "系统朗读已中断，可从当前句继续。"
            try? self.audioSession.setActive(false, options: .notifyOthersOnDeactivation)
        }
    }
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor [weak self] in
            guard let self, self.utterance === utterance else { return }
            if self.paused { self.utterance = nil; self.voiceChangePending = true; return }
            guard self.playing else { return }
            self.checkpoint(force: true)
            if self.canNext { self.position += 1; self.content = nil; self.speakCurrent(sourceOffset: 0) }
            else { self.stop() }
        }
    }
}
