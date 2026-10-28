import SwiftUI
import UIKit
import LeafhourCore

@main
struct LeafhourApp: App {
    @State private var model = LibraryModel()
    var body: some Scene {
        WindowGroup { LibraryScreen(model: model).tint(.leafInk) }
    }
}

extension Color {
    static let leafFill = Color(red: 0.24, green: 0.40, blue: 0.31)
    static let leafInk = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 181.0 / 255, green: 205.0 / 255, blue: 189.0 / 255, alpha: 1)
            : UIColor(red: 0.24, green: 0.40, blue: 0.31, alpha: 1)
    })
    static let readingPaper = Color(red: 0.97, green: 0.96, blue: 0.92)
}

extension ReaderPreferences {
    /// Read the system appearance outside the reader's presentation overrides.
    func colorScheme(following system: ColorScheme) -> ColorScheme {
        theme == "night" ? .dark : (theme == "paper" ? .light : system)
    }
}

@MainActor @Observable
final class LibraryModel {
    var books: [LocalBook] = []
    var jobs: [ImportJob] = []
    var message: String?
    var busy = false
    var status = ""
    var reader: ReaderSession?
    private(set) var library: OfflineLibrary?
    private var importTask: Task<Void, Never>?
    private var didRestore = false

    init() {
        do {
            let base = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            library = try OfflineLibrary(root: base.appendingPathComponent("Leafhour", isDirectory: true), scope: .device)
        } catch { message = error.localizedDescription }
    }
    func reload(restore: Bool = false) async {
        guard let library else { return }
        do {
            books = try await library.books()
            jobs = try await library.jobs().filter { $0.phase != .complete }
            if restore && !didRestore {
                didRestore = true
                if let id = try await library.lastOpenedBook(), let book = books.first(where: { $0.id == id }) { await open(book) }
            }
        } catch { message = error.localizedDescription }
    }
    func importFile(_ url: URL) {
        guard !busy, let library else { return }
        busy = true; status = "正在保留原件并处理书籍…"
        importTask = Task {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() }; busy = false; importTask = nil }
            do {
                let book = try await library.importFile(url)
                await reload(); await open(book)
            } catch is CancellationError { status = "导入已取消，原件仍保留，可稍后重试。"; await reload() }
            catch { message = error.localizedDescription; await reload() }
        }
    }
    func cancelImport() { importTask?.cancel() }
    func retry(_ job: ImportJob) {
        guard !busy, let library else { return }
        busy = true; status = "正在从保留的原件重试…"
        importTask = Task {
            defer { busy = false; importTask = nil }
            do { let book = try await library.retry(job.id); await reload(); await open(book) }
            catch { message = error.localizedDescription; await reload() }
        }
    }
    func open(_ book: LocalBook) async {
        guard let library else { return }
        if let current = reader { await current.flush(); guard current.saveError == nil else { return } }
        do {
            let verifiedBook = try await library.book(book.id)
            let state = try await library.state(book.id)
            let original = try await library.originalURL(book.id)
            let folder = try await library.bookDirectory(book.id)
            try await library.setLastOpenedBook(book.id)
            reader = ReaderSession(book: verifiedBook, state: state, original: original, directory: folder, library: library)
        } catch { message = "暂时无法打开这本书：\(error.localizedDescription) 可在书籍详情中校验或修复。" }
    }
}

@MainActor @Observable
final class ReaderSession: Identifiable {
    let book: LocalBook
    let original: URL
    let directory: URL
    let library: OfflineLibrary
    nonisolated let id: String
    var state: ReaderState
    var chapterIndex: Int
    var navigationID = UUID()
    var message: String?
    var saving = false
    var saveError: String?
    var selection: SelectedQuote?
    private var pending: Task<Void, Never>?
    private var revision = 0
    init(book: LocalBook, state: ReaderState, original: URL, directory: URL, library: OfflineLibrary) {
        self.id = book.id; self.book = book; self.state = state; self.original = original; self.directory = directory; self.library = library
        chapterIndex = book.chapters.firstIndex { $0.id == state.anchor?.chapterID } ?? 0
    }
    var chapter: BookChapter { book.chapters[chapterIndex] }
    func save() {
        revision += 1
        let version = revision, snapshot = state, previous = pending
        saving = true
        pending = Task {
            await previous?.value
            do { try await library.saveState(snapshot, bookID: book.id); if version == revision { saving = false; saveError = nil } }
            catch { if version == revision { saveError = error.localizedDescription; message = "记录尚未保存：\(error.localizedDescription)"; saving = false } }
        }
    }
    func flush() async { await pending?.value }
    func moved(_ anchor: ReadingAnchor) {
        guard anchor != state.anchor else { return }
        state.anchor = anchor; save()
    }
    func go(to index: Int, anchor: ReadingAnchor? = nil) {
        guard book.chapters.indices.contains(index) else { return }
        chapterIndex = index
        state.anchor = anchor ?? ReadingAnchor(chapterID: chapter.id, passageID: chapter.passages.first?.id ?? "page", characterOffset: 0)
        navigationID = UUID(); selection = nil; save()
    }
    func changePreferences(_ value: ReaderPreferences) { state.preferences = value; navigationID = UUID(); save() }
    func draft(_ quote: SelectedQuote, text: String) {
        state.drafts[quote.anchor.key] = NoteDraft(anchor: quote.anchor, quote: quote.text, body: text); save()
    }
    func saveNote(_ quote: SelectedQuote, text: String) {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        state.notes.append(ReaderNote(anchor: quote.anchor, quote: quote.text, body: text))
        state.drafts.removeValue(forKey: quote.anchor.key); save()
    }
}
struct SelectedQuote: Identifiable {
    let anchor: ReadingAnchor
    let text: String
    var id: String { anchor.key }
}
