import Foundation
import Observation
import LeafhourCore

/// An independent, durable search conversation: it never reads or changes Chat drafts.
@MainActor @Observable final class ContentsAISearch {
    private(set) var running = false
    private(set) var matches: [ContentsSourceMatch] = []
    private(set) var hasCompleted = false
    private(set) var submittedQuery = ""
    private(set) var pendingRecovery = false
    private(set) var error: String?
    private(set) var status: String?
    @ObservationIgnored private var worker = ReaderCloudTools()
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var generation = UUID()

    func search(_ query: String, session: ReaderSession, cloud: CloudLibraryClient?, library: OfflineLibrary?, recovering: Bool = false) {
        guard !running, !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        guard let cloud else { error = "登录后可用 AI 查找，原文搜索仍可使用。"; return }
        guard !session.packageVerificationPending, session.packageVerificationError == nil else { error = "书籍正在校验，原文搜索仍可使用。"; return }
        let stamp = UUID(); generation = stamp; running = true; error = nil; hasCompleted = false; matches = []
        status = recovering ? "正在核对上次搜索…" : "AI 正在查找相关原文…"
        let book = session.book, identity = book.cloud
        worker.configure(library: library, localBookID: book.id, draftNamespace: "contents-search:" + book.id)
        task = Task { [weak self] in
            guard let self else { return }
            defer { if self.generation == stamp { self.running = false; self.task = nil; self.status = nil } }
            let owner = await cloud.activeAccount()?.id
            guard let owner, identity == nil || identity?.ownerID == owner else { self.error = "登录状态已变化，请重新打开自己的书房。"; return }
            await self.worker.loadSnapshotConversation(session, cloud: cloud)
            guard !Task.isCancelled, self.generation == stamp else { return }
            if let intent = self.worker.retry {
                self.pendingRecovery = true
                self.submittedQuery = Self.originalQuery(in: intent.body) ?? "上次搜索"
                guard recovering else { self.error = "上次搜索的结果还待核对，请先查看该次结果。"; return }
                await self.worker.perform(intent, cloud: cloud)
            } else {
                self.pendingRecovery = false; self.worker.turns = []; self.submittedQuery = query
                self.worker.question = Self.prompt(query)
                await self.worker.prepare("conversation", session: session, cloud: cloud)
            }
            guard !Task.isCancelled, self.generation == stamp, session.book.id == book.id,
                  session.book.sourceVersion == book.sourceVersion, session.book.cloud == identity,
                  await cloud.activeAccount()?.id == owner else { return }
            self.pendingRecovery = self.worker.retry != nil
            if let turn = self.worker.turns.last, turn.status == "completed", turn.contentVersion == book.sourceVersion {
                let refs = turn.sourceRefs ?? []
                let found = await Task.detached(priority: .userInitiated) { ContentsSourceIndex.validated(refs, in: book) }.value
                guard !Task.isCancelled, self.generation == stamp, await cloud.activeAccount()?.id == owner else { return }
                self.matches = found; self.hasCompleted = true
                self.error = found.isEmpty ? "本次未找到可核对的相关片段，可以换个问法。" : nil
            } else { self.error = self.worker.error ?? "本次搜索未完成，请重试查看原请求。" }
        }
    }
    func stop(cloud: CloudLibraryClient?, clear: Bool = false) {
        generation = UUID(); task?.cancel(); task = nil; running = false
        if clear { matches = []; hasCompleted = false; error = nil }
        guard let intent = worker.retry else { status = nil; return }
        pendingRecovery = true; status = "搜索已在设备停止，正在确认后台状态…"
        guard let cloud, intent.path == "/api/library/local-chat" else { status = "后台停止状态待确认"; return }
        let worker = worker, marker = generation
        Task { [weak self] in
            do {
                let data = try await cloud.data(path: intent.path + "/" + CloudJSON.component(intent.id) + "/cancel", method: "POST", body: Data("{}".utf8), ownerID: intent.ownerID)
                let value = try CloudJSON.decode(data)
                guard self?.generation == marker else { return }
                if value["status"].string == "cancelled", value["id"].string == intent.id {
                    let retired = await worker.clearSnapshotSearchRequest(id: intent.id)
                    guard self?.generation == marker else { return }
                    self?.pendingRecovery = !retired; self?.status = retired ? "已停止搜索" : "搜索已停止，设备记录待核对"
                } else { self?.status = "本次结果已经提交，可核对上次搜索" }
            } catch let failure as CloudRequestError where failure.status == 404 && intent.preparing == true {
                guard self?.generation == marker else { return }
                let retired = await worker.clearSnapshotSearchRequest(id: intent.id)
                guard self?.generation == marker else { return }
                self?.pendingRecovery = !retired; self?.status = retired ? "已停止，尚未提交搜索" : "设备请求记录待核对"
            } catch { if self?.generation == marker { self?.status = "后台停止尚未确认，可核对上次搜索" } }
        }
    }
    private static let questionPrefix = "请在当前这本书的原文中查找与以下问题相关的具体片段：\n"
    private static let questionSuffix = "\n这是目录内搜索。先检索和阅读实际章节，再对每个相关片段使用 reader_cite 登记原文引用，务必包含 chapterId 和 passageId。只查当前本机书籍，不查其他书、不查笔记、不用网络。回答简短说明查到的内容；没有有效来源就明确说明本次未找到，不断言整本书不存在。"
    static func prompt(_ query: String) -> String { questionPrefix + query + questionSuffix }
    static func originalQuery(in body: Data) -> String? {
        guard let value = try? CloudJSON.decode(body), let text = value["text"].string,
              text.hasPrefix(questionPrefix), text.hasSuffix(questionSuffix) else { return nil }
        return String(text.dropFirst(questionPrefix.count).dropLast(questionSuffix.count))
    }
}
