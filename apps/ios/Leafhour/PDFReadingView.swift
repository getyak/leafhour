import SwiftUI
import PDFKit
import LeafhourCore

struct PDFReadingView: UIViewRepresentable {
    let session: ReaderSession
    let selectionDismissalID: UUID
    let onSelection: (SelectedQuote?) -> Void
    let onWake: (ReaderChrome) -> Void
    let onReadingScroll: () -> Void
    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }
    func makeUIView(context: Context) -> PDFView {
        let view = PDFView(); view.autoScales = true; view.displayMode = .singlePageContinuous; view.displayDirection = .vertical; view.backgroundColor = .clear
        view.accessibilityIdentifier = "leafhour-pdf-reader"
        context.coordinator.view = view
        context.coordinator.edgeTap = ReaderEdgeTapHandler(view: view, blocked: { [weak view] in view?.currentSelection != nil }, onWake: { [weak coordinator = context.coordinator] edge in coordinator?.parent.onWake(edge) })
        context.coordinator.observe(view)
        return view
    }
    func updateUIView(_ view: PDFView, context: Context) {
        let coordinator = context.coordinator; coordinator.parent = self
        if coordinator.selectionDismissalID != selectionDismissalID {
            coordinator.selectionDismissalID = selectionDismissalID
            view.clearSelection()
        }
        if view.document == nil { view.document = PDFDocument(url: session.original) }
        if coordinator.navigationID != session.navigationID {
            coordinator.navigationID = session.navigationID; coordinator.restoring = true
            coordinator.userScrolled = false; coordinator.cancelPendingScroll()
            DispatchQueue.main.async { [weak view, weak coordinator] in
                guard let view, let coordinator, let page = view.document?.page(at: session.chapterIndex) else { return }
                if let y = session.state.anchor?.pageY {
                    view.go(to: PDFDestination(page: page, at: CGPoint(x: page.bounds(for: .mediaBox).minX, y: y)))
                } else { view.go(to: page) }
                coordinator.restoring = false; coordinator.observeScroll(in: view)
            }
        }
    }
    @MainActor final class Coordinator: NSObject {
        var parent: PDFReadingView
        weak var view: PDFView?
        var navigationID: UUID?
        var restoring = false
        var userScrolled = false
        var edgeTap: ReaderEdgeTapHandler?
        var selectionDismissalID: UUID?
        private var observers: [NSObjectProtocol] = []
        private var scrolling: NSKeyValueObservation?
        private weak var observedScroll: UIScrollView?
        private var delayed: DispatchWorkItem?
        init(parent: PDFReadingView) { self.parent = parent }
        deinit { observers.forEach { NotificationCenter.default.removeObserver($0) }; scrolling?.invalidate(); delayed?.cancel() }
        func observe(_ view: PDFView) {
            observers.append(NotificationCenter.default.addObserver(forName: .PDFViewSelectionChanged, object: view, queue: .main) { [weak self] _ in MainActor.assumeIsolated { self?.selectionChanged() } })
            observers.append(NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in MainActor.assumeIsolated { self?.capture() } })
        }
        func observeScroll(in view: UIView) {
            func scroll(_ view: UIView) -> UIScrollView? { if let result = view as? UIScrollView { return result }; return view.subviews.lazy.compactMap { scroll($0) }.first }
            guard let target = scroll(view), target !== observedScroll else { return }
            observedScroll = target
            scrolling = target.observe(\.contentOffset, options: .new) { [weak self, weak target] _, _ in
                DispatchQueue.main.async { [weak self] in
                    guard let self, !self.restoring, let target, target.isTracking || target.isDragging || target.isDecelerating else { return }
                    self.parent.onReadingScroll()
                    self.userScrolled = true
                    self.delayed?.cancel(); let work = DispatchWorkItem { [weak self] in self?.capture() }; self.delayed = work
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.18, execute: work)
                }
            }
        }
        func cancelPendingScroll() { delayed?.cancel() }
        func capture() {
            guard !restoring, userScrolled, let view, let page = view.currentDestination?.page ?? view.currentPage, let document = view.document else { return }
            let index = document.index(for: page)
            guard parent.session.book.chapters.indices.contains(index) else { return }
            let chapter = parent.session.book.chapters[index]
            parent.session.chapterIndex = index
            parent.session.moved(ReadingAnchor(chapterID: chapter.id, passageID: chapter.passages[0].id, pageY: view.currentDestination.map { Double($0.point.y) }))
        }
        func selectionChanged() {
            guard let view, let selection = view.currentSelection, selection.pages.count == 1, let page = selection.pages.first, let index = view.document?.index(for: page), parent.session.book.chapters.indices.contains(index), let text = selection.string, !text.isEmpty else { parent.onSelection(nil); return }
            let chapter = parent.session.book.chapters[index], passage = chapter.passages[0]
            guard let anchor = PDFTextAnchor.make(selection: selection, page: page, chapterID: chapter.id, passageID: passage.id) else { parent.onSelection(nil); return }
            parent.onSelection(SelectedQuote(anchor: anchor, text: text))
        }
    }
}
