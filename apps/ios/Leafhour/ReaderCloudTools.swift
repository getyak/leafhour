import Foundation
import Observation
import LeafhourCore

struct ReaderTranslation {
    var original: String
    var literal: String?
    var interpretive: String?
    var literalStatus: String?
    var interpretiveStatus: String?
    var hasBoth: Bool { literal != nil && interpretive != nil }
}
struct ReaderConversationTurn: Identifiable, Codable {
    let id: String
    let question: String
    let answer: String?
    var status: String
    var voice: ChatVoiceReceipt? = nil
    var quote: ReaderTurnQuote? = nil
    var replyTo: ReaderMessageReference? = nil
}
struct ReaderTurnQuote: Codable, Equatable {
    struct Part: Codable, Equatable {
        let passageId: String
        let layer: String
        let text: String
        var label: String { layer == "literal" ? "直译" : layer == "interpretive" ? "意译" : "原文" }
    }
    let kind: String
    let schemaVersion: Int
    let bookId: String
    let chapterId: String
    let parts: [Part]
}
struct ReaderGenerationConsent: Identifiable, Codable {
    let id: String
    let title: String
    let explanation: String
    let path: String
    let ownerID: String
    let body: Data
    let action: String
    let passageID: String
    var preparing: Bool? = nil
}

struct ReaderChatContext: Codable, Equatable {
    let identity: CloudBookIdentity
    let passageID: String
    let chapterTitle: String
    let original: String
    var selection: SelectedQuote? = nil
    var sourceLabel: String {
        if let selection, selection.origin == "translation" {
            let variant = selection.variant == "literal" ? "直译" : selection.variant == "interpretive" ? "意译" : "译文"
            return "选中的" + variant + " · 提问时引用对应原文"
        }
        return selection == nil ? "引用的原文" : "选中的原文"
    }
}
private struct ReaderConversationDraft: Codable {
    let question: String
    let retry: ReaderGenerationConsent?
    var context: ReaderChatContext? = nil
    var voice: ChatVoiceReceipt? = nil
    var contextPinned: Bool? = nil
    var quoteRemoved: Bool? = nil
    var pendingContext: ReaderChatContext? = nil
    var turns: [ReaderConversationTurn]? = nil
    var messageReference: ReaderMessageReference? = nil
    var likedMessages: Set<String>? = nil
}

/// Read-only loading is separate from the explicitly confirmed generation path.
@MainActor @Observable
final class ReaderCloudTools {
    static let libraryChatID = "leafhour-library-chat"
    static let libraryChatVersion = "library-chat-v1"
    static let libraryChatPassage = "conversation"
    static func libraryChatIdentity(ownerID: String) -> CloudBookIdentity {
        CloudBookIdentity(ownerID: ownerID, bookID: libraryChatID, contentVersion: libraryChatVersion, sourceFormat: "")
    }
    private func conversationPath(_ bookID: String) -> String {
        if localConversationBook?.id == bookID { return "/api/library/local-chat" }
        return bookID == Self.libraryChatID ? "/api/library/chat" : bookPath(bookID) + "/chat"
    }
    private(set) var generationTerminalStatus: String?
    var completedTranslation: CloudJSON?
    var translation: ReaderTranslation?
    var introduction = ""
    var introductionOrigin = ""
    var turns: [ReaderConversationTurn] = []
    var pendingMessageReference: ReaderMessageReference? { didSet { queueDraftSave() } }
    private var likedMessages: Set<String> = []
    func referenceMessage(_ turn: ReaderConversationTurn, role: String) {
        guard role == "user" || (role == "assistant" && turn.status == "completed") else { return }
        let text = role == "user" ? turn.question : (turn.answer ?? "")
        guard !text.isEmpty else { return }
        pendingMessageReference = ReaderMessageReference(turnId: turn.id, role: role, text: text)
    }
    func isMessageLiked(turnID: String, role: String) -> Bool { likedMessages.contains(turnID + ":" + role) }
    func toggleMessageLike(turnID: String, role: String) {
        let key = turnID + ":" + role
        if likedMessages.contains(key) { likedMessages.remove(key) } else { likedMessages.insert(key) }
        queueDraftSave()
    }
    var question = "" { didSet { queueDraftSave() } }
    var pendingVoice: ChatVoiceReceipt? { didSet { queueDraftSave() } }
    var scope = "book"
    var scopeRevision = 0
    var conversationAvailable = false
    var loading = false
    var generating = false
    var responseText = ""
    var responseStatus: String?
    var error: String?
    var consent: ReaderGenerationConsent?
    private(set) var retry: ReaderGenerationConsent? { didSet { queueDraftSave() } }
    var chatContext: ReaderChatContext?
    var latestChatContext: ReaderChatContext?
    private var pendingChatContext: ReaderChatContext?
    private var preparingConversation = false
    private var contextPinned = false
    private(set) var chatQuoteRemoved = false
    var canUpdateChatContext: Bool {
        guard let latest = pendingChatContext ?? latestChatContext, retry == nil, !generating, !preparingConversation else { return false }
        return chatContext != latest
    }
    func updateChatContext() {
        guard canUpdateChatContext else { return }
        chatContext = pendingChatContext ?? latestChatContext; latestChatContext = chatContext; pendingChatContext = nil
        contextPinned = true; chatQuoteRemoved = false; queueDraftSave()
    }
    func removeChatSelection() {
        guard retry == nil, !generating, !loading else { return }
        chatContext?.selection = nil; contextPinned = true; chatQuoteRemoved = true; queueDraftSave()
    }
    private func proposeChatContext(_ context: ReaderChatContext, attachSelection: Bool = false) {
        latestChatContext = context
        let busy = retry != nil || generating || preparingConversation
        if attachSelection {
            if busy { pendingChatContext = context; queueDraftSave(); return }
            pendingChatContext = nil; chatContext = context; contextPinned = true; chatQuoteRemoved = false
        } else if !busy && pendingChatContext == nil && (chatContext == nil || (!contextPinned && question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)) {
            chatContext = context
        }
        queueDraftSave()
    }
    private var draftBook: CloudBookIdentity?
    private var draftReady = false
    var draftError: String?
    @ObservationIgnored private var draftWriting: Task<Void, Never>?
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var translationContext: (identity: CloudBookIdentity, passageID: String, language: ReadingLanguage)?
    @ObservationIgnored private var library: OfflineLibrary?
    @ObservationIgnored private var localBookID: String?
    @ObservationIgnored private var localConversationBook: LocalBook?
    @ObservationIgnored private var localExecutor: LocalReadingTools?
    @ObservationIgnored private var progressSequence = 0

