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
struct ReaderConversationTurn: Identifiable {
    let id: String
    let question: String
    let answer: String?
    let status: String
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
}

/// Read-only loading is separate from the explicitly confirmed generation path.
@MainActor @Observable
final class ReaderCloudTools {
    var completedTranslation: CloudJSON?
    var translation: ReaderTranslation?
    var introduction = ""
    var introductionOrigin = ""
    var turns: [ReaderConversationTurn] = []
    var question = ""
    var scope = "book"
    var scopeRevision = 0
    var conversationAvailable = false
    var loading = false
    var generating = false
    var error: String?
    var consent: ReaderGenerationConsent?
    private(set) var retry: ReaderGenerationConsent?
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var translationPassageID: String?
    @ObservationIgnored private var library: OfflineLibrary?
    @ObservationIgnored private var localBookID: String?

    func configure(library: OfflineLibrary?, localBookID: String) { self.library = library; self.localBookID = localBookID }

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
        guard let data = try? Data(contentsOf: session.directory.appendingPathComponent("cloud-content.json")),
              let value = try? object(data), value["contentVersion"] as? String == session.book.cloud?.contentVersion else { return nil }
        return value
    }
    private func paragraph(_ value: [String: Any], id: String) -> [String: Any]? {
        (value["sections"] as? [[String: Any]] ?? []).flatMap { $0["paragraphs"] as? [[String: Any]] ?? [] }.first { $0["id"] as? String == id }
    }
    private func readTranslation(_ value: [String: Any], fallback: String) -> ReaderTranslation {
        let translations = value["translations"] as? [String: [String: Any]] ?? [:]
        let literal = translations["literal"], interpretive = translations["interpretive"]
        return ReaderTranslation(original: value["original"] as? String ?? fallback,
            literal: literal?["text"] as? String, interpretive: interpretive?["text"] as? String,
            literalStatus: literal?["status"] as? String, interpretiveStatus: interpretive?["status"] as? String)
    }
    private func component(_ value: String) -> String { CloudJSON.component(value) }
    private func bookPath(_ id: String) -> String { "/api/library/books/" + component(id) }
    func loadTranslation(_ session: ReaderSession, cloud: CloudLibraryClient?) async {
        let stamp = UUID(); generation = stamp; error = nil; loading = false
        guard let passage = Self.currentPassage(session) else { translation = nil; error = "这一页还没有可供翻译的文字。"; return }
        translationPassageID = passage.id
        translation = cached(session).flatMap { paragraph($0, id: passage.id) }.map { readTranslation($0, fallback: passage.text) } ?? ReaderTranslation(original: passage.text)
        guard let identity = session.book.cloud, let cloud else { return }
        loading = true
        defer { if generation == stamp { loading = false } }
        do {
            let value = try object(await cloud.data(path: bookPath(identity.bookID) + "/chapters/" + component(session.chapter.id) + "?contentVersion=" + component(identity.contentVersion), ownerID: identity.ownerID))
            try Task.checkCancellation(); guard generation == stamp else { return }
            guard let p = paragraph(value, id: passage.id) else { throw LibraryError.invalid("这一段暂时无法核对，请重新打开这本书。") }
            translation = readTranslation(p, fallback: passage.text)
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
    func loadConversation(_ session: ReaderSession, cloud: CloudLibraryClient?, selection: SelectedQuote? = nil) async {
        let stamp = UUID(); generation = stamp; error = nil; loading = false; turns = []; conversationAvailable = false
        guard let identity = session.book.cloud, let cloud, let passage = Self.currentPassage(session, selection: selection) else { return }
        loading = true; defer { if generation == stamp { loading = false } }
        do {
            let value = try object(await cloud.data(path: bookPath(identity.bookID) + "/chat?passageId=" + component(passage.id), ownerID: identity.ownerID))
            try Task.checkCancellation(); guard generation == stamp else { return }
            readConversation(value)
        } catch is CancellationError { }
        catch { if generation == stamp { self.error = error.localizedDescription } }
    }
    private func readConversation(_ value: [String: Any]) {
        let currentScope = value["scope"] as? [String: Any] ?? [:]
        scope = currentScope["mode"] as? String ?? "book"
        scopeRevision = currentScope["revision"] as? Int ?? 0
        conversationAvailable = value["available"] as? Bool ?? false
        turns = (value["turns"] as? [[String: Any]] ?? []).compactMap { turn in
            guard let id = turn["id"] as? String else { return nil }
            let answer = turn["answer"] as? [String: Any]
            return ReaderConversationTurn(id: id, question: turn["text"] as? String ?? "", answer: answer?["summary"] as? String, status: turn["status"] as? String ?? "failed")
        }
    }
    func prepare(_ action: String, session: ReaderSession, cloud: CloudLibraryClient?, selection: SelectedQuote? = nil) async {
        guard !generating, !loading else { return }
        guard retry == nil else { error = "上一次请求的结果尚待确认，请先重试查看本次结果。"; return }
        guard let cloud, let identity = session.book.cloud, let passage = Self.currentPassage(session, selection: selection) else { error = "请先在书房登录，并将这本书同步到自己的账号。"; return }
        error = nil; loading = true; defer { loading = false }
        let requestID = UUID().uuidString.lowercased()
        var body: [String: Any] = ["id": requestID, "passageId": passage.id, "contentVersion": identity.contentVersion]
        if action == "conversation" {
            let text = question.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty, text.utf16.count <= 2000 else { error = "请写下不超过 2,000 字的问题。"; return }
            body["text"] = text; body["scopeRevision"] = scopeRevision
            if let quote = selection ?? session.selection, quote.anchor.passageID == passage.id {
                let quotedSource = quote.sourceText ?? quote.text
                guard !quotedSource.isEmpty, quotedSource.utf16.count <= 2000 else { error = "请选择不超过 2,000 字的原文后再提问。"; return }
                let scalars = passage.text.unicodeScalars
                let end = scalars.index(scalars.startIndex, offsetBy: min(max(0, quote.anchor.characterOffset), scalars.count))
                let start = String(scalars[..<end]).utf16.count
                let source = passage.text as NSString
                guard start + quotedSource.utf16.count <= source.length, source.substring(with: NSRange(location: start, length: quotedSource.utf16.count)) == quotedSource else {
                    error = "所选文字已变化，请重新选择后再提问。"; return
                }
                body["quote"] = ["kind": "leafhour-reading-quote", "schemaVersion": 1, "bookId": identity.bookID, "contentVersion": identity.contentVersion,
                    "chapterId": quote.anchor.chapterID, "parts": [["passageId": passage.id, "layer": "original", "start": start, "end": start + quotedSource.utf16.count, "text": quotedSource]]]
            }
        }
        do {
            let sessionValue = try object(await cloud.data(path: "/api/auth/session", ownerID: identity.ownerID))
            guard (sessionValue["user"] as? [String: Any])?["id"] as? String == identity.ownerID else { throw LibraryError.invalid("账号已变化，请重新打开自己的书房。") }
            let billing = sessionValue["billing"] as? [String: Any] ?? [:]
            var explanation = action == "translation" ? "只处理当前段落及必要的相邻上下文。直译和意译独立保存为 AI 草稿。" : "发送当前问题与书内位置，沿用本书最近的对话。私人笔记不会发送。"
            explanation += "\n\n原文：" + String(passage.text.prefix(120))
            if billing["enabled"] as? Bool == true {
                let units = action == "translation" ? 1_000_000 : 4_000_000
                let prices = billing["prices"] as? [String: Int] ?? [:]
                guard billing["unitsPerPoint"] as? Int == 1_000_000, prices[action] == units else { throw LibraryError.invalid("阅读点价格已变化，请重新打开书房后再试。") }
                let mode = billing["mode"] as? String ?? ""
                guard ["live", "test"].contains(mode) else { throw LibraryError.invalid("阅读点服务暂时无法核对。") }
                let quoteBody: [String: Any] = ["action": action, "bookId": identity.bookID, "input": body]
                let quote = try object(await cloud.data(path: "/api/billing/quotes", method: "POST", body: JSONSerialization.data(withJSONObject: quoteBody), ownerID: identity.ownerID))
                let quotedScope = quote["scope"] as? [String: Any] ?? [:]
                guard let quoteID = quote["id"] as? String, !quoteID.isEmpty,
                      quote["ownerId"] as? String == identity.ownerID, quote["action"] as? String == action,
                      quote["units"] as? Int == units, quotedScope["bookId"] as? String == identity.bookID,
                      quotedScope["requestId"] as? String == requestID, quotedScope["passageId"] as? String == passage.id,
                      quotedScope["contentVersion"] as? String == identity.contentVersion else { throw LibraryError.invalid("本次点数报价无法核对，尚未提交。") }
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
            consent = ReaderGenerationConsent(id: requestID, title: action == "translation" ? "翻译这一段" : "向陪读提问", explanation: explanation,
                path: bookPath(identity.bookID) + (action == "translation" ? "/translate" : "/chat"), ownerID: identity.ownerID,
                body: try JSONSerialization.data(withJSONObject: body), action: action, passageID: passage.id)
        } catch is CancellationError { }
        catch { self.error = error.localizedDescription }
    }
    func perform(_ intent: ReaderGenerationConsent, cloud: CloudLibraryClient?) async {
        guard !generating, let cloud else { return }
        consent = nil; retry = intent; error = nil; generating = true; completedTranslation = nil
        defer { generating = false }
        do {
            let value = try object(await cloud.data(path: intent.path, method: "POST", body: intent.body, ownerID: intent.ownerID))
            try Task.checkCancellation()
            if intent.action == "translation" {
                guard value["id"] as? String == intent.passageID else { throw LibraryError.invalid("译文的来源暂时无法核对，尚未显示。") }
                if translationPassageID == intent.passageID { translation = readTranslation(value, fallback: translation?.original ?? "") }
                completedTranslation = try CloudJSON.decode(JSONSerialization.data(withJSONObject: value))
                if let library, let localBookID {
                    do { try await library.cacheCloudPassage(CloudJSON.decode(JSONSerialization.data(withJSONObject: value)), bookID: localBookID) }
                    catch { self.error = "译文已保存到云端，此设备的离线副本暂未更新。可以回书房重新同步。" }
                }
            } else {
                guard value["id"] as? String == intent.id else { throw LibraryError.invalid("回答暂时无法核对，请重试查看本次结果。") }
                let answer = value["answer"] as? [String: Any]
                let status = value["status"] as? String ?? "failed"
                turns.removeAll { $0.id == intent.id }
                turns.append(ReaderConversationTurn(id: intent.id, question: value["text"] as? String ?? question, answer: answer?["summary"] as? String, status: status))
                if status == "running" { error = "回答仍在处理中，可稍后重试查看本次结果。"; return }
                if status != "completed" { error = value["error"] as? String ?? "本次回答未完成，你的问题已经保留。" }
                else { question = "" }
            }
            retry = nil
        } catch is CancellationError { }
        catch {
            if let rejection = error as? CloudRequestError, Self.definitivelyRejected(rejection) {
                retry = nil
                self.error = error.localizedDescription + "\n请更新当前段落或查阅范围后重新准备，你的问题仍保留。"
            } else { self.error = error.localizedDescription + "\n可重试查看本次结果，不会另建同一请求。" }
        }
    }
    private static func definitivelyRejected(_ error: CloudRequestError) -> Bool {
        if ["not_started", "released", "cancelled", "reversed"].contains(error.billingOperationStatus ?? "") { return true }
        return [400, 401, 403, 404, 405, 410, 412, 413, 415, 422, 429].contains(error.status)
    }
}
