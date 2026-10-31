import Foundation
import LeafhourCore

enum LibraryShelfFilter: String, CaseIterable {
    case all, downloaded, unread, reading, finished, archived
    var title: String { switch self { case .all: "全部"; case .downloaded: "已下载"; case .unread: "未读"; case .reading: "在读"; case .finished: "已读完"; case .archived: "已移除" } }
}

enum LibraryShelfSort: String, CaseIterable {
    case added, recent, title, author
    var title: String {
        switch self {
        case .added: "加入顺序"
        case .recent: "最近阅读"
        case .title: "书名"
        case .author: "作者"
        }
    }
}

enum LibraryShelfLayout: String, CaseIterable {
    case list, grid
    var title: String { self == .list ? "列表" : "封面网格" }
}

struct LibraryShelfItem: Identifiable {
    let id: String
    let local: LocalBook?
    let cloud: CloudShelfBook?
    var isAdditionalVersion = false
    var isArchived = false
    var localActivityAt: Date? = nil
    var title: String { local?.title ?? cloud?.title ?? "" }
    var author: String { local?.author ?? cloud?.author ?? "" }
    var isDownloaded: Bool { local != nil }
    var addedAt: Date? { cloud?.addedAt ?? local?.importedAt }
    var shareText: String { [title, author].filter { !$0.isEmpty }.joined(separator: "\n") }
    // Cloud reading copies contain internal ownership metadata. A source-only
    // text export deliberately does not serialize their manifest or ReaderState.
    var sourceShareText: String {
        ([shareText] + (local?.chapters.map { chapter in
            ([chapter.title] + chapter.passages.filter { $0.resourcePath == nil }.map(\.text)).joined(separator: "\n\n")
        } ?? [])).joined(separator: "\n\n")
    }
    var hasCloudUpdate: Bool {
        guard let local, let cloud else { return false }
        return local.cloud?.contentVersion != cloud.contentVersion
    }
    var accountBookID: String? { cloud?.id ?? local?.cloud?.bookID }
    var readingStatus: CloudBookReadingStatus {
        if let cloud { return cloud.readingStatus }
        if let local, local.cloud == nil { return localActivityAt == nil ? .unread : .reading }
        return .pending
    }
}

struct LibraryShelfPins: Codable {
    private var owners: [String: Set<String>] = [:]
    func ids(owner: String) -> Set<String> { owners[owner] ?? [] }
    mutating func set(_ ids: Set<String>, pinned: Bool, owner: String) {
        var saved = self.ids(owner: owner)
        if pinned { saved.formUnion(ids) } else { saved.subtract(ids) }
        owners[owner] = saved
    }
    func cloudMigrationIDs(owner: String, available: Set<String>, pinsInitialized: Bool, hasPendingPins: Bool) -> Set<String> {
        guard !pinsInitialized, !hasPendingPins else { return [] }
        return Set(ids(owner: owner).filter { $0.hasPrefix("cloud:") }.map { String($0.dropFirst(6)) }).intersection(available)
    }
}

