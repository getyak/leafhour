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
    var title: String { local?.title ?? cloud?.title ?? "" }
    var author: String { local?.author ?? cloud?.author ?? "" }
    var isDownloaded: Bool { local != nil }
    var hasCloudUpdate: Bool {
        guard let local, let cloud else { return false }
        return local.cloud?.contentVersion != cloud.contentVersion
    }
}

enum LibraryPresentation {
    static func items(local: [LocalBook], cloud: [CloudShelfBook], query: String = "", filter: LibraryShelfFilter = .all, sort: LibraryShelfSort = .added) -> [LibraryShelfItem] {
        var remoteByID: [String: CloudShelfBook] = [:]
        for book in cloud where remoteByID[book.id] == nil { remoteByID[book.id] = book }
        var seen: Set<String> = []
        var result: [LibraryShelfItem] = []
        let byImport = local.sorted {
            $0.importedAt == $1.importedAt ? $0.id < $1.id : $0.importedAt > $1.importedAt
        }
        for book in byImport {
            let id = book.cloud.map { "cloud:" + $0.bookID } ?? "local:" + book.id
            guard seen.insert(id).inserted else { continue }
            result.append(LibraryShelfItem(id: id, local: book, cloud: book.cloud.flatMap { remoteByID[$0.bookID] }))
        }
        // CloudShelfBook has no added-at field. Preserve the service's shelf order
        // instead of inventing dates for books that have not been downloaded.
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
        case .added: break
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
        return result
    }

    private static func normalized(_ value: String) -> String {
        value.folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive], locale: .current)
    }

    private static func titlePrecedes(_ lhs: LibraryShelfItem, _ rhs: LibraryShelfItem) -> Bool {
        let order = lhs.title.localizedStandardCompare(rhs.title)
        return order == .orderedSame ? lhs.id < rhs.id : order == .orderedAscending
    }
}
