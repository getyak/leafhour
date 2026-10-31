import Foundation
import LeafhourCore

enum LibraryShelfFilter: String, CaseIterable {
    case all, downloaded
    var title: String { self == .all ? "全部" : "已下载" }
}

enum LibraryShelfSort: String, CaseIterable {
    case added, title, author
    var title: String {
        switch self {
        case .added: "加入顺序"
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
}

struct LibraryShelfPins: Codable {
    private var owners: [String: Set<String>] = [:]
    func ids(owner: String) -> Set<String> { owners[owner] ?? [] }
    mutating func set(_ ids: Set<String>, pinned: Bool, owner: String) {
        var saved = self.ids(owner: owner)
        if pinned { saved.formUnion(ids) } else { saved.subtract(ids) }
        owners[owner] = saved
    }
}

enum LibraryPresentation {
    static func items(local: [LocalBook], cloud: [CloudShelfBook], query: String = "", filter: LibraryShelfFilter = .all, sort: LibraryShelfSort = .added, pinnedIDs: Set<String> = []) -> [LibraryShelfItem] {
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
            result.append(LibraryShelfItem(id: id, local: book, cloud: additional ? nil : book.cloud.flatMap { remoteByID[$0.bookID] }, isAdditionalVersion: additional))
        }
        // Retain service order as a stable fallback for cloud books whose
        // actual addition date is unavailable.
        for book in cloud {
            let id = "cloud:" + book.id
            guard seen.insert(id).inserted else { continue }
            result.append(LibraryShelfItem(id: id, local: nil, cloud: book))
        }
        let search = normalized(query.trimmingCharacters(in: .whitespacesAndNewlines))
        result = result.filter {
            (filter == .all || $0.isDownloaded)
                && (search.isEmpty || normalized($0.title).contains(search) || normalized($0.author).contains(search))
        }
        switch sort {
        case .added:
            result = result.enumerated().sorted { lhs, rhs in
                let left = lhs.element.addedAt, right = rhs.element.addedAt
                if let left, let right, left != right { return left > right }
                if (left != nil) != (right != nil) { return left != nil }
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
