import Foundation
import Observation

/// Foreground preparation owns no reading progress and never traverses beyond
/// the current chapter and its immediate successor. The server owns billing,
/// source authorization, provider context and durable request deduplication.
@MainActor @Observable public final class ReaderAutomaticTranslation {
    public private(set) var loading = false
    public private(set) var preparingNext = false
    public private(set) var error: String?
    public private(set) var retryRevision = 0
    @ObservationIgnored private var blockedScope: String?
    @ObservationIgnored private var generation = UUID()

    public init() {}
    public func retry() { blockedScope = nil; error = nil; retryRevision += 1 }
    public func stop() { generation = UUID(); loading = false }
    public func scopeKey(_ session: ReaderSession) -> String {
        [session.book.cloud?.ownerID ?? "device", session.book.id, session.book.cloud?.contentVersion ?? session.book.sourceVersion, session.chapter.id].joined(separator:"|")
    }

    public func run(session: ReaderSession, cloud: CloudLibraryClient?, library: OfflineLibrary?, active: Bool) async {
        let stamp = UUID(); generation = stamp
        // Reading a verified cache is independent from enabling generation,
        // network access or the current foreground phase.
        if let data = try? Data(contentsOf: session.directory.appendingPathComponent("cloud-content.json")),
           let content = try? CloudJSON.decode(data) { session.adoptCachedTranslations(content) }
        guard active, session.state.preferences.automaticTranslation,
              session.state.preferences.textMode != .original,
              let cloud, let identity = session.book.cloud else { loading = false; return }
        let scope = scopeKey(session), chapterIndex = session.chapterIndex, chapterID = session.chapter.id
        guard blockedScope != scope else { return }
        loading = true; error = nil; preparingNext = false
        defer { if generation == stamp { loading = false } }
        func current() -> Bool {
            generation == stamp && !Task.isCancelled && session.chapterIndex == chapterIndex
                && session.book.cloud == identity && session.state.preferences.automaticTranslation
                && session.state.preferences.textMode != .original
        }
        let base = "/api/library/books/" + CloudJSON.component(identity.bookID)
        do {
            for phase in ["current", "next"] {
                guard current() else { return }
                let targetIndex = chapterIndex + (phase == "next" ? 1 : 0)
                guard session.book.chapters.indices.contains(targetIndex) else { break }
                let target = session.book.chapters[targetIndex]
                preparingNext = phase == "next"
                let fresh = try await cloud.data(path: base + "/chapters/" + CloudJSON.component(target.id) + "?contentVersion=" + CloudJSON.component(identity.contentVersion), ownerID: identity.ownerID)
                guard current() else { return }
                session.adoptCachedTranslations(try CloudJSON.decode(fresh))
                var received = Set<String>()
                for _ in 0...target.passages.count {
                    guard current() else { return }
                    var body: [String: CloudJSON] = ["chapterId":.string(chapterID),"contentVersion":.string(identity.contentVersion),"phase":.string(phase)]
                    if phase == "current", let id = session.currentAnchor?.passageID,
                       target.passages.contains(where: { $0.id == id }), session.translations[id]?.count != 2 {
                        body["passageId"] = .string(id)
                    }
                    let bytes = try await cloud.data(path: base + "/reading-translation", method:"POST", body:CloudJSON.encode(body), ownerID:identity.ownerID)
                    guard current() else { return }
                    let value = try CloudJSON.decode(bytes)
                    guard value["contentVersion"].string == identity.contentVersion,
                          value["chapterId"].string == target.id, value["phase"].string == phase,
                          case let .bool(done) = value["done"] else { throw LibraryError.invalid("自动准备的来源暂时无法核对，请重试。") }
                    if let id = value["passage"]["id"].string {
                        guard target.passages.contains(where: { $0.id == id && $0.text == value["passage"]["original"].string }),
                              received.insert(id).inserted else { throw LibraryError.invalid("自动准备的进度暂未更新，请重试。") }
                        guard !value["passage"]["translations"].object.isEmpty else { throw LibraryError.invalid("本次译文还未准备好，请重试。") }
                        session.adoptTranslation(value["passage"], contentVersion:identity.contentVersion)
                        if let library {
                            do { try await library.cacheCloudPassage(value["passage"], bookID:session.book.id) }
                            catch { throw LibraryError.invalid("译文已保存到云端，设备缓存暂未更新。请重试同步。") }
                        }
                    } else if !done { throw LibraryError.invalid("自动准备的进度暂未更新，请重试。") }
                    if done { break }
                    try Task.checkCancellation()
                    await Task.yield()
                }
            }
        } catch is CancellationError { }
        catch {
            guard current() else { return }
            blockedScope = scope
            self.error = error.localizedDescription
        }
    }
}
