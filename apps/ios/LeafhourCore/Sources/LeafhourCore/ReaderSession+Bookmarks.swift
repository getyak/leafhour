import Foundation

extension ReaderSession {
    public var bookmarks: [ReaderBookmark] { state.bookmarks ?? [] }
    public func bookmark(at anchor: ReadingAnchor? = nil) -> ReaderBookmark? {
        guard let anchor = anchor ?? currentAnchor else { return nil }
        return bookmark(capture: ReaderBookmarkCapture(anchor: anchor))
    }
    public func bookmark(capture: ReaderBookmarkCapture) -> ReaderBookmark? {
        let key = ReaderBookmark.positionKey(capture.anchor) + "\n" + (capture.presentation?.positionKey ?? "source")
        return bookmarks.first { $0.isValid(in: book) && $0.positionKey == key }
    }
    public func bookmarks(in ranges: [ReaderBookmarkVisibleRange]) -> [ReaderBookmark] {
        bookmarks.filter { bookmark in bookmark.isValid(in: book) && ranges.contains { $0.contains(bookmark) } }
    }
    @discardableResult public func addBookmark(at anchor: ReadingAnchor? = nil) async -> BookmarkSaveResult {
        guard let anchor = anchor ?? currentAnchor else { return .unavailable("当前位置尚不可用，请稍后重试。") }
        if state.preferences.viewMode == .translation, translations[anchor.passageID]?.text(state.preferences.translationVariant) != nil {
            return .unavailable("译文位置尚未核验，请等待书页稳定后重试。")
        }
        return await addBookmark(capture: ReaderBookmarkCapture(anchor: anchor))
    }
    @discardableResult public func addBookmark(capture: ReaderBookmarkCapture) async -> BookmarkSaveResult {
        guard packageVerificationError == nil else { return .unavailable("当前原文不可用，未保存书签。") }
        let candidate = ReaderBookmark(sourceVersion: book.sourceVersion, contentVersion: book.cloud?.contentVersion, anchor: capture.anchor, presentation: capture.presentation)
        guard candidate.isValid(in: book) else { return .unavailable("书签位置与当前原文不匹配，未保存。") }
        if let presentation = capture.presentation, verifiedBookmarkText(anchor: capture.anchor, presentation: presentation) == nil {
            return .unavailable("译文已变化或尚未就绪，当前位置待核对，未保存书签。")
        }
        if let existing = bookmark(capture: candidate.capture) {
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
        if let previous, !bookmarks.contains(where: { $0.id == id || ($0.sourceVersion == previous.sourceVersion && $0.contentVersion == previous.contentVersion && $0.positionKey == previous.positionKey) }) {
            state.bookmarks = bookmarks + [previous]
        }
        return .failed(saveError ?? "书签移除尚未保存，请重试。")
    }
    @discardableResult public func goToBookmark(id: UUID) -> Bool {
        guard packageVerificationError == nil, let bookmark = bookmarks.first(where: { $0.id == id }) else { return false }
        guard bookmark.isValid(in: book), let chapter = book.chapters.firstIndex(where: { $0.id == bookmark.anchor.chapterID }) else {
            message = "原文版本已变化，书签仍保留，暂时无法跳转。"; return false
        }
        if let presentation = bookmark.presentation {
            guard verifiedBookmarkText(anchor: bookmark.anchor, presentation: presentation) != nil else {
                message = "译文已变化或尚未就绪，此书签待核对，未跳转。"; return false
            }
            let previousAnchor = currentAnchor, previousChapter = chapterIndex, previousPreferences = state.preferences
            var preferences = state.preferences
            preferences.viewMode = presentation.viewMode; preferences.translationVariant = presentation.layer
            changePreferences(preferences)
            go(to: chapter, anchor: bookmark.anchor)
            bookmarkNavigation = ReaderBookmarkNavigation(navigationID: navigationID, anchor: bookmark.anchor, presentation: presentation, previousChapterIndex: previousChapter, previousAnchor: previousAnchor, previousPreferences: previousPreferences)
        } else {
            if state.preferences.viewMode == .translation {
                var preferences = state.preferences; preferences.viewMode = .source; changePreferences(preferences)
            }
            go(to: chapter, anchor: bookmark.anchor); bookmarkNavigation = nil
        }
        return true
    }
    public func completeBookmarkNavigation(navigationID: UUID) {
        if bookmarkNavigation?.navigationID == navigationID, self.navigationID == navigationID { bookmarkNavigation = nil }
    }
    public func rejectBookmarkNavigation(_ request: ReaderBookmarkNavigation) {
        guard bookmarkNavigation == request, navigationID == request.navigationID else { return }
        bookmarkNavigation = nil
        changePreferences(request.previousPreferences)
        go(to: request.previousChapterIndex, anchor: request.previousAnchor)
        message = "译文已变化或展示位置无法核验，此书签待核对，已保留原阅读位置。"
    }
    public func verifiedBookmarkText(anchor: ReadingAnchor, presentation: ReaderBookmarkPresentation) -> String? {
        guard presentation.targetLanguage == translationSettings.targetLanguage,
              let passage = book.chapters.first(where: { $0.id == anchor.chapterID })?.passages.first(where: { $0.id == anchor.passageID }),
              let translation = translations[anchor.passageID], translation.original == passage.text,
              (translation.targetLanguage ?? .zh) == presentation.targetLanguage,
              let text = translation.text(presentation.layer), presentation.matches(text: text, targetLanguage: presentation.targetLanguage) else { return nil }
        return text
    }
}
