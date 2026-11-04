import Foundation

extension OfflineLibrary {
    static func validateBookmarks(_ bookmarks: [ReaderBookmark], in book: LocalBook) throws {
        guard bookmarks.count <= 10_000 else { throw LibraryError.invalid("书签数量较多，请先保留导出备份。") }
        var ids = Set<UUID>(), positions = Set<String>()
        for bookmark in bookmarks {
            let anchor = bookmark.anchor
            guard ids.insert(bookmark.id).inserted, !bookmark.sourceVersion.isEmpty, bookmark.sourceVersion.utf8.count <= 512,
                  (bookmark.contentVersion?.utf8.count ?? 0) <= 512, anchor.chapterID.utf8.count <= 512, anchor.passageID.utf8.count <= 512,
                  anchor.characterOffset >= 0, anchor.pageY?.isFinite != false, anchor.resourceY?.isFinite != false,
                  bookmark.createdAt.timeIntervalSinceReferenceDate.isFinite, bookmark.modifiedAt.timeIntervalSinceReferenceDate.isFinite,
                  bookmark.name == ReaderBookmark.normalizedName(bookmark.name) else { throw LibraryError.invalid("书签数据无效，未覆盖已有记录。") }
            let key = bookmark.sourceVersion + "\n" + (bookmark.contentVersion ?? "") + "\n" + ReaderBookmark.positionKey(anchor)
            guard positions.insert(key).inserted else { throw LibraryError.invalid("书签位置重复，未覆盖已有记录。") }
            // Stale source anchors remain recoverable without blocking records
            // created against a new verified source. They cannot navigate.
            if bookmark.matchesVersion(of: book), !bookmark.isValid(in: book) { throw LibraryError.invalid("书签与当前原文版本不匹配，未覆盖已有记录。") }
        }
    }
}
