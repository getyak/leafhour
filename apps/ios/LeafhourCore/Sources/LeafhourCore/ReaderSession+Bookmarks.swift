import Foundation

extension ReaderSession {
    public var bookmarks: [ReaderBookmark] { state.bookmarks ?? [] }
    public func bookmark(at anchor: ReadingAnchor? = nil) -> ReaderBookmark? {
        guard let anchor = anchor ?? currentAnchor else { return nil }
        let key = ReaderBookmark.positionKey(anchor)
        return bookmarks.first { $0.isValid(in: book) && ReaderBookmark.positionKey($0.anchor) == key }
    }
    public func bookmarks(in ranges: [ReaderBookmarkVisibleRange]) -> [ReaderBookmark] {
        bookmarks.filter { bookmark in bookmark.isValid(in: book) && ranges.contains { $0.contains(bookmark.anchor) } }
    }
    @discardableResult public func addBookmark(at anchor: ReadingAnchor? = nil) async -> BookmarkSaveResult {
        guard packageVerificationError == nil, let anchor = anchor ?? currentAnchor else { return .unavailable("当前位置尚不可用，请稍后重试。") }
        let candidate = ReaderBookmark(sourceVersion: book.sourceVersion, contentVersion: book.cloud?.contentVersion, anchor: anchor)
        guard candidate.isValid(in: book) else { return .unavailable("书签位置与当前原文不匹配，未保存。") }
        if let existing = bookmark(at: candidate.anchor) {
            // A previous failed write can be retried through the same idempotent action.
            save(); let receipt = await flush()
            return isCurrent(receipt) ? .existing(existing.id) : .failed(saveError ?? "书签尚未保存，请重试。")
        }
        state.bookmarks = bookmarks + [candidate]
        save(); let receipt = await flush()
        return isCurrent(receipt) ? .saved(candidate.id) : .failed(saveError ?? "书签尚未保存，请重试。")
    }
    @discardableResult public func updateBookmark(id: UUID, color: BookmarkColor, name: String?) async -> BookmarkSaveResult {
        guard packageVerificationError == nil, var rows = state.bookmarks, let index = rows.firstIndex(where: { $0.id == id }) else { return .unavailable("此书签已不可用。") }
        rows[index].name = ReaderBookmark.normalizedName(name); rows[index].color = color; rows[index].modifiedAt = Date()
        state.bookmarks = rows
        save(); let receipt = await flush()
        return isCurrent(receipt) ? .saved(id) : .failed(saveError ?? "书签修改尚未保存，请重试。")
    }
    @discardableResult public func removeBookmark(id: UUID) async -> BookmarkSaveResult {
        guard packageVerificationError == nil else { return .unavailable("当前原文不可用，书签仍保留。") }
        let previous = bookmarks.first { $0.id == id }
        state.bookmarks = bookmarks.filter { $0.id != id }
        save(); let receipt = await flush()
        if isCurrent(receipt) { return .saved(id) }
        // Keep a failed removal visible for retry, without replacing another
        // bookmark or unrelated edits made while the disk write was suspended.
        if let previous, !bookmarks.contains(where: { $0.id == id || ($0.sourceVersion == previous.sourceVersion && $0.contentVersion == previous.contentVersion && ReaderBookmark.positionKey($0.anchor) == ReaderBookmark.positionKey(previous.anchor)) }) {
            state.bookmarks = bookmarks + [previous]
        }
        return .failed(saveError ?? "书签移除尚未保存，请重试。")
    }
    @discardableResult public func goToBookmark(id: UUID) -> Bool {
        guard packageVerificationError == nil, let bookmark = bookmarks.first(where: { $0.id == id }) else { return false }
        guard bookmark.isValid(in: book), let chapter = book.chapters.firstIndex(where: { $0.id == bookmark.anchor.chapterID }) else {
            message = "原文版本已变化，书签仍保留，暂时无法跳转。"; return false
        }
        go(to: chapter, anchor: bookmark.anchor); return true
    }
}