    func configure(library: OfflineLibrary?, localBookID: String) { self.library = library; self.localBookID = localBookID }

    func restoreConversationDraft(identity: CloudBookIdentity, library: OfflineLibrary?) async {
        guard !draftReady, let library else { return }
        draftBook = identity; self.library = library
        do {
            if let data = try await library.conversationDraft(bookID: identity.bookID, ownerID: identity.ownerID) {
                let draft = try JSONDecoder().decode(ReaderConversationDraft.self, from: data)
                if let pending = draft.retry {
                    guard pending.ownerID == identity.ownerID, pending.path == conversationPath(identity.bookID), pending.action == "conversation" else {
                        throw LibraryError.invalid("已有对话草稿的归属无法核对，原文件已保留。")
                    }
                }
                if let context = draft.context {
                    guard context.identity.ownerID == identity.ownerID, context.identity.bookID == identity.bookID else {
                        throw LibraryError.invalid("已有草稿的原文归属无法核对。")
                    }
                    chatContext = context
                    contextPinned = draft.contextPinned ?? false
                    chatQuoteRemoved = draft.quoteRemoved ?? false
                }
                if let pending = draft.pendingContext {
                    guard pending.identity.ownerID == identity.ownerID, pending.identity.bookID == identity.bookID else {
                        throw LibraryError.invalid("待引用选文的归属无法核对。")
                    }
                    pendingChatContext = pending
                }
                if turns.isEmpty { turns = draft.turns ?? [] }
                if pendingMessageReference == nil { pendingMessageReference = draft.messageReference }
                likedMessages.formUnion(draft.likedMessages ?? [])
                if question.isEmpty { question = draft.question }
                if retry == nil { retry = draft.retry }
                if pendingVoice == nil { pendingVoice = draft.voice }
            }
            draftReady = true; draftError = nil; queueDraftSave()
        } catch { draftError = "草稿暂时无法读取，原文件已保留。" }
    }
    func retryConversationDraftSave() async {
        queueDraftSave()
        await draftWriting?.value
    }
    func flushConversationDraft() async -> Bool {
        await draftWriting?.value
        return draftError == nil
    }
    private func queueDraftSave() {
        guard draftReady, let identity = draftBook, let library else { return }
        let snapshot = ReaderConversationDraft(question: question, retry: retry?.action == "conversation" ? retry : nil, context: chatContext, voice: pendingVoice, contextPinned: contextPinned, quoteRemoved: chatQuoteRemoved, pendingContext: pendingChatContext, turns: turns, messageReference: pendingMessageReference, likedMessages: likedMessages), previous = draftWriting
        draftWriting = Task {
            await previous?.value
            do {
                let encoded = try await Task.detached(priority: .utility) { try JSONEncoder().encode(snapshot) }.value
                try await library.saveConversationDraft(encoded, bookID: identity.bookID, ownerID: identity.ownerID)
                draftError = nil
            } catch { draftError = "对话草稿尚未保存，请保留此页并重试。" }
        }
    }
    func loadConversation(book: CloudShelfBook, ownerID: String, cloud: CloudLibraryClient) async {
        guard !generating, !preparingConversation else { return }
        let stamp = UUID(); generation = stamp; error = nil; loading = true
        defer { if generation == stamp { loading = false } }
        do {
            let value = try object(await cloud.data(path: bookPath(book.id) + "/chat", ownerID: ownerID))
            try Task.checkCancellation(); guard generation == stamp else { return }
            guard value["bookId"] as? String == book.id, let version = value["contentVersion"] as? String,
                  let context = value["context"] as? [String: Any], let passage = context["passageId"] as? String,
                  let original = context["original"] as? String else { throw LibraryError.invalid("对话引用的原文暂时无法核对，请重试。") }
            proposeChatContext(ReaderChatContext(identity: CloudBookIdentity(ownerID: ownerID, bookID: book.id, contentVersion: version, sourceFormat: ""),
                passageID: passage, chapterTitle: context["chapterTitle"] as? String ?? "", original: original))
            readConversation(value)
        } catch is CancellationError { }
        catch { if generation == stamp { self.error = error.localizedDescription } }
    }
    func loadLibraryConversation(ownerID: String, cloud: CloudLibraryClient) async {
        guard !generating, !preparingConversation else { return }
        let stamp = UUID(); generation = stamp; error = nil; loading = true
        defer { if generation == stamp { loading = false } }
        do {
            let value = try object(await cloud.data(path: "/api/library/chat", ownerID: ownerID))
            try Task.checkCancellation(); guard generation == stamp else { return }
            guard value["bookId"] as? String == Self.libraryChatID,
                  value["contentVersion"] as? String == Self.libraryChatVersion,
                  (value["scope"] as? [String: Any])?["mode"] as? String == "library" else {
                throw LibraryError.invalid("对话暂时无法核对，请重新读取。")
            }
            readConversation(value)
        } catch is CancellationError { }
        catch { if generation == stamp { self.error = error.localizedDescription } }
    }
    func prepareLibraryConversation(ownerID: String, cloud: CloudLibraryClient) async {
        await prepareRequest("conversation", identity: Self.libraryChatIdentity(ownerID: ownerID),
                             passageID: Self.libraryChatPassage, original: "", cloud: cloud)
    }
    func prepareConversation(cloud: CloudLibraryClient) async {
        guard let context = chatContext else { error = "请先重新读取本次引用的原文。"; return }
        await prepareRequest("conversation", identity: context.identity, passageID: context.passageID, original: context.original, selection: context.selection, cloud: cloud)
    }

