import Foundation
import Observation
import UIKit
import LeafhourCore

@MainActor protocol ReaderVoiceRecording: AnyObject {
    var recording: Bool { get }
    var error: String? { get }
    func start(draft: String, update: @escaping (String) -> Void) async
    func finish() async throws -> ChatRecordedVoice
    @discardableResult func cancel() -> String
}

extension ChatSpeechRecorder: ReaderVoiceRecording { }

/// Owns capture independently of a chat view. A release during permission UI
/// invalidates both our callback and the recorder's pending authorization.
@MainActor @Observable final class ReaderQuickCapture {
    enum Phase { case idle, preparing, recording, finishing }
    private(set) var phase = Phase.idle
    private(set) var transcript = ""
    private(set) var error: String?
    var isCapturing: Bool { phase == .preparing || phase == .recording }
    var canBegin: Bool { phase == .idle }
    @ObservationIgnored private let recorder: any ReaderVoiceRecording
    @ObservationIgnored private var identity = UUID()
    @ObservationIgnored private var completion: ((ChatRecordedVoice, Bool) async -> Void)?
    init(recorder: (any ReaderVoiceRecording)? = nil) { self.recorder = recorder ?? ChatSpeechRecorder() }

    func start(beforeStart: () -> Void = {}, onFinish: @escaping (ChatRecordedVoice, Bool) async -> Void) {
        guard phase == .idle else { return }
        let marker = UUID(); identity = marker
        phase = .preparing; error = nil; transcript = ""; completion = onFinish
        beforeStart()
        Task { [self] in
            guard identity == marker, phase == .preparing else { return }
            await recorder.start(draft: "") { [weak self] text in
                guard self?.identity == marker else { return }; self?.transcript = text
            }
            guard identity == marker else { return }
            phase = recorder.recording ? .recording : .idle
            error = recorder.error
            if phase == .idle { completion = nil }
        }
    }
    func finish(send: Bool = true) {
        guard phase == .recording, recorder.recording else {
            if phase == .preparing { cancel() }
            return
        }
        let marker = identity, callback = completion
        phase = .finishing; completion = nil
        Task { [self] in
            do {
                let voice = try await recorder.finish()
                guard identity == marker else { return }
                phase = .idle
                await callback?(voice, send)
            } catch { if identity == marker { phase = .idle; self.error = error.localizedDescription } }
        }
    }
    func cancel() {
        guard phase != .finishing else { return }
        identity = UUID(); completion = nil; _ = recorder.cancel(); phase = .idle; transcript = ""
    }
    func dismissError() { error = nil }
}

/// Value snapshot taken at touch/hold entry, before permission or network awaits.
struct ReaderQuickQuestionContext: Codable {
    var book: LocalBook
    let chapterID: String
    let chapterTitle: String
    let passageID: String
    let original: String
    let quote: SelectedQuote?
    let ownerID: String
    private enum CodingKeys: String, CodingKey { case book, chapterID, chapterTitle, passageID, original, quote, ownerID }
    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        var identityOnly = book; identityOnly.chapters = []
        try values.encode(identityOnly, forKey: .book)
        try values.encode(chapterID, forKey: .chapterID); try values.encode(chapterTitle, forKey: .chapterTitle)
        try values.encode(passageID, forKey: .passageID); try values.encode(original, forKey: .original)
        try values.encodeIfPresent(quote, forKey: .quote); try values.encode(ownerID, forKey: .ownerID)
    }
    @MainActor init?(session: ReaderSession, quote: SelectedQuote?, ownerID: String? = nil) {
        guard let owner = session.book.cloud?.ownerID ?? ownerID else { return nil }
        guard let passage = ReaderCloudTools.currentPassage(session, selection: quote),
              let chapter = session.book.chapters.first(where: { $0.passages.contains { $0.id == passage.id } }) else { return nil }
        book = session.book; chapterID = chapter.id; chapterTitle = chapter.title
        passageID = passage.id; original = passage.text; self.quote = quote
        self.ownerID = owner
    }
}

struct ReaderPendingQuickRecording: Codable {
    var recording: ChatRecordedVoice
    var context: ReaderQuickQuestionContext
    // Missing legacy intent is retain-only; recovery must never infer consent
    // to send from the existence of a nonempty transcript.
    var sendAfterRetention: Bool? = nil
}

struct ReaderQuickVoiceDraft: Codable {
    let id: String
    let context: ReaderChatContext
    let voice: ChatVoiceReceipt
    var text: String
}

enum ReaderQuickQuestionStatus: Equatable { case idle, pending, ready, attention }

/// The short background allowance is a courtesy for sending/checkpointing, not
/// a promise of unlimited device execution. The original request stays on disk.
@MainActor final class ReaderQuickBackgroundLease {
    private var token = UIBackgroundTaskIdentifier.invalid
    func begin() {
        token = UIApplication.shared.beginBackgroundTask(withName: "Leafhour voice question") { [weak self] in self?.end() }
    }
    func end() {
        guard token != .invalid else { return }
        UIApplication.shared.endBackgroundTask(token); token = .invalid
    }
}