enum LibraryPresentation {
    static func items(local: [LocalBook], cloud: [CloudShelfBook], query: String = "", filter: LibraryShelfFilter = .all, sort: LibraryShelfSort = .added, pinnedIDs: Set<String> = [], snapshot: CloudShelfSnapshot? = nil, localActivity: [String: Date] = [:]) -> [LibraryShelfItem] {
        let archived = snapshot?.isAuthoritative == true ? snapshot!.archivedBookIDs : []
        let cloud = cloud + (snapshot?.archivedBooks ?? [])
        var remoteByID: [String: CloudShelfBook] = [:]
        for book in cloud where remoteByID[book.id] == nil { remoteByID[book.id] = book }
        var seen: Set<String> = []
        var result: [LibraryShelfItem] = []
        let byImport = local.sorted {
            $0.importedAt == $1.importedAt ? $0.id < $1.id : $0.importedAt > $1.importedAt
        }
        var primaryByCloudID: [String: String] = [:]
        var primaryVersionByCloudID: [String: String] = [:]
        for book in byImport {
            guard let identity = book.cloud else { continue }
            if primaryByCloudID[identity.bookID] == nil {
                primaryByCloudID[identity.bookID] = book.id
                primaryVersionByCloudID[identity.bookID] = identity.contentVersion
            }
            if let remote = remoteByID[identity.bookID], identity.contentVersion == remote.contentVersion {
                // A matching current version is preferred even when another copy was imported later.
                if primaryVersionByCloudID[identity.bookID] != remote.contentVersion {
                    primaryByCloudID[identity.bookID] = book.id
                    primaryVersionByCloudID[identity.bookID] = identity.contentVersion
                }
            }
        }
        for book in byImport {
            let additional = book.cloud.map { primaryByCloudID[$0.bookID] != book.id } ?? false
            let id = additional ? "local:" + book.id : (book.cloud.map { "cloud:" + $0.bookID } ?? "local:" + book.id)
            guard seen.insert(id).inserted else { continue }
            result.append(LibraryShelfItem(id: id, local: book, cloud: additional ? nil : book.cloud.flatMap { remoteByID[$0.bookID] }, isAdditionalVersion: additional, isArchived: book.cloud.map { archived.contains($0.bookID) } ?? false, localActivityAt: localActivity[book.id]))
        }
        // Retain service order as a stable fallback for cloud books whose
        // actual addition date is unavailable.
        for book in cloud {
            let id = "cloud:" + book.id
            guard seen.insert(id).inserted else { continue }
            result.append(LibraryShelfItem(id: id, local: nil, cloud: book, isArchived: archived.contains(book.id)))
        }
        let search = normalized(query.trimmingCharacters(in: .whitespacesAndNewlines))
        result = result.filter {
            (filter == .archived ? $0.isArchived : !$0.isArchived)
                && (filter != .downloaded || $0.isDownloaded)
                && (filter != .unread || $0.readingStatus == .unread)
                && (filter != .reading || $0.readingStatus == .reading)
                && (filter != .finished || $0.readingStatus == .finished)
                && (search.isEmpty || normalized($0.title).contains(search) || normalized($0.author).contains(search))
        }
        switch sort {
        case .added:
            let ranks = Dictionary(uniqueKeysWithValues: (snapshot?.order ?? []).enumerated().map { ($0.element, $0.offset) })
            result = result.enumerated().sorted { lhs, rhs in
                if !ranks.isEmpty {
                    let l = lhs.element.accountBookID.flatMap { ranks[$0] }, r = rhs.element.accountBookID.flatMap { ranks[$0] }
                    if l != r { return (l ?? Int.max) < (r ?? Int.max) }
                }
                let left = lhs.element.addedAt, right = rhs.element.addedAt
                if let left, let right, left != right { return left > right }
                if (left != nil) != (right != nil) { return left != nil }
                return lhs.offset < rhs.offset
            }.map(\.element)
        case .recent:
            result = result.enumerated().sorted { lhs, rhs in
                let l = ReadingRecency.maximum([lhs.element.cloud?.activityAt, lhs.element.local.flatMap { localActivity[$0.id] }]), r = ReadingRecency.maximum([rhs.element.cloud?.activityAt, rhs.element.local.flatMap { localActivity[$0.id] }])
                if l != r { return (l ?? .distantPast) > (r ?? .distantPast) }
                return lhs.offset < rhs.offset
            }.map(\.element)
        case .title: result.sort(by: titlePrecedes)
        case .author:
            result.sort { lhs, rhs in
                let left = lhs.author.trimmingCharacters(in: .whitespacesAndNewlines)
                let right = rhs.author.trimmingCharacters(in: .whitespacesAndNewlines)
                if left.isEmpty != right.isEmpty { return !left.isEmpty }
                let order = left.localizedStandardCompare(right)
                return order == .orderedSame ? titlePrecedes(lhs, rhs) : order == .orderedAscending
            }
        }
        return result.filter { pinnedIDs.contains($0.id) } + result.filter { !pinnedIDs.contains($0.id) }
    }

    private static func normalized(_ value: String) -> String {
        value.folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive], locale: .current)
    }

    private static func titlePrecedes(_ lhs: LibraryShelfItem, _ rhs: LibraryShelfItem) -> Bool {
        let order = lhs.title.localizedStandardCompare(rhs.title)
        return order == .orderedSame ? lhs.id < rhs.id : order == .orderedAscending
    }
}