    static func currentPassage(_ session: ReaderSession, selection: SelectedQuote? = nil) -> Passage? {
        if let selection {
            return session.book.chapters.first { $0.id == selection.anchor.chapterID }?.passages.first { $0.id == selection.anchor.passageID && $0.resourcePath == nil && !$0.text.isEmpty }
        }
        let selection = session.selection?.anchor.chapterID == session.chapter.id ? session.selection?.anchor.passageID : nil
        return session.chapter.passages.first { $0.id == (selection ?? session.currentAnchor?.passageID) && $0.resourcePath == nil && !$0.text.isEmpty }
            ?? session.chapter.passages.first { !$0.heading && $0.resourcePath == nil && !$0.text.isEmpty }
    }
    private func object(_ data: Data) throws -> [String: Any] {
        guard let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw LibraryError.invalid("返回的内容暂时无法读取，请稍后重试。") }
        return value
    }
    private func cached(_ session: ReaderSession) -> [String: Any]? {
        guard !session.packageVerificationPending, session.packageVerificationError == nil, let data = try? Data(contentsOf: session.directory.appendingPathComponent("cloud-content.json")),
              let value = try? object(data), value["contentVersion"] as? String == session.book.cloud?.contentVersion else { return nil }
        return value
    }
    private func paragraph(_ value: [String: Any], id: String) -> [String: Any]? {
        (value["sections"] as? [[String: Any]] ?? []).flatMap { $0["paragraphs"] as? [[String: Any]] ?? [] }.first { $0["id"] as? String == id }
    }
    private func readTranslation(_ value: [String: Any], fallback: String, targetLanguage: ReadingLanguage = .zh) -> ReaderTranslation {
        let translations = value["translations"] as? [String: [String: Any]] ?? [:]
        let literal = translations["literal"].flatMap { ($0["targetLanguage"] as? String ?? "zh") == targetLanguage.rawValue ? $0 : nil }
        let interpretive = translations["interpretive"].flatMap { ($0["targetLanguage"] as? String ?? "zh") == targetLanguage.rawValue ? $0 : nil }
        return ReaderTranslation(original: value["original"] as? String ?? fallback,
            literal: literal?["text"] as? String, interpretive: interpretive?["text"] as? String,
            literalStatus: literal?["status"] as? String, interpretiveStatus: interpretive?["status"] as? String)
    }
    private func component(_ value: String) -> String { CloudJSON.component(value) }
    private func bookPath(_ id: String) -> String { "/api/library/books/" + component(id) }
    func loadTranslation(_ session: ReaderSession, cloud: CloudLibraryClient?) async {
        let stamp = UUID(); generation = stamp; error = nil; loading = false
        translationContext = nil
        guard let passage = Self.currentPassage(session) else { translation = nil; error = "这一页还没有可供翻译的文字。"; return }
        let language = session.translationSettings.targetLanguage
        if let identity = session.book.cloud { translationContext = (identity, passage.id, language) }
        translation = cached(session).flatMap { paragraph($0, id: passage.id) }.map { readTranslation($0, fallback: passage.text, targetLanguage: language) } ?? ReaderTranslation(original: passage.text)
        if let library, let rows = try? await library.readingTranslations(bookID: session.book.id, targetLanguage: language), let saved = rows[passage.id] {
            guard generation == stamp, language == session.translationSettings.targetLanguage else { return }
            translation = ReaderTranslation(original: saved.original, literal: saved.literal, interpretive: saved.interpretive, literalStatus: saved.literalStatus, interpretiveStatus: saved.interpretiveStatus)
        }
        guard let identity = session.book.cloud, let cloud else { return }
        loading = true
        defer { if generation == stamp { loading = false } }
        do {
            let value = try object(try JSONEncoder().encode(await cloud.readingChapter(bookID: identity.bookID, chapterID: session.chapter.id, contentVersion: identity.contentVersion, ownerID: identity.ownerID, targetLanguage: language)))
            try Task.checkCancellation(); guard generation == stamp, language == session.translationSettings.targetLanguage else { return }
            guard let p = paragraph(value, id: passage.id) else { throw LibraryError.invalid("这一段暂时无法核对，请重新打开这本书。") }
            translation = readTranslation(p, fallback: passage.text, targetLanguage: language)
        } catch is CancellationError { }
        catch { if generation == stamp { self.error = "暂时无法更新译文，已保留此设备上的内容。\n" + error.localizedDescription } }
    }
    func loadIntroduction(_ session: ReaderSession, cloud: CloudLibraryClient?) async {
        let stamp = UUID(); generation = stamp; error = nil; loading = false
        let cache = cached(session)
        let stored = cache?["introduction"] as? [String: Any]
        introduction = cache?["description"] as? String ?? stored?["text"] as? String ?? ""
        introductionOrigin = stored == nil ? "书籍简介" : "AI 导读 · 基于开篇的草稿"
        guard let identity = session.book.cloud, let cloud else { return }
        loading = true; defer { if generation == stamp { loading = false } }
        do {
            let value = try object(await cloud.data(path: bookPath(identity.bookID) + "/introduction", ownerID: identity.ownerID))
            try Task.checkCancellation(); guard generation == stamp else { return }
            introduction = value["text"] as? String ?? ""
            introductionOrigin = value["source"] as? String == "ai" ? "AI 导读 · 基于开篇的草稿" : "书籍简介"
        } catch is CancellationError { }
        catch { if generation == stamp { self.error = error.localizedDescription } }
    }
    private func loadLocalConversation(_ session: ReaderSession, cloud: CloudLibraryClient, selection: SelectedQuote?, attachSelection: Bool) async {
        guard !generating, !preparingConversation else { return }
        guard let owner = await cloud.activeAccount()?.id else { error = "请先登录以连接模型服务，书籍可以保留在本机。"; return }
        guard let passage = Self.currentPassage(session, selection: selection) else { error = "此页暂无可读取的文字。扫描页需要先识别文字。"; return }
        let chapter = session.book.chapters.first { $0.id == (selection?.anchor.chapterID ?? session.chapter.id) } ?? session.chapter
        localConversationBook = session.book
        localExecutor = LocalReadingTools(book: session.book, chapterID: chapter.id, passageID: passage.id)
        let identity = CloudBookIdentity(ownerID: owner, bookID: session.book.id, contentVersion: session.book.sourceVersion, sourceFormat: "local")
        await restoreConversationDraft(identity: identity, library: library)
        proposeChatContext(ReaderChatContext(identity: identity, passageID: passage.id, chapterTitle: chapter.title, original: passage.text, selection: selection), attachSelection: attachSelection)
        loading = true; defer { loading = false }
        do {
            let value = try object(await cloud.data(path: "/api/library/local-chat", ownerID: owner))
            conversationAvailable = value["available"] as? Bool ?? false
        } catch is CancellationError { }
        catch { self.error = error.localizedDescription }
    }

    func loadConversation(_ session: ReaderSession, cloud: CloudLibraryClient?, selection: SelectedQuote? = nil, attachSelection: Bool = false) async {
        if session.book.cloud == nil, let cloud { await loadLocalConversation(session, cloud: cloud, selection: selection, attachSelection: attachSelection); return }
        guard let identity = session.book.cloud, let cloud, let passage = Self.currentPassage(session, selection: selection) else {
            if attachSelection && !generating && !preparingConversation && retry == nil { chatQuoteRemoved = false }
            return
        }
        let chapter = session.book.chapters.first { $0.passages.contains { $0.id == passage.id } }
        proposeChatContext(ReaderChatContext(identity: identity, passageID: passage.id, chapterTitle: chapter?.title ?? "", original: passage.text, selection: selection), attachSelection: attachSelection)
        // Capture an explicitly attached quote even while another immutable send
        // is preparing or running. A read must not reset that send's loading flag.
        guard !generating, !preparingConversation else { return }
        let stamp = UUID(); generation = stamp; error = nil; loading = true
        defer { if generation == stamp { loading = false } }
        do {
            let value = try object(await cloud.data(path: bookPath(identity.bookID) + "/chat?passageId=" + component(passage.id), ownerID: identity.ownerID))
            try Task.checkCancellation(); guard generation == stamp else { return }
            readConversation(value)
        } catch is CancellationError { }
        catch { if generation == stamp { self.error = error.localizedDescription } }
    }
    private static func readMessageReference(_ value: Any?) -> ReaderMessageReference? {
        guard let value = value as? [String: Any], let turnID = value["turnId"] as? String,
              let role = value["role"] as? String, ["user", "assistant"].contains(role), let text = value["text"] as? String, !text.isEmpty else { return nil }
        return ReaderMessageReference(turnId: turnID, role: role, text: text)
    }
    private static func readTurnQuote(_ value: Any?) -> ReaderTurnQuote? {
        guard let object = value as? [String: Any], let data = try? JSONSerialization.data(withJSONObject: object),
              let quote = try? JSONDecoder().decode(ReaderTurnQuote.self, from: data),
              quote.kind == "leafhour-reading-quote", quote.schemaVersion == 1, !quote.parts.isEmpty,
              quote.parts.allSatisfy({ !$0.text.isEmpty && ["original", "literal", "interpretive"].contains($0.layer) }) else { return nil }
        return quote
    }
    private func readConversation(_ value: [String: Any]) {
        let currentScope = value["scope"] as? [String: Any] ?? [:]
        scope = currentScope["mode"] as? String ?? "book"
        scopeRevision = currentScope["revision"] as? Int ?? 0
        conversationAvailable = value["available"] as? Bool ?? false
        turns = (value["turns"] as? [[String: Any]] ?? []).compactMap { turn in
            guard let id = turn["id"] as? String else { return nil }
            let answer = turn["answer"] as? [String: Any]
            return ReaderConversationTurn(id: id, question: turn["text"] as? String ?? "", answer: answer?["summary"] as? String, status: turn["status"] as? String ?? "failed", voice: Self.voiceReceipt(turn["voice"]), quote: Self.readTurnQuote(turn["quote"]), replyTo: Self.readMessageReference(turn["replyTo"]))
        }
    }
    private static func voiceReceipt(_ value: Any?) -> ChatVoiceReceipt? {
        guard let value, JSONSerialization.isValidJSONObject(value), let data = try? JSONSerialization.data(withJSONObject: value),
              let receipt = try? JSONDecoder().decode(ChatVoiceReceipt.self, from: data), receipt.isValid else { return nil }
        return receipt
    }
    func attachVoice(_ recording: ChatRecordedVoice) async throws {
        guard let identity = draftBook, let library else { throw LibraryError.invalid("请先进入自己的书房，录音仍保留在此设备。") }
        let receipt = try await library.retainChatVoice(recording.url, id: recording.id, ownerID: identity.ownerID, durationMs: recording.durationMs)
        pendingVoice = receipt
        question = recording.transcript
        guard await flushConversationDraft() else { throw LibraryError.invalid("录音已保留，文字草稿尚未保存，请重试。") }
        try? FileManager.default.removeItem(at: recording.url)
    }
    func voiceURL(_ receipt: ChatVoiceReceipt, cloud: CloudLibraryClient?) async throws -> URL {
        guard let identity = draftBook, let library else { throw LibraryError.invalid("请先进入自己的书房。") }
        if let cached = try? await library.chatVoiceURL(receipt, ownerID: identity.ownerID) { return cached }
        guard let cloud else { throw LibraryError.invalid("语音原件尚未下载，请联网后重试。") }
        let data = try await cloud.downloadChatVoice(receipt, ownerID: identity.ownerID)
        return try await library.cacheChatVoice(data, receipt: receipt, ownerID: identity.ownerID)
    }
    func prepare(_ action: String, session: ReaderSession, cloud: CloudLibraryClient?, selection: SelectedQuote? = nil) async {
        guard !session.packageVerificationPending, session.packageVerificationError == nil else { error = "书籍文件正在校验，请稍后重试。"; return }
        guard let cloud else { error = "请先登录以连接模型服务，书籍可以保留在本机。"; return }
        if action == "conversation", session.book.cloud == nil {
            if chatContext == nil { await loadLocalConversation(session, cloud: cloud, selection: selection, attachSelection: selection != nil) }
            guard let context = chatContext else { return }
            await prepareRequest(action, identity: context.identity, passageID: context.passageID, original: context.original, selection: context.selection, cloud: cloud)
            return
        }
        guard let identity = session.book.cloud, let passage = Self.currentPassage(session, selection: selection) else { error = "此操作需要已连接账号书房的正文。"; return }
        if action == "conversation", let context = chatContext {
            await prepareRequest(action, identity: context.identity, passageID: context.passageID, original: context.original, selection: context.selection, cloud: cloud)
        } else {
            let languages = session.translationSettings
            if action == "translation", !languages.isValid(detected: session.detectedSourceLanguage) { error = "请先设置不同的原文语言与译入语言。"; return }
            await prepareRequest(action, identity: identity, passageID: passage.id, original: passage.text, selection: selection ?? session.selection, cloud: cloud,
                languages: action == "translation" ? languages : nil, detectedSource: session.detectedSourceLanguage)
            if action == "translation", languages != session.translationSettings { consent = nil }
        }
    }
    private func prepareRequest(_ action: String, identity: CloudBookIdentity, passageID: String, original: String, selection: SelectedQuote? = nil, cloud: CloudLibraryClient, languages: BookTranslationSettings? = nil, detectedSource: ReadingLanguage? = nil, resuming: ReaderGenerationConsent? = nil) async {
        guard !generating, !loading else { return }
        guard retry == nil || retry?.id == resuming?.id else { error = "上一次请求的结果尚待确认，请先重试查看本次结果。"; return }
        error = nil; loading = true
        if action == "conversation" { preparingConversation = true }
        defer { loading = false; if action == "conversation" { preparingConversation = false } }
        let requestID = resuming?.id ?? UUID().uuidString.lowercased()
        var body: [String: Any] = ["id": requestID, "passageId": passageID, "contentVersion": identity.contentVersion]
        if let languages {
            body["sourceLanguage"] = languages.resolvedSource(detected: detectedSource)?.rawValue
            body["targetLanguage"] = languages.targetLanguage.rawValue
        }
        if action == "conversation" {
            let restored = resuming.flatMap { try? JSONSerialization.jsonObject(with: $0.body) as? [String: Any] }
            let text = (restored?["text"] as? String ?? question).trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { error = "写点什么，或说一句话。"; return }
            body["text"] = text; body["scopeRevision"] = scopeRevision
            if resuming == nil, let reference = pendingMessageReference {
                body["replyTo"] = ["turnId": reference.turnId, "role": reference.role]
            }
            if let restored { body = restored }
            if let quote = selection, quote.anchor.passageID == passageID {
                let quotedSource = quote.sourceText ?? quote.text
                guard !quotedSource.isEmpty else { error = "请先选择要引用的原文。"; return }
                let scalars = original.unicodeScalars
                let end = scalars.index(scalars.startIndex, offsetBy: min(max(0, quote.anchor.characterOffset), scalars.count))
                let start = String(scalars[..<end]).utf16.count
                let source = original as NSString
                guard start + quotedSource.utf16.count <= source.length, source.substring(with: NSRange(location: start, length: quotedSource.utf16.count)) == quotedSource else {
                    error = "所选文字已变化，请重新选择后再提问。"; return
                }
                body["quote"] = ["kind": "leafhour-reading-quote", "schemaVersion": 1, "bookId": identity.bookID, "contentVersion": identity.contentVersion,
                    "chapterId": quote.anchor.chapterID, "parts": [["passageId": passageID, "layer": "original", "start": start, "end": start + quotedSource.utf16.count, "text": quotedSource]]]
            }
        }
        let submittedReference = action == "conversation" ? pendingMessageReference : nil
        let submittedVoice = action == "conversation" ? pendingVoice : nil
        if action == "conversation" {
            if let book = localConversationBook, identity.bookID == book.id {
                body.removeValue(forKey: "scopeRevision")
                let chapter = book.chapters.first { $0.passages.contains { $0.id == passageID } }
                if resuming == nil {
                    body["localBook"] = ["bookId": book.id, "title": book.title, "author": book.author, "contentVersion": book.sourceVersion,
                        "chapterId": chapter?.id ?? "", "chapterTitle": chapter?.title ?? "", "passageId": passageID, "original": String(original.prefix(6000))]
                    body["history"] = turns.flatMap { turn -> [[String: String]] in
                        var messages = [["role": "user", "content": turn.question]]
                        if let answer = turn.answer, turn.status == "completed" { messages.append(["role": "assistant", "content": answer]) }
                        return messages
                    }
                }
            }
            if let submittedVoice, body["voice"] == nil { body["voice"] = try? JSONSerialization.jsonObject(with: JSONEncoder().encode(submittedVoice)) }
            do {
                let frozen = try JSONSerialization.data(withJSONObject: body)
                retry = ReaderGenerationConsent(id: requestID, title: "发送消息", explanation: "", path: conversationPath(identity.bookID), ownerID: identity.ownerID,
                    body: frozen, action: action, passageID: passageID, preparing: true)
                if !turns.contains(where: { $0.id == requestID }) {
                    let savedQuote = Self.readTurnQuote(body["quote"])
                    turns.append(ReaderConversationTurn(id: requestID, question: body["text"] as? String ?? "", answer: nil, status: "running", voice: submittedVoice, quote: savedQuote, replyTo: resuming == nil ? submittedReference : Self.readMessageReference(body["replyTo"])))
                } else if let index = turns.firstIndex(where: { $0.id == requestID }) { turns[index].status = "running" }
                if resuming == nil { question = ""; pendingVoice = nil; pendingMessageReference = nil }
                chatQuoteRemoved = true; contextPinned = true
                responseText = ""; responseStatus = "正在连接…"; queueDraftSave()
                guard await flushConversationDraft() else { error = draftError; responseStatus = nil; return }
            } catch { self.error = error.localizedDescription; return }
        }
        do {
            let voice = submittedVoice ?? Self.voiceReceipt(body["voice"])
            if action == "conversation", let voice {
                guard let library else { throw LibraryError.invalid("录音尚未保存，请保留此页后重试。") }
                let url = try await library.chatVoiceURL(voice, ownerID: identity.ownerID)
                let receipt = try await cloud.uploadChatVoice(voice, source: url, ownerID: identity.ownerID)
                body["voice"] = try JSONSerialization.jsonObject(with: JSONEncoder().encode(receipt))
            }
            let sessionValue = try object(await cloud.data(path: "/api/auth/session", ownerID: identity.ownerID))
            guard (sessionValue["user"] as? [String: Any])?["id"] as? String == identity.ownerID else { throw LibraryError.invalid("账号已变化，请重新打开自己的书房。") }
            let billing = sessionValue["billing"] as? [String: Any] ?? [:]
            let accountConversation = identity.bookID == Self.libraryChatID && action == "conversation"
            var explanation = accountConversation ? "发送当前问题与对话，可按需查阅自己的书房和公开网络。" : action == "translation" ? "只处理当前段落及必要的相邻上下文。直译和意译独立保存为 AI 草稿。" : "发送当前问题与书内位置，沿用本书的对话。"
            if let languages { explanation += "\n" + (languages.resolvedSource(detected: detectedSource)?.title ?? "待选择") + " → " + languages.targetLanguage.title }
            if !accountConversation { explanation += "\n\n原文：" + String(original.prefix(120)) }
            if billing["enabled"] as? Bool == true {
                let units = action == "translation" ? 1_000_000 : 4_000_000
                let prices = billing["prices"] as? [String: Int] ?? [:]
                guard billing["unitsPerPoint"] as? Int == 1_000_000, prices[action] == units else { throw LibraryError.invalid("阅读点价格已变化，请重新打开书房后再试。") }
                let mode = billing["mode"] as? String ?? ""
                guard ["live", "test"].contains(mode) else { throw LibraryError.invalid("阅读点服务暂时无法核对。") }
                let billingBookID = localConversationBook?.id == identity.bookID && action == "conversation" ? "__leafhour_local_chat__" : identity.bookID
                let quoteBody: [String: Any] = ["action": action, "bookId": billingBookID, "input": body]
                let quote = try object(await cloud.data(path: "/api/billing/quotes", method: "POST", body: JSONSerialization.data(withJSONObject: quoteBody), ownerID: identity.ownerID))
                let quotedScope = quote["scope"] as? [String: Any] ?? [:]
                guard let quoteID = quote["id"] as? String, !quoteID.isEmpty,
                      quote["ownerId"] as? String == identity.ownerID, quote["action"] as? String == action,
                      quote["units"] as? Int == units, quotedScope["bookId"] as? String == billingBookID,
                      quotedScope["requestId"] as? String == requestID, quotedScope["passageId"] as? String == passageID,
                      quotedScope["contentVersion"] as? String == identity.contentVersion,
                      languages == nil || (quotedScope["sourceLanguage"] as? String == body["sourceLanguage"] as? String && quotedScope["targetLanguage"] as? String == body["targetLanguage"] as? String) else { throw LibraryError.invalid("本次点数报价无法核对，尚未提交。") }
                if let quotedMode = quote["mode"] as? String, quotedMode != mode { throw LibraryError.invalid("本次点数报价的模式已变化，尚未提交。") }
                if let expiry = quote["expiresAt"] as? String {
                    let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                    var date = formatter.date(from: expiry)
                    if date == nil { formatter.formatOptions = [.withInternetDateTime]; date = formatter.date(from: expiry) }
                    guard let date, date > Date() else { throw LibraryError.invalid("本次点数报价已过期，尚未提交。") }
                }
                body["billing"] = ["quoteId": quoteID, "idempotencyKey": UUID().uuidString.lowercased()]
                explanation += "\n\n本次使用 \(units / 1_000_000) 阅读点，结果校验并保存后才消费；失败、取消或未交付不消费购买点。"
                if mode == "test" { explanation += "\n当前为沙盒点数，不涉及真实付款。" }
            }
            if action == "conversation" { explanation += scope == "library" ? "\n当前查阅范围：自己的书房与网络。" : "\n当前查阅范围：这本书。" }
            try Task.checkCancellation()
            let intent = ReaderGenerationConsent(id: requestID, title: action == "translation" ? "翻译这一段" : "向陪读提问", explanation: explanation,
                path: action == "translation" ? bookPath(identity.bookID) + "/translate" : conversationPath(identity.bookID), ownerID: identity.ownerID,
                body: try JSONSerialization.data(withJSONObject: body), action: action, passageID: passageID)
            if action == "conversation" { loading = false; await perform(intent, cloud: cloud) }
            else { consent = intent }
        } catch is CancellationError { responseStatus = nil }
        catch {
            self.error = error.localizedDescription; responseStatus = nil
            if error is LibraryError || (error as? CloudRequestError).map(Self.definitivelyRejected) == true {
                // No generation was submitted; restore the draft without losing a newer edit.
                if question.isEmpty { question = body["text"] as? String ?? "" }
                if pendingVoice == nil { pendingVoice = submittedVoice ?? Self.voiceReceipt(body["voice"]) }
                if pendingMessageReference == nil { pendingMessageReference = submittedReference }
                chatQuoteRemoved = false
                turns.removeAll { $0.id == requestID }; retry = nil
            } else if let index = turns.firstIndex(where: { $0.id == requestID }) { turns[index].status = "failed" }
            queueDraftSave()
        }
    }
    private func streamEvent(_ event: CloudJSON, intent: ReaderGenerationConsent, cloud: CloudLibraryClient) async throws {
        guard event["id"].string == nil || event["id"].string == intent.id else { throw LibraryError.invalid("回答的消息归属不一致。") }
        if event["type"].string == "progress", let sequence = event["sequence"].number, Int(sequence) > progressSequence {
            progressSequence = Int(sequence); responseText = event["text"].string ?? ""
            responseStatus = responseText.isEmpty ? "正在查阅…" : "正在回答…"
        }
        if event["type"].string == "tool_request" {
            guard intent.path == "/api/library/local-chat", let executor = localExecutor, let book = localConversationBook,
                  let callID = event["callId"].string, event["bookId"].string == book.id,
                  event["contentVersion"].string == book.sourceVersion, let name = event["name"].string,
                  await cloud.activeAccount()?.id == intent.ownerID else { throw LibraryError.invalid("本机工具请求的书籍或账号已变化。") }
            responseStatus = "正在查阅本机书籍…"
            let result = await executor.execute(name: name, args: event["args"])
            try Task.checkCancellation()
            _ = try await cloud.data(path: intent.path + "/" + component(intent.id) + "/tools/" + component(callID), method: "POST",
                body: CloudJSON.encode(["bookId": .string(book.id), "contentVersion": .string(book.sourceVersion), "result": result]), ownerID: intent.ownerID)
        }
    }
    private func recoverLocal(_ intent: ReaderGenerationConsent, cloud: CloudLibraryClient) async throws -> CloudJSON? {
        for _ in 0..<600 {
            let status: CloudJSON
            do { status = try CloudJSON.decode(await cloud.data(path: intent.path + "/" + component(intent.id), ownerID: intent.ownerID)) }
            catch let error as CloudRequestError where error.status == 404 { return nil }
            if status["turn"]["status"].string != "running" { return status["turn"] }
            for event in status["pendingTools"].array { try await streamEvent(event, intent: intent, cloud: cloud) }
            try await Task.sleep(for: .milliseconds(500))
        }
        throw LibraryError.invalid("回答仍在处理中，可稍后重试查看。")
    }
    func perform(_ intent: ReaderGenerationConsent, cloud: CloudLibraryClient?) async {
        guard !generating, let cloud else { return }
        if intent.preparing == true {
            guard let context = chatContext else { error = "请重新打开本次引用的书籍。"; return }
            await prepareRequest("conversation", identity: context.identity, passageID: intent.passageID, original: context.original, cloud: cloud, resuming: intent)
            return
        }
        let recovering = retry?.id == intent.id && retry?.preparing != true
        consent = nil; retry = intent; error = nil; generating = true; completedTranslation = nil; generationTerminalStatus = nil
        defer { generating = false; responseStatus = nil; queueDraftSave() }
        progressSequence = 0; responseText = ""; responseStatus = "正在回答…"
        if intent.action == "conversation", !(await flushConversationDraft()) { error = draftError; return }
        do {
            if intent.path == "/api/library/local-chat" {
                let request = try CloudJSON.decode(intent.body), context = request["localBook"]
                guard let book = localConversationBook, context["bookId"].string == book.id,
                      context["contentVersion"].string == book.sourceVersion,
                      let chapterID = context["chapterId"].string, let passageID = context["passageId"].string else {
                    throw LibraryError.invalid("本机原文版本已变化，请重新核对本次引用。")
                }
                localExecutor = LocalReadingTools(book: book, chapterID: chapterID, passageID: passageID)
            }
            let data: Data
            if intent.action == "conversation" {
                let recovered = recovering && intent.path == "/api/library/local-chat" ? try await recoverLocal(intent, cloud: cloud) : nil
                let result: CloudJSON
                if let recovered { result = recovered }
                else { result = try await cloud.streamChat(path: intent.path, body: intent.body, ownerID: intent.ownerID) { [weak self] event in
                    try await self?.streamEvent(event, intent: intent, cloud: cloud)
                } }
                data = try JSONEncoder().encode(result)
            } else { data = try await cloud.data(path: intent.path, method: "POST", body: intent.body, ownerID: intent.ownerID) }
            let value = try object(data)
            try Task.checkCancellation()
            if intent.action == "translation" {
                guard value["id"] as? String == intent.passageID else { throw LibraryError.invalid("译文的来源暂时无法核对，尚未显示。") }
                let request = try CloudJSON.decode(intent.body)
                let language = request["targetLanguage"].string.flatMap(ReadingLanguage.init(rawValue:)) ?? .zh
                if let context = translationContext,
                   context.identity.ownerID == intent.ownerID,
                   intent.path == bookPath(context.identity.bookID) + "/translate",
                   context.identity.contentVersion == request["contentVersion"].string,
                   context.passageID == intent.passageID, context.language == language {
                    translation = readTranslation(value, fallback: translation?.original ?? "", targetLanguage: language)
                }
                completedTranslation = try CloudJSON.decode(JSONSerialization.data(withJSONObject: value))
                if let library, let localBookID {
                    do { try await library.cacheCloudPassage(CloudJSON.decode(JSONSerialization.data(withJSONObject: value)), bookID: localBookID, targetLanguage: language) }
                    catch { self.error = "译文已保存到云端，此设备的离线副本暂未更新。可以回书房重新同步。" }
                }
            } else {
                guard value["id"] as? String == intent.id else { throw LibraryError.invalid("回答暂时无法核对，请重试查看本次结果。") }
                let answer = value["answer"] as? [String: Any]
                let status = value["status"] as? String ?? "failed"
                let index = turns.firstIndex { $0.id == intent.id }
                let submitted = (try? JSONSerialization.jsonObject(with: intent.body)) as? [String: Any] ?? [:]
                let turn = ReaderConversationTurn(id: intent.id, question: value["text"] as? String ?? submitted["text"] as? String ?? "", answer: answer?["summary"] as? String, status: status,
                    voice: Self.voiceReceipt(value["voice"]) ?? index.flatMap { turns[$0].voice }, quote: Self.readTurnQuote(value["quote"]) ?? index.flatMap { turns[$0].quote },
                    replyTo: Self.readMessageReference(value["replyTo"]) ?? index.flatMap { turns[$0].replyTo })
                if let index { turns[index] = turn } else { turns.append(turn) }
                responseText = ""
                if status == "running" { error = "回答仍在处理中，可稍后重试查看本次结果。"; return }
                if status != "completed" { error = status == "cancelled" ? "已停止回答，消息仍保留。" : value["error"] as? String ?? "本次回答未完成，你的问题已经保留。" }
                else {
                    let submitted = (try? JSONSerialization.jsonObject(with: intent.body)) as? [String: Any]
                    if submitted?["quote"] != nil {
                        chatContext?.selection = nil; contextPinned = true; chatQuoteRemoved = true; queueDraftSave()
                    }
                }
            }
            retry = nil
        } catch is CancellationError { }
        catch {
            if let index = turns.firstIndex(where: { $0.id == intent.id }) { turns[index].status = "failed" }
            if let rejection = error as? CloudRequestError,
               let status = rejection.billingOperationStatus, ["not_started", "released", "cancelled", "reversed"].contains(status) {
                generationTerminalStatus = status
            }
            if let rejection = error as? CloudRequestError, Self.definitivelyRejected(rejection) {
                retry = nil
                if intent.action == "conversation", question.isEmpty,
                   let submitted = (try? JSONSerialization.jsonObject(with: intent.body)) as? [String: Any] { question = submitted["text"] as? String ?? "" }
                if intent.action == "conversation", pendingMessageReference == nil {
                    pendingMessageReference = turns.first { $0.id == intent.id }?.replyTo
                }
                self.error = error.localizedDescription + "\n请更新当前段落或查阅范围后重新准备，你的问题仍保留。"
            } else { self.error = error.localizedDescription + "\n可重试查看本次结果，不会另建同一请求。" }
        }
    }
    func cancelConversation(cloud: CloudLibraryClient?) async {
        guard generating, let intent = retry, intent.action == "conversation", let cloud else { return }
        do {
            _ = try await cloud.data(path: intent.path + "/" + component(intent.id) + "/cancel", method: "POST", body: Data("{}".utf8), ownerID: intent.ownerID)
        } catch { self.error = "暂时无法确认是否已停止，消息仍保留。" }
    }
    private static func definitivelyRejected(_ error: CloudRequestError) -> Bool {
        if ["not_started", "released", "cancelled", "reversed"].contains(error.billingOperationStatus ?? "") { return true }
        return [400, 401, 403, 404, 405, 410, 412, 413, 415, 422, 429].contains(error.status)
    }
}
