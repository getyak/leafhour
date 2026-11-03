import AVFoundation
import NaturalLanguage
import Observation
import UIKit
import LeafhourCore

@MainActor
protocol ReaderSpeechSynthesizing: AnyObject {
    var delegate: (any AVSpeechSynthesizerDelegate)? { get set }
    var playbackRate: Float { get set }
    var isOutputPlaying: Bool { get }
    var onOutputStateChange: (@MainActor (Bool) -> Void)? { get set }
    func speak(_ utterance: AVSpeechUtterance)
    @discardableResult func stopSpeaking(at boundary: AVSpeechBoundary) -> Bool
    @discardableResult func pauseSpeaking(at boundary: AVSpeechBoundary) -> Bool
    func continueSpeaking() -> Bool
}

extension ReaderSpeechSynthesizing {
    var isOutputPlaying: Bool { false }
    var onOutputStateChange: (@MainActor (Bool) -> Void)? { get { nil } set {} }
}

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
    private(set) var isOutputPlaying = false
    private(set) var bookCoverImage: UIImage?
    private(set) var lockScreenArtwork: UIImage?
    private(set) var passageID: String?
    private(set) var text = ""
    private(set) var activeSentence = ""
    private(set) var spokenWordRange: NSRange?
    private(set) var highlight: ReaderSpeechHighlight?
    private(set) var position = 0
    private(set) var count = 0
    var following = true
    private(set) var boosting = false
    var speed = 1.0 {
        didSet {
            let valid = speed.isFinite ? min(5, max(0.5, speed)) : 1
            if speed != valid { speed = valid }
            synthesizer.playbackRate = Float(valid)
            refreshNowPlaying()
        }
    }
    var voiceID = ""
    var message: String?
    @ObservationIgnored private let synthesizer: any ReaderSpeechSynthesizing
    @ObservationIgnored private let audioSession: any ReaderSpeechAudioSession
    @ObservationIgnored private let audioOwnershipID = UUID()
    @ObservationIgnored private var wasSuperseded = false
    @ObservationIgnored private weak var session: ReaderSession?
    @ObservationIgnored private var passages: [(chapter: Int, passage: Int)] = []
    @ObservationIgnored private var chapterRanges: [Int: Range<Int>] = [:]
    @ObservationIgnored private var chapterStarts: [Int: Int] = [:]
    @ObservationIgnored private var unavailableChapters: Set<Int> = []
    @ObservationIgnored private var content: ReaderSpeechContent?
    @ObservationIgnored private var visible: ReaderSpeechLocation?
    @ObservationIgnored private var manuallyMoved = false
    @ObservationIgnored var readerIsInteracting = false
    @ObservationIgnored private var variant: ReaderTranslationVariant?
    @ObservationIgnored private var markdown: (chapter: Int, layout: MarkdownChapterLayout)?
    @ObservationIgnored private var probeMarkdown: [Int: MarkdownChapterLayout] = [:]
    @ObservationIgnored private var utterance: AVSpeechUtterance?
    @ObservationIgnored private var utteranceStart = 0
    @ObservationIgnored private var spokenOffset = 0
    @ObservationIgnored private var voiceChangePending = false
    @ObservationIgnored private var lastCheckpoint = Date.distantPast
    @ObservationIgnored private var interruption: NSObjectProtocol?
    @ObservationIgnored private var speedBeforeBoost: Double?
    @ObservationIgnored private var routeChange: NSObjectProtocol?
    @ObservationIgnored private var microphoneStart: NSObjectProtocol?
    @ObservationIgnored private let nowPlayingCenter: ReaderNowPlayingCenter?
    @ObservationIgnored private var nowPlaying: ReaderNowPlayingController?
    @ObservationIgnored private let coverLoader: any ReaderListeningCoverLoading
    @ObservationIgnored private weak var presentationSession: ReaderSession?
    @ObservationIgnored private var artworkOwnerID: String?
    @ObservationIgnored private var artworkGeneration = UUID()
    @ObservationIgnored private var artworkTask: Task<UIImage?, Never>?
    @ObservationIgnored private var artworkTraits = UITraitCollection(userInterfaceStyle: .light)

    override convenience init() {
        self.init(synthesizer: ReaderSpeechAudioPlayer(), audioSession: AVAudioSession.sharedInstance(), nowPlayingCenter: .shared)
    }
    init(synthesizer: any ReaderSpeechSynthesizing, audioSession: any ReaderSpeechAudioSession,
         nowPlayingCenter: ReaderNowPlayingCenter? = nil, coverLoader: (any ReaderListeningCoverLoading)? = nil) {
        self.synthesizer = synthesizer; self.audioSession = audioSession; self.nowPlayingCenter = nowPlayingCenter
        self.coverLoader = coverLoader ?? ReaderListeningCoverLoader()
        super.init(); synthesizer.delegate = self
        synthesizer.onOutputStateChange = { [weak self] value in self?.outputChanged(value) }
        interruption = NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] notification in
            let type = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
            guard type == nil || type == AVAudioSession.InterruptionType.began.rawValue else { return }
            Task { @MainActor [weak self] in self?.pause() }
        }
        routeChange = NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] notification in
            guard notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue else { return }
            Task { @MainActor [weak self] in self?.pause() }
        }
        microphoneStart = NotificationCenter.default.addObserver(forName: .leafhourChatMicrophoneWillStart, object: nil, queue: .main) { [weak self] _ in
            // The recorder posts before claiming AVAudioSession. Complete this
            // handoff now, so a deferred pause cannot deactivate its capture.
            MainActor.assumeIsolated { self?.microphoneWillStart() }
        }
    }
    deinit {
        if let interruption { NotificationCenter.default.removeObserver(interruption) }
        if let routeChange { NotificationCenter.default.removeObserver(routeChange) }
        if let microphoneStart { NotificationCenter.default.removeObserver(microphoneStart) }
        artworkTask?.cancel()
        let audio = audioSession, owner = audioOwnershipID
        Task { @MainActor in
            if ReaderSpeechAudioOwnership.release(audio, owner: owner) {
                try? audio.setActive(false, options: .notifyOthersOnDeactivation)
            }
        }
    }
    var voices: [AVSpeechSynthesisVoice] { AVSpeechSynthesisVoice.speechVoices().sorted { ($0.language, $0.name) < ($1.language, $1.name) } }
    var canPrevious: Bool { position > 0 }
    var canNext: Bool { position + 1 < count }
    var canPreviousChapter: Bool { chapterTarget(-1) != nil }
    var canNextChapter: Bool { chapterTarget(1) != nil }
    var chapterID: String? { content?.chapterID }
    var layerTitle: String { content?.layer == "literal" ? "直译" : content?.layer == "interpretive" ? "意译" : "原文" }
    var displayOffset: Int { spokenWordRange?.location ?? spokenOffset }
    var layer: String { content?.layer ?? "original" }
    var requestedLayer: String { variant?.rawValue ?? "original" }
    func beginSpeedBoost() {
        guard playing, speedBeforeBoost == nil else { return }
        speedBeforeBoost = speed; boosting = true; speed = min(5, max(2, speed + 0.5))
    }
    func increaseSpeedBoost() { if speedBeforeBoost != nil { speed = min(5, speed + 0.25) } }
    func endSpeedBoost() {
        guard let previous = speedBeforeBoost else { return }
        speedBeforeBoost = nil; boosting = false; speed = previous
    }
    /// Validate a transcript's immutable source before interrupting live audio.
    @discardableResult func seek(_ session: ReaderSession, to location: ReaderSpeechLocation) -> Bool {
        guard let chapterIndex = session.book.chapters.firstIndex(where: { $0.id == location.chapterID }),
              let passageIndex = session.book.chapters[chapterIndex].passages.firstIndex(where: { $0.id == location.passageID }),
              location.layer == "original" || ReaderTranslationVariant(rawValue: location.layer) != nil else { return false }
        let passage = session.book.chapters[chapterIndex].passages[passageIndex]
        guard passage.resourcePath == nil else { return false }
        var requestedVariant = ReaderTranslationVariant(rawValue: location.layer)
        if location.layer == "original" {
            let activeVariant = self.session === session && (playing || paused) ? variant : nil
            let preferred = activeVariant ?? (session.state.preferences.viewMode == .translation ? session.state.preferences.translationVariant : nil)
            if let preferred {
                let fallback = ReaderSpeechContent(chapterID: location.chapterID, passage: passage, variant: preferred, translation: session.translations[passage.id])
                // A heading or missing translation can display original text
                // while the narration still requests the configured variant.
                // A real translated counterpart keeps an explicit original seek.
                if fallback.layer == "original", fallback.source == location.snapshot { requestedVariant = preferred }
            }
        }
        let candidate = ReaderSpeechContent(chapterID: location.chapterID, passage: passage, variant: requestedVariant, translation: session.translations[passage.id])
        guard candidate.layer == location.layer, candidate.source == location.snapshot,
              location.utf16Offset >= 0, location.utf16Offset < candidate.source.utf16.count,
              SourceTextOffsets(candidate.source).utf16Offset(forScalarOffset: SourceTextOffsets(candidate.source).scalarOffset(forUTF16Offset: location.utf16Offset)) == location.utf16Offset else { return false }
        stop(); self.session = session; bindPresentation(session); variant = requestedVariant; markdown = nil
        passages = session.book.chapters.enumerated().flatMap { chapter, value in
            value.passages.enumerated().compactMap { index, item in
                item.resourcePath == nil && !item.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? (chapter, index) : nil
            }
        }
        indexChapters()
        guard let index = passages.firstIndex(where: { $0.chapter == chapterIndex && $0.passage == passageIndex }) else { return false }
        count = passages.count; position = index; following = true; manuallyMoved = false
        speakCurrent(sourceOffset: location.utf16Offset)
        return playing
    }
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
        stop(); self.session = session; bindPresentation(session); message = nil; following = true; markdown = nil
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
        indexChapters()
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
            claimAudioSession()
            try audioSession.setActive(true, options: [])
            if synthesizer.continueSpeaking() { playing = true; paused = false; message = nil; isOutputPlaying = synthesizer.isOutputPlaying; refreshNowPlaying() }
            else { speakCurrent(sourceOffset: content?.sourceOffset(at: spokenOffset) ?? 0) }
        } catch { deactivateAudioSession(); message = "声音暂时无法继续，请检查音频设备后重试。" }
    }
    func pause() {
        endSpeedBoost()
        guard playing else { return }
        checkpoint(force: true); paused = true; playing = false
        if !synthesizer.pauseSpeaking(at: .immediate) {
            utterance = nil; synthesizer.stopSpeaking(at: .immediate); voiceChangePending = true
        }
        isOutputPlaying = false; refreshNowPlaying()
        deactivateAudioSession()
    }
    func stop() {
        endSpeedBoost()
        checkpoint(force: true)
        utterance = nil; voiceChangePending = false
        playing = false; paused = false; isOutputPlaying = false; highlight = nil; spokenWordRange = nil
        synthesizer.stopSpeaking(at: .immediate)
        nowPlaying?.clear(); nowPlaying = nil
        deactivateAudioSession()
    }
    func move(_ delta: Int) {
        let next = position + delta
        guard passages.indices.contains(next) else { return }
        checkpoint(force: true); position = next; content = nil; following = true
        speakCurrent(sourceOffset: 0)
    }
    func moveChapter(_ delta: Int) {
        guard let session, let next = chapterTarget(delta) else { return }
        selectChapter(session.book.chapters[passages[next].chapter].id)
    }
    func chapterID(adjacentTo chapterID: String, delta: Int) -> String? {
        guard let session, let chapter = session.book.chapters.firstIndex(where: { $0.id == chapterID }),
              let next = chapterTarget(delta, from: chapter) else { return nil }
        return session.book.chapters[passages[next].chapter].id
    }
    @discardableResult func selectChapter(_ chapterID: String) -> Bool {
        guard playing || paused, !wasSuperseded, nowPlaying?.isCurrentOwner != false,
              let session, presentationSession === session,
              let chapter = session.book.chapters.firstIndex(where: { $0.id == chapterID }),
              let next = chapterStart(chapter) else { return false }
        let continuesPlayback = playing
        checkpoint(force: true); position = next; content = nil; following = true
        if continuesPlayback { speakCurrent(sourceOffset: 0); return playing }
        // A paused destination owns no audio output. Discard the previous
        // chapter's buffer and prepare the new cursor for explicit resume.
        utterance = nil; voiceChangePending = true
        synthesizer.stopSpeaking(at: .immediate)
        content = makeContent()
        guard let content, let sentence = content.sentences.first else { return false }
        text = content.text; passageID = content.passageID
        utteranceStart = sentence.location; spokenOffset = sentence.location
        activeSentence = (text as NSString).substring(with: sentence)
        highlight = nil; spokenWordRange = nil; isOutputPlaying = false; message = nil
        checkpoint(force: true); refreshNowPlaying()
        return true
    }
    func applicationDidBackground() {
        endSpeedBoost()
        checkpoint(force: true)
    }
    func releasePresentation() {
        stop()
        artworkGeneration = UUID(); artworkTask?.cancel(); artworkTask = nil
        bookCoverImage = nil; lockScreenArtwork = nil
        presentationSession = nil; artworkOwnerID = nil; session = nil; probeMarkdown = [:]
    }
    func prepareArtwork(_ session: ReaderSession, cloud: CloudLibraryClient?, library: OfflineLibrary?, traits: UITraitCollection) async {
        guard !Task.isCancelled else { return }
        if let current = self.session, current !== session, playing || paused { stop() }
        bindPresentation(session)
        artworkGeneration = UUID(); let request = artworkGeneration
        artworkTask?.cancel(); artworkTask = nil
        artworkTraits = traits
        let accountID = await cloud?.activeAccount()?.id
        guard !Task.isCancelled, artworkGeneration == request, presentationSession === session else { return }
        if let owner = session.book.cloud?.ownerID, cloud != nil, owner != accountID {
            releasePresentation(); return
        }
        let owner = session.book.cloud?.ownerID ?? accountID
        artworkOwnerID = owner
        lockScreenArtwork = ReaderListeningArtwork.render(title: session.book.title, author: session.book.author,
            cover: bookCoverImage, preferences: session.state.preferences, traits: traits)
        refreshNowPlaying()
        let loader = coverLoader, book = session.book, original = session.original, directory = session.directory
        let task = Task { await loader.load(book: book, original: original, directory: directory, cloud: cloud, library: library) }
        artworkTask = task
        let image = await withTaskCancellationHandler { await task.value } onCancel: { task.cancel() }
        guard !Task.isCancelled, !task.isCancelled, artworkGeneration == request, presentationSession === session else { return }
        if let cloud {
            guard await cloud.activeAccount()?.id == accountID,
                  !Task.isCancelled, artworkGeneration == request, presentationSession === session else { return }
        }
        artworkTask = nil; bookCoverImage = image
        lockScreenArtwork = ReaderListeningArtwork.render(title: book.title, author: book.author,
            cover: image, preferences: session.state.preferences, traits: traits)
        refreshNowPlaying()
    }
    func restartVoice() {
        if playing { speakCurrent(sourceOffset: content?.sourceOffset(at: spokenOffset) ?? 0) }
        else if paused { voiceChangePending = true }
    }
    func contentChanged() {
        markdown = nil; probeMarkdown = [:]; chapterStarts = [:]; unavailableChapters = []
        guard playing || paused, let current = content, let fresh = makeContent(), current.source != fresh.source || current.layer != fresh.layer || current.text != fresh.text else { return }
        stop(); message = "当前正文或译文已更新，已暂停听书。可以从当前书页重新开始。"
    }
    private func makeContent(at requestedPosition: Int? = nil) -> ReaderSpeechContent? {
        let position = requestedPosition ?? self.position
        guard let session, passages.indices.contains(position) else { return nil }
        let ref = passages[position], chapter = session.book.chapters[ref.chapter], passage = chapter.passages[ref.passage]
        let usesMarkdown = session.book.rendersMarkdown && (session.state.preferences.viewMode == .source
            || !chapter.passages.contains { session.translations[$0.id]?.text(session.state.preferences.translationVariant) != nil })
        var layout: MarkdownChapterLayout?
        if usesMarkdown {
            if markdown?.chapter == ref.chapter { layout = markdown?.layout }
            else {
                let prepared = probeMarkdown[ref.chapter]
                    ?? MarkdownChapterLayout(book: session.book, chapter: chapter, original: session.original)
                if requestedPosition == nil { markdown = (ref.chapter, prepared) }
                else { probeMarkdown[ref.chapter] = prepared }
                layout = prepared
            }
        }
        return ReaderSpeechContent(chapterID: chapter.id, passage: passage, variant: variant,
            translation: session.translations[passage.id], markdown: layout, passageIndex: ref.passage)
    }
    private func speakCurrent(sourceOffset: Int) {
        utterance = nil; isOutputPlaying = false; synthesizer.stopSpeaking(at: .immediate)
        content = makeContent()
        while let current = content, current.sentences.isEmpty, canNext { position += 1; content = makeContent() }
        guard let content, let sentence = content.sentence(at: content.spokenOffset(at: sourceOffset)) else {
            self.content = nil; stop(); message = "当前位置之后没有可朗读的正文。"; return
        }
        do {
            claimAudioSession()
            try audioSession.setCategory(.playback, mode: .spokenAudio, options: .duckOthers)
            try audioSession.setActive(true, options: [])
        } catch { message = "声音暂时无法播放，请检查当前音频设备后重试。"; playing = false; paused = false; nowPlaying?.clear(); nowPlaying = nil; deactivateAudioSession(); return }
        message = nil; text = content.text; passageID = content.passageID
        utteranceStart = sentence.location; spokenOffset = utteranceStart
        activeSentence = (text as NSString).substring(with: sentence)
        highlight = nil; spokenWordRange = nil
        let value = AVSpeechUtterance(string: (text as NSString).substring(from: utteranceStart))
        // Synthesize at one stable baseline. AVAudioUnitTimePitch applies the
        // actual multiplier without hitting AVSpeechUtterance's rate ceiling.
        value.rate = AVSpeechUtteranceDefaultSpeechRate
        synthesizer.playbackRate = Float(speed)
        let recognizer = NLLanguageRecognizer(); recognizer.processString(String(value.speechString.prefix(4000)))
        value.voice = voiceID.isEmpty ? recognizer.dominantLanguage.flatMap { AVSpeechSynthesisVoice(language: $0.rawValue) } : AVSpeechSynthesisVoice(identifier: voiceID)
        utterance = value; voiceChangePending = false; paused = false; playing = true
        synthesizer.speak(value)
        isOutputPlaying = synthesizer.isOutputPlaying; refreshNowPlaying()
    }
    private func microphoneWillStart() {
        guard playing || paused else { return }
        pause()
        wasSuperseded = true
        utterance = nil; voiceChangePending = true
        synthesizer.stopSpeaking(at: .immediate)
        nowPlaying?.clear(); nowPlaying = nil
    }
    private func claimAudioSession() {
        wasSuperseded = false
        if nowPlaying?.isCurrentOwner == false { nowPlaying = nil }
        guard let previous = ReaderSpeechAudioOwnership.claim(audioSession, owner: audioOwnershipID, reader: self) else { return }
        // The lease changes before pausing: the old reader must release only its
        // engine, without deactivating the replacement's shared audio session.
        previous.pause()
        previous.wasSuperseded = true
        previous.nowPlaying?.clear(); previous.nowPlaying = nil
    }
    private func deactivateAudioSession() {
        guard ReaderSpeechAudioOwnership.release(audioSession, owner: audioOwnershipID) else { return }
        try? audioSession.setActive(false, options: .notifyOthersOnDeactivation)
    }
    private func indexChapters() {
        chapterRanges = [:]; chapterStarts = [:]; unavailableChapters = []; probeMarkdown = [:]
        for index in passages.indices {
            let chapter = passages[index].chapter
            chapterRanges[chapter] = (chapterRanges[chapter]?.lowerBound ?? index)..<(index + 1)
        }
    }
    private func chapterTarget(_ delta: Int, from chapter: Int? = nil) -> Int? {
        guard let session, delta == -1 || delta == 1, passages.indices.contains(position) else { return nil }
        var candidate = (chapter ?? passages[position].chapter) + delta
        while session.book.chapters.indices.contains(candidate) {
            if let target = chapterStart(candidate) { return target }
            candidate += delta
        }
        return nil
    }
    private func chapterStart(_ chapter: Int) -> Int? {
        if let cached = chapterStarts[chapter] { return cached }
        guard !unavailableChapters.contains(chapter), let range = chapterRanges[chapter] else { return nil }
        for index in range {
            if let candidate = makeContent(at: index), !candidate.sentences.isEmpty {
                chapterStarts[chapter] = index; return index
            }
        }
        unavailableChapters.insert(chapter)
        return nil
    }
    private func bindPresentation(_ session: ReaderSession) {
        guard presentationSession !== session else { return }
        artworkGeneration = UUID(); artworkTask?.cancel(); artworkTask = nil
        nowPlaying?.clear(); nowPlaying = nil
        presentationSession = session; artworkOwnerID = session.book.cloud?.ownerID; probeMarkdown = [:]
        bookCoverImage = nil
        lockScreenArtwork = ReaderListeningArtwork.render(title: session.book.title, author: session.book.author,
            cover: nil, preferences: session.state.preferences, traits: artworkTraits)
    }
    private func outputChanged(_ output: Bool) {
        let active = output && playing && utterance != nil && presentationSession === session
        guard isOutputPlaying != active else { return }
        isOutputPlaying = active; refreshNowPlaying()
    }
    private func refreshNowPlaying() {
        guard !wasSuperseded, nowPlaying?.isCurrentOwner != false,
              let center = nowPlayingCenter, let session, presentationSession === session,
              playing || paused, let content else { return }
        let identity = ReaderNowPlayingIdentity(accountID: artworkOwnerID ?? session.book.cloud?.ownerID,
            bookID: session.book.id, sourceVersion: session.book.sourceVersion)
        let snapshot = ReaderNowPlayingSnapshot(identity: identity, title: session.book.title, author: session.book.author,
            chapterTitle: session.book.chapters.first { $0.id == content.chapterID }?.title,
            isPlaying: playing && isOutputPlaying, playbackRate: speed, artwork: lockScreenArtwork,
            canPreviousChapter: canPreviousChapter, canNextChapter: canNextChapter)
        if nowPlaying?.identity != identity {
            nowPlaying?.clear()
            let controller = ReaderNowPlayingController(identity: identity, center: center,
                play: { [weak self] in
                    guard let self, !self.playing, let session = self.session, self.presentationSession === session else { return }
                    self.toggle(session)
                }, pause: { [weak self] in self?.pause() },
                previousChapter: { [weak self] in self?.moveChapter(-1) }, nextChapter: { [weak self] in self?.moveChapter(1) })
            nowPlaying = controller; controller.publish(snapshot)
        } else {
            nowPlaying?.update(snapshot)
        }
    }
    private func checkpoint(force: Bool = false) {
        guard !wasSuperseded, nowPlaying?.isCurrentOwner != false,
              let session, let content, playing || paused,
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
        spokenOffset = word.location; spokenWordRange = word
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
            self.endSpeedBoost(); self.isOutputPlaying = false; self.refreshNowPlaying()
            self.message = "系统朗读已中断，可从当前句继续。"
            self.deactivateAudioSession()
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

/// AVAudioSession is app-wide in production; isolated test sessions retain their
/// own ownership. Weak readers and immutable lease IDs make late teardown safe.
@MainActor private enum ReaderSpeechAudioOwnership {
    private final class Entry {
        let owner: UUID
        weak var reader: ReaderSpeech?
        init(owner: UUID, reader: ReaderSpeech) { self.owner = owner; self.reader = reader }
    }
    private static var owners: [ObjectIdentifier: Entry] = [:]

    static func claim(_ session: any ReaderSpeechAudioSession, owner: UUID, reader: ReaderSpeech) -> ReaderSpeech? {
        let key = ObjectIdentifier(session)
        guard owners[key]?.owner != owner else { return nil }
        let previous = owners[key]?.reader
        owners[key] = Entry(owner: owner, reader: reader)
        return previous
    }
    static func release(_ session: any ReaderSpeechAudioSession, owner: UUID) -> Bool {
        let key = ObjectIdentifier(session)
        guard owners[key]?.owner == owner else { return false }
        owners[key] = nil
        return true
    }
}
