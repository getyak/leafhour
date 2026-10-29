import SwiftUI
import PDFKit
import LeafhourCore

struct PDFReadingView: UIViewRepresentable {
    let session: ReaderSession
    var pageInsets = UIEdgeInsets(top: 64, left: 0, bottom: 180, right: 0)
    let selectionDismissalID: UUID
    let onSelection: (SelectedQuote?) -> Void
    let onWake: (ReaderChrome) -> Void
    let onReadingScroll: () -> Void
    var onPageChange: ((ReaderPagePosition) -> Void)? = nil
    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }
    func makeUIView(context: Context) -> PDFView {
        let view = PDFView(); view.autoScales = true; view.backgroundColor = .clear
        view.accessibilityIdentifier = "leafhour-pdf-reader"
        context.coordinator.view = view
        context.coordinator.edgeTap = ReaderEdgeTapHandler(view: view, blocked: { [weak view] in view?.currentSelection != nil }, onWake: { [weak coordinator = context.coordinator] edge in coordinator?.parent.onWake(edge) })
        context.coordinator.observe(view)
        return view
    }
    func updateUIView(_ view: PDFView, context: Context) {
        let coordinator = context.coordinator; coordinator.parent = self
        coordinator.update(view)
    }
    static func dismantleUIView(_ view: PDFView, coordinator: Coordinator) {
        coordinator.invalidate()
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
        private var originalScrollInsets = UIEdgeInsets.zero
        private var delayed: DispatchWorkItem?
        private var loadedSource: URL?
        private var renderedMode: ReaderNavigationMode?
        private var restorationGeneration = 0
        private var lastReportedPage: ReaderPagePosition?
        init(parent: PDFReadingView) { self.parent = parent }
        deinit { observers.forEach { NotificationCenter.default.removeObserver($0) }; scrolling?.invalidate(); delayed?.cancel() }
        func update(_ view: PDFView) {
            self.view = view
            let session = parent.session, mode = session.state.preferences.navigationMode
            if selectionDismissalID != parent.selectionDismissalID {
                selectionDismissalID = parent.selectionDismissalID; view.clearSelection()
            }
            let sourceChanged = loadedSource != session.original || view.document == nil
            let modeChanged = renderedMode != mode
            let needsRestore = sourceChanged || modeChanged || navigationID != session.navigationID
            // SwiftUI has already resized an externally padded paged PDF by
            // this point. Its old-mode geometry is no longer a source snapshot.
            let anchor = session.currentAnchor
            if needsRestore { restoring = true; restorationGeneration += 1; cancelPendingScroll(); userScrolled = false }
            if sourceChanged { loadedSource = session.original; view.document = PDFDocument(url: session.original) }
            if modeChanged {
                scrolling?.invalidate(); scrolling = nil; observedScroll = nil
                view.usePageViewController(false, withViewOptions: nil)
                view.displayMode = mode == .paged ? .singlePage : .singlePageContinuous
                view.displayDirection = mode == .paged ? .horizontal : .vertical
                if mode == .paged { view.usePageViewController(true, withViewOptions: nil) }
                renderedMode = mode
            }
            navigationID = session.navigationID
            observeScroll(in: view)
            guard needsRestore else { reportPagePosition(); return }
            let generation = restorationGeneration, navigation = session.navigationID, owner = ObjectIdentifier(session)
            DispatchQueue.main.async { [weak self, weak view] in
                guard let self, let view, self.view === view, self.restorationGeneration == generation,
                      self.navigationID == navigation, self.parent.session.navigationID == navigation,
                      ObjectIdentifier(self.parent.session) == owner, self.renderedMode == self.parent.session.state.preferences.navigationMode,
                      let document = view.document else { return }
                let index = anchor.flatMap { saved in session.book.chapters.firstIndex { $0.id == saved.chapterID } } ?? session.chapterIndex
                guard let page = document.page(at: index) else { self.restoring = false; return }
                if let y = anchor?.pageY {
                    view.go(to: PDFDestination(page: page, at: CGPoint(x: page.bounds(for: .mediaBox).minX, y: y)))
                } else { view.go(to: page) }
                // PDFKit can replace/layout its scroll hierarchy after go(to:)
                // and a page-controller mode change. Align against final native
                // geometry on the next queue boundary before saving a position.
                DispatchQueue.main.async { [weak self, weak view] in
                    guard let self, let view, self.view === view, self.restorationGeneration == generation,
                          self.navigationID == navigation, self.parent.session.navigationID == navigation,
                          ObjectIdentifier(self.parent.session) == owner,
                          self.renderedMode == self.parent.session.state.preferences.navigationMode else { return }
                    view.layoutDocumentView(); view.layoutIfNeeded()
                    self.observeScroll(in: view)
                    if self.renderedMode == .scroll {
                        let sourceY: CGFloat
                        if let savedY = anchor?.pageY {
                            sourceY = CGFloat(savedY)
                        } else {
                            sourceY = page.bounds(for: view.displayBox).maxY
                        }
                        self.revealDestinationBelowChrome(page: page, sourceY: sourceY)
                    }
                    self.restoring = false
                    if modeChanged && !sourceChanged { self.capture(force: true) }
                    self.reportPagePosition()
                }
            }
        }
        func observe(_ view: PDFView) {
            observers.append(NotificationCenter.default.addObserver(forName: .PDFViewSelectionChanged, object: view, queue: .main) { [weak self] _ in MainActor.assumeIsolated { self?.selectionChanged() } })
            observers.append(NotificationCenter.default.addObserver(forName: .PDFViewPageChanged, object: view, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.pageChanged() }
            })
            observers.append(NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in MainActor.assumeIsolated { self?.capture() } })
        }
        func observeScroll(in view: UIView) {
            // PDFKit's native horizontal page controller owns its own scroll
            // views. Do not attach a second pan or vertical content insets.
            guard parent.session.state.preferences.navigationMode == .scroll else { return }
            func scroll(_ view: UIView) -> UIScrollView? { if let result = view as? UIScrollView { return result }; return view.subviews.lazy.compactMap { scroll($0) }.first }
            guard let target = scroll(view) else { return }
            if target !== observedScroll { originalScrollInsets = target.contentInset }
            let insets = UIEdgeInsets(top: originalScrollInsets.top + parent.pageInsets.top, left: originalScrollInsets.left,
                                      bottom: originalScrollInsets.bottom + parent.pageInsets.bottom, right: originalScrollInsets.right)
            if target.contentInset != insets {
                let offset = target.contentOffset
                target.contentInset = insets
                target.verticalScrollIndicatorInsets = UIEdgeInsets(top: parent.pageInsets.top, left: 0, bottom: parent.pageInsets.bottom, right: 0)
                target.setContentOffset(offset, animated: false)
            }
            guard target !== observedScroll else { return }
            observedScroll = target
            scrolling = target.observe(\.contentOffset, options: .new) { [weak self, weak target] _, _ in
                DispatchQueue.main.async { [weak self] in
                    guard let self, !self.restoring, let target, self.observedScroll === target,
                          self.renderedMode == .scroll, self.navigationID == self.parent.session.navigationID,
                          target.isTracking || target.isDragging || target.isDecelerating else { return }
                    self.parent.onReadingScroll()
                    self.userScrolled = true
                    self.delayed?.cancel(); let work = DispatchWorkItem { [weak self] in self?.capture() }; self.delayed = work
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.18, execute: work)
                }
            }
        }
        private func revealDestinationBelowChrome(page: PDFPage, sourceY: CGFloat) {
            guard let view, let scroll = observedScroll else { return }
            let sourcePoint = CGPoint(x: page.bounds(for: view.displayBox).midX, y: sourceY)
            let destination = view.convert(sourcePoint, from: page)
            let readingTop = min(view.bounds.maxY - 1, max(view.bounds.minY + 1, parent.pageInsets.top + 1))
            let minimum = -scroll.adjustedContentInset.top
            let maximum = max(minimum, scroll.contentSize.height - scroll.bounds.height + scroll.adjustedContentInset.bottom)
            let corrected = scroll.contentOffset.y + destination.y - readingTop
            scroll.setContentOffset(CGPoint(x: scroll.contentOffset.x, y: min(maximum, max(minimum, corrected))), animated: false)
            view.layoutIfNeeded()
        }
        func cancelPendingScroll() { delayed?.cancel() }
        private func visibleAnchor() -> ReadingAnchor? {
            guard let view, let document = view.document else { return nil }
            let mode = renderedMode ?? parent.session.state.preferences.navigationMode
            // The page controller's whole view is already inside ReaderScreen's
            // chrome padding. Continuous scrolling still owns internal insets.
            let readingTop = mode == .paged ? view.bounds.minY + 1 : parent.pageInsets.top + 1
            let readingPoint = CGPoint(x: view.bounds.midX, y: min(view.bounds.maxY - 1, max(view.bounds.minY + 1, readingTop)))
            let page = mode == .paged ? view.currentPage : view.page(for: readingPoint, nearest: true)
            guard let page else { return nil }
            let index = document.index(for: page)
            guard parent.session.book.chapters.indices.contains(index) else { return nil }
            let chapter = parent.session.book.chapters[index]
            let visiblePoint = view.convert(readingPoint, to: page)
            guard let passage = chapter.passages.first else { return nil }
            let bounds = page.bounds(for: view.displayBox)
            let y = mode == .paged ? min(bounds.maxY, max(bounds.minY, visiblePoint.y)) : visiblePoint.y
            return ReadingAnchor(chapterID: chapter.id, passageID: passage.id, pageY: Double(y))
        }
        func capture(force: Bool = false) {
            guard !restoring, force || userScrolled, let anchor = visibleAnchor(),
                  let index = parent.session.book.chapters.firstIndex(where: { $0.id == anchor.chapterID }) else { return }
            parent.session.chapterIndex = index
            parent.session.moved(anchor)
            reportPagePosition()
        }
        private func pageChanged() {
            guard !restoring else { return }
            if parent.session.state.preferences.navigationMode == .paged {
                userScrolled = true
                parent.onReadingScroll()
                capture()
            }
            reportPagePosition()
        }
        private func reportPagePosition() {
            guard !restoring, let view, let document = view.document, let page = view.currentPage else { return }
            let index = document.index(for: page)
            guard index >= 0, index < document.pageCount else { return }
            let position = ReaderPagePosition(index: index, count: document.pageCount, chapterIndex: index)
            guard position != lastReportedPage else { return }
            lastReportedPage = position
            let generation = restorationGeneration, navigation = navigationID
            DispatchQueue.main.async { [weak self] in
                guard let self, self.restorationGeneration == generation, self.navigationID == navigation, self.lastReportedPage == position else { return }
                self.parent.onPageChange?(position)
            }
        }
        func invalidate() {
            restorationGeneration += 1; cancelPendingScroll(); scrolling?.invalidate(); scrolling = nil
            observers.forEach { NotificationCenter.default.removeObserver($0) }; observers = []
            observedScroll = nil; view = nil
        }
        func selectionChanged() {
            guard let view, let selection = view.currentSelection, selection.pages.count == 1, let page = selection.pages.first, let index = view.document?.index(for: page), parent.session.book.chapters.indices.contains(index), let text = selection.string, !text.isEmpty else { parent.onSelection(nil); return }
            let chapter = parent.session.book.chapters[index], passage = chapter.passages[0]
            guard let anchor = PDFTextAnchor.make(selection: selection, page: page, chapterID: chapter.id, passageID: passage.id) else { parent.onSelection(nil); return }
            parent.onSelection(SelectedQuote(anchor: anchor, text: text))
        }
    }
}
