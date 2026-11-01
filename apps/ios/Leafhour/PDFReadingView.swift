import SwiftUI
import PDFKit
import LeafhourCore

enum ReaderPDFAccessibilityScrollResult: Equatable { case turned, blocked, nativeScrolling }

/// PDFKit still owns document rendering, selection, links, copy and zoom. Only
/// an explicitly handled page-scroll action bypasses its native accessibility.
final class ReaderPDFView: PDFView {
    var onReaderAccessibilityScroll: ((UIAccessibilityScrollDirection) -> ReaderPDFAccessibilityScrollResult)?
    override func accessibilityScroll(_ direction: UIAccessibilityScrollDirection) -> Bool {
        switch onReaderAccessibilityScroll?(direction) ?? .nativeScrolling {
        case .turned: return true
        case .blocked: return false
        case .nativeScrolling: return super.accessibilityScroll(direction)
        }
    }
}

struct PDFReadingView: UIViewRepresentable {
    let session: ReaderSession
    var pageInsets = UIEdgeInsets(top: 64, left: 0, bottom: 180, right: 0)
    let selectionDismissalID: UUID
    let onSelection: (SelectedQuote?) -> Void
    let onWake: (ReaderChrome) -> Void
    let onReadingScroll: () -> Void
    var onPageChange: ((ReaderPagePosition) -> Void)? = nil
    var speechHighlight: ReaderSpeechHighlight? = nil
    var followsSpeech = false
    var onReadingPosition: ((ReaderSpeechLocation) -> Void)? = nil
    var onTouchActivity: ((Bool) -> Void)? = nil
    var pageRequest: ReaderPageRequest? = nil
    var onPageRequestResult: ((UUID, ReaderPageRequestOutcome) -> Void)? = nil
    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }
    func makeUIView(context: Context) -> PDFView {
        let view = ReaderPDFView(); view.autoScales = true; view.backgroundColor = .clear
        view.accessibilityIdentifier = "leafhour-pdf-reader"
        context.coordinator.view = view
        context.coordinator.edgeTap = ReaderEdgeTapHandler(view: view, blocked: { [weak view, weak coordinator = context.coordinator] in
            view?.currentSelection != nil || coordinator?.restoring != false
        }, onWake: { [weak coordinator = context.coordinator] edge in coordinator?.wake(edge) },
        isPaged: { [weak coordinator = context.coordinator] in coordinator?.parent.session.state.preferences.navigationMode == .paged && coordinator?.parent.session.state.preferences.pageInput.allowsTap == true },
        onTurn: { [weak coordinator = context.coordinator] direction in _ = coordinator?.turnPage(direction) })
        context.coordinator.observe(view)
        let coordinator = context.coordinator
        let observer = ReaderParagraphSelectionObserver(view: view, eligible: { [weak view, weak coordinator] point in
            guard let view, coordinator?.restoring == false, view.currentSelection == nil,
                  !ReaderEdgeTapHandler.isLink(at: point, in: view), let page = view.page(for: point, nearest: false) else { return false }
            return page.characterIndex(at: view.convert(point, to: page)) != NSNotFound
        }, context: { [weak coordinator] in coordinator?.paragraphContext() }, selectionActive: { [weak view] in
            view?.currentSelection?.string?.isEmpty == false
        }, expand: { [weak coordinator] in coordinator?.selectParagraph() ?? false }, activity: { [weak coordinator] in coordinator?.touchActivity($0) })
        coordinator.paragraphSelection = observer; observer.install()
        return view
    }
    func updateUIView(_ view: PDFView, context: Context) {
        let coordinator = context.coordinator
        guard !coordinator.isInvalidated else { return }
        coordinator.parent = self
        coordinator.scheduleUpdate(view)
    }
    static func dismantleUIView(_ view: PDFView, coordinator: Coordinator) {
        coordinator.invalidate()
    }
    @MainActor final class Coordinator: NSObject {
        var parent: PDFReadingView
        weak var view: PDFView?
        var navigationID: UUID?
        var restoring = false
        private(set) var isInvalidated = false
        var userScrolled = false
        var edgeTap: ReaderEdgeTapHandler?
        private(set) var pageTurn: ReaderPageTurnGestureHandler?
        private weak var pageGestureView: PDFView?
        var selectionDismissalID: UUID?
        private var observers: [NSObjectProtocol] = []
        private var scrolling: NSKeyValueObservation?
        private weak var observedScroll: UIScrollView?
        private var originalScrollInsets = UIEdgeInsets.zero
        private var originalIndicatorInsets = UIEdgeInsets.zero
        private var delayed: DispatchWorkItem?
        private var loadedSource: URL?
        private var renderedMode: ReaderNavigationMode?
        private var renderedSize = CGSize.zero
        private var restorationGeneration = 0
        private var updateGeneration = 0
        private var pendingUpdate: DispatchWorkItem?
        private var renderedOwner: ObjectIdentifier?
        private var forceScheduledRestore = false
        private var nativeSelectionRevision = 0
        private var scheduledDismissalID: UUID?
        private var scheduledSelectionRevision = 0
        private var lastReportedPage: ReaderPagePosition?
        private var speechDestination: (page: PDFPage, navigation: UUID)?
        private var speechSentence: (page: PDFPage, range: NSRange)?
        private let pageCurl = ReaderPageCurlTransition()
        private var consumedPageRequests = Set<UUID>()
        private var pendingPageRequest: ReaderPageRequest?
        private struct NativePageTurn {
            let direction: ReaderPageDirection
            let origin: ReaderPageTurnOrigin
            let navigation: UUID
            let owner: ObjectIdentifier
            let pageIndex: Int
            let snapshot: UIView?
        }
        private var nativePageTurn: NativePageTurn?
        private var automaticDestination: (page: Int, navigation: UUID)?
        private var turnGeneration = 0
        var paragraphSelection: ReaderParagraphSelectionObserver?
        init(parent: PDFReadingView) { self.parent = parent }
        deinit { observers.forEach { NotificationCenter.default.removeObserver($0) }; scrolling?.invalidate(); delayed?.cancel(); pendingUpdate?.cancel() }
        func scheduleUpdate(_ view: PDFView) {
            guard !isInvalidated else { return }
            let session = parent.session, owner = ObjectIdentifier(session)
            let mode = session.state.preferences.navigationMode, source = session.original
            let navigation = session.navigationID, dismissal = parent.selectionDismissalID
            if self.view !== view || renderedOwner != owner || navigationID != navigation || renderedMode != mode || loadedSource != source || renderedSize != view.bounds.size {
                cancelPageTurn()
                speechDestination = nil
                // Old native notifications must not write into the new session
                // while its hierarchy update waits for the next main turn.
                restoring = true; restorationGeneration += 1; cancelPendingScroll(); userScrolled = false
                forceScheduledRestore = true
            }
            self.view = view
            updateGeneration += 1; pendingUpdate?.cancel()
            let generation = updateGeneration
            if scheduledDismissalID != dismissal {
                scheduledDismissalID = dismissal
                scheduledSelectionRevision = nativeSelectionRevision
            }
            let selectionRevision = scheduledSelectionRevision
            // PDFKit replaces its scroll hierarchy when changing page controllers.
            // Responder changes must run after SwiftUI finishes this update pass.
            let work = DispatchWorkItem { [weak self, weak view] in
                guard let self, !self.isInvalidated, let view, self.updateGeneration == generation, self.view === view else { return }
                guard ObjectIdentifier(self.parent.session) == owner, self.parent.session.navigationID == navigation,
                      self.parent.session.state.preferences.navigationMode == mode, self.parent.session.original == source,
                      self.parent.selectionDismissalID == dismissal else {
                    self.scheduleUpdate(view)
                    return
                }
                self.pendingUpdate = nil
                if self.selectionDismissalID != dismissal, self.nativeSelectionRevision != selectionRevision {
                    // Consume only the old request; keep a selection made while
                    // it was queued and still apply the required native update.
                    self.selectionDismissalID = dismissal
                }
                self.update(view)
            }
            pendingUpdate = work
            DispatchQueue.main.async(execute: work)
        }
        func update(_ view: PDFView) {
            guard !isInvalidated else { return }
            self.view = view
            let session = parent.session, mode = session.state.preferences.navigationMode
            if selectionDismissalID != parent.selectionDismissalID {
                selectionDismissalID = parent.selectionDismissalID; view.clearSelection()
            }
            let sizeChanged = renderedSize != view.bounds.size
            if sizeChanged { cancelPageTurn() }
            renderedSize = view.bounds.size
            let sourceChanged = loadedSource != session.original || view.document == nil
            let modeChanged = renderedMode != mode
            let needsRestore = sourceChanged || modeChanged || sizeChanged || navigationID != session.navigationID || renderedOwner != ObjectIdentifier(session) || forceScheduledRestore
            renderedOwner = ObjectIdentifier(session); forceScheduledRestore = false
            // SwiftUI has already resized an externally padded paged PDF by
            // this point. Its old-mode geometry is no longer a source snapshot.
            let anchor = session.currentAnchor
            if needsRestore { restoring = true; restorationGeneration += 1; cancelPendingScroll(); userScrolled = false }
            if sourceChanged { view.alpha = 0; loadedSource = session.original; view.document = PDFDocument(url: session.original) }
            if modeChanged {
                // singlePage and continuous can share a native scroll view.
                // Remove only our old chrome insets before changing its layout.
                if let scroll = observedScroll {
                    scroll.contentInset = originalScrollInsets
                    scroll.verticalScrollIndicatorInsets = originalIndicatorInsets
                }
                scrolling?.invalidate(); scrolling = nil; observedScroll = nil
                view.usePageViewController(false, withViewOptions: nil)
                view.displayMode = mode == .paged ? .singlePage : .singlePageContinuous
                view.displayDirection = mode == .paged ? .horizontal : .vertical
                renderedMode = mode
            }
            navigationID = session.navigationID
            observeScroll(in: view)
            guard needsRestore else { updateSpeech(); reportReadingPosition(); reportPagePosition(); consumePageRequest(); return }
            let generation = restorationGeneration, navigation = session.navigationID, owner = ObjectIdentifier(session)
            DispatchQueue.main.async { [weak self, weak view] in
                guard let self, !self.isInvalidated, let view, self.view === view, self.restorationGeneration == generation,
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
                    guard let self, !self.isInvalidated, let view, self.view === view, self.restorationGeneration == generation,
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
                    self.restoring = false; view.alpha = 1
                    self.updateSpeech(); self.reportReadingPosition()
                    self.selectionChanged()
                    // A layout change reveals the saved source; only actual
                    // reading gestures should advance its canonical bookmark.
                    self.reportPagePosition()
                    self.consumePageRequest()
                }
            }
        }
        func observe(_ view: PDFView) {
            guard !isInvalidated else { return }
            observers.append(NotificationCenter.default.addObserver(forName: .PDFViewSelectionChanged, object: view, queue: .main) { [weak self] _ in MainActor.assumeIsolated { self?.nativeSelectionChanged() } })
            observers.append(NotificationCenter.default.addObserver(forName: .PDFViewPageChanged, object: view, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.pageChanged() }
            })
            observers.append(NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in MainActor.assumeIsolated { self?.cancelPageTurn(); self?.capture() } })
        }
        func observeScroll(in view: UIView) {
            guard !isInvalidated else { return }
            if let pdf = view as? PDFView { configurePageNavigation(pdf) }
            paragraphSelection?.install()
            func scroll(_ view: UIView) -> UIScrollView? { if let result = view as? UIScrollView { return result }; return view.subviews.lazy.compactMap { scroll($0) }.first }
            guard let target = scroll(view) else { return }
            if target !== observedScroll { originalScrollInsets = target.contentInset; originalIndicatorInsets = target.verticalScrollIndicatorInsets }
            if parent.session.state.preferences.navigationMode == .scroll {
                let insets = UIEdgeInsets(top: originalScrollInsets.top + parent.pageInsets.top, left: originalScrollInsets.left,
                                          bottom: originalScrollInsets.bottom + parent.pageInsets.bottom, right: originalScrollInsets.right)
                if target.contentInset != insets {
                    let offset = target.contentOffset
                    target.contentInset = insets
                    target.verticalScrollIndicatorInsets = UIEdgeInsets(top: parent.pageInsets.top, left: 0, bottom: parent.pageInsets.bottom, right: 0)
                    target.setContentOffset(offset, animated: false)
                }
            }
            guard target !== observedScroll else { return }
            observedScroll = target
            scrolling = target.observe(\.contentOffset, options: .new) { [weak self, weak target] _, _ in
                DispatchQueue.main.async { [weak self] in
                    guard let self, !self.isInvalidated, !self.restoring, let target, self.observedScroll === target,
                          self.renderedMode == .scroll || self.renderedMode == .paged && !self.pageIsFitted,
                          self.navigationID == self.parent.session.navigationID,
                          target.isTracking || target.isDragging || target.isDecelerating else { return }
                    self.parent.onReadingScroll()
                    self.userScrolled = true
                    self.delayed?.cancel(); let work = DispatchWorkItem { [weak self] in self?.capture() }; self.delayed = work
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.18, execute: work)
                }
            }
        }
        private var pageIsFitted: Bool {
            guard let view else { return false }
            let fit = view.scaleFactorForSizeToFit, scale = view.scaleFactor
            return fit.isFinite && scale.isFinite && fit > 0 && scale > 0 && abs(scale - fit) <= max(0.01, fit * 0.03)
        }
        private var canTurnFittedPage: Bool {
            !isInvalidated && !restoring && parent.session.state.preferences.navigationMode == .paged
                && view?.currentSelection == nil && !pageCurl.isActive && nativePageTurn == nil && pageIsFitted
        }
        private func configurePageNavigation(_ view: PDFView) {
            if pageGestureView !== view {
                if let previous = pageGestureView as? ReaderPDFView { previous.onReaderAccessibilityScroll = { _ in .blocked } }
                pageTurn?.invalidate()
                pageGestureView = view
                pageTurn = ReaderPageTurnGestureHandler(view: view, blocked: { [weak self] in
                        guard let self else { return true }
                        return self.isInvalidated || self.restoring || self.view?.currentSelection != nil || !self.pageIsFitted
                    },
                    onTurn: { [weak self] direction in _ = self?.turnPage(direction) }, prioritizesScrollViewPans: true)
            }
            let paged = parent.session.state.preferences.navigationMode == .paged
            pageTurn?.isEnabled = paged && parent.session.state.preferences.pageInput.allowsSwipe
            if let native = view as? ReaderPDFView {
                native.onReaderAccessibilityScroll = { [weak self, weak view] direction in
                    guard let self, let view, self.view === view else { return .blocked }
                    return self.accessibilityScroll(direction)
                }
            }
            view.accessibilityCustomActions = paged ? [
                UIAccessibilityCustomAction(name: "下一页") { [weak self] _ in self?.accessibilityScroll(.left) == .turned },
                UIAccessibilityCustomAction(name: "上一页") { [weak self] _ in self?.accessibilityScroll(.right) == .turned }
            ] : nil
        }
        private func accessibilityScroll(_ direction: UIAccessibilityScrollDirection) -> ReaderPDFAccessibilityScrollResult {
            guard !isInvalidated, !restoring, view != nil, view?.currentSelection == nil,
                  !pageCurl.isActive, nativePageTurn == nil else { return .blocked }
            guard parent.session.state.preferences.navigationMode == .paged, pageIsFitted else { return .nativeScrolling }
            let turn: ReaderPageDirection
            switch direction {
            case .left, .next: turn = .next
            case .right, .previous: turn = .previous
            default: return .nativeScrolling
            }
            return turnPage(turn) ? .turned : .blocked
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
            // The paged PDF's whole view is already inside ReaderScreen's
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
        func reportReadingPosition() {
            guard !isInvalidated, !restoring, let view, let document = view.document else { return }
            let paged = parent.session.state.preferences.navigationMode == .paged
            let point = CGPoint(x: view.bounds.midX, y: min(view.bounds.maxY - 1, view.bounds.minY + (paged ? 1 : parent.pageInsets.top + 1)))
            guard let page = paged ? view.currentPage : view.page(for: point, nearest: true) else { return }
            let index = document.index(for: page)
            guard parent.session.book.chapters.indices.contains(index), let content = page.string,
                  let passage = parent.session.book.chapters[index].passages.first, passage.text == content else { return }
            let insets = paged ? UIEdgeInsets.zero : parent.pageInsets
            let body = view.bounds.inset(by: insets)
            let visible = view.convert(body, to: page).intersection(page.bounds(for: view.displayBox))
            guard !visible.isNull, !visible.isEmpty, let selection = page.selection(for: visible),
                  selection.numberOfTextRanges(on: page) > 0 else { return }
            let range = selection.range(at: 0, on: page)
            guard range.location != NSNotFound, range.location <= content.utf16.count else { return }
            parent.onReadingPosition?(ReaderSpeechLocation(chapterID: parent.session.book.chapters[index].id, passageID: passage.id, layer: "original", snapshot: content, utf16Offset: range.location))
        }
        func updateSpeech() {
            guard !isInvalidated, !restoring, let view, let document = view.document else { return }
            guard view.currentSelection == nil, let highlight = parent.speechHighlight, highlight.location.layer == "original",
                  let index = parent.session.book.chapters.firstIndex(where: { $0.id == highlight.location.chapterID }),
                  let page = document.page(at: index), page.string == highlight.location.snapshot,
                  highlight.sentenceRange.location >= 0, highlight.sentenceRange.length > 0,
                  NSMaxRange(highlight.sentenceRange) <= highlight.location.snapshot.utf16.count,
                  let sentence = page.selection(for: highlight.sentenceRange) else {
                view.highlightedSelections = nil; speechSentence = nil; return
            }
            if speechSentence?.page !== page || speechSentence?.range != highlight.sentenceRange {
                sentence.color = UIColor(red: 0.38, green: 0.66, blue: 0.43, alpha: 0.25)
                view.highlightedSelections = [sentence]; speechSentence = (page, highlight.sentenceRange)
            }
            func touching(_ view: UIView) -> Bool {
                if let scroll = view as? UIScrollView, scroll.isTracking || scroll.isDragging || scroll.isDecelerating { return true }
                return view.subviews.contains(where: touching)
            }
            guard parent.followsSpeech, !touching(view),
                  highlight.wordRange.length > 0, highlight.wordRange.location >= 0,
                  NSMaxRange(highlight.wordRange) <= highlight.location.snapshot.utf16.count,
                  let word = page.selection(for: highlight.wordRange) else { return }
            let insets = parent.session.state.preferences.navigationMode == .paged ? UIEdgeInsets.zero : parent.pageInsets
            let body = view.bounds.inset(by: insets), rect = view.convert(word.bounds(for: page), from: page)
            if view.currentPage === page, body.insetBy(dx: -1, dy: -1).contains(rect) { return }
            speechDestination = view.currentPage === page ? nil : (page, parent.session.navigationID)
            view.go(to: word)
        }
        func consumePageRequest() {
            guard !isInvalidated else { return }
            guard let request = parent.pageRequest, consumedPageRequests.insert(request.id).inserted else { return }
            guard request.expectedNavigationID == parent.session.navigationID,
                  navigationID == parent.session.navigationID, !restoring, view?.document != nil,
                  view?.currentPage != nil else {
                respond(to: request, with: .notReady); return
            }
            guard pendingPageRequest == nil, nativePageTurn == nil, !pageCurl.isActive,
                  view?.currentSelection == nil, paragraphSelection?.isTouchActive != true,
                  canTurnFittedPage else {
                respond(to: request, with: .blocked); return
            }
            pendingPageRequest = request
            if !turnPage(request.direction, origin: request.origin) { finishPageRequest(.end) }
        }
        private func respond(to request: ReaderPageRequest, with outcome: ReaderPageRequestOutcome) {
            guard !isInvalidated else { return }
            DispatchQueue.main.async { [weak self] in
                guard let self, !self.isInvalidated else { return }
                self.parent.onPageRequestResult?(request.id, outcome)
            }
        }
        private func finishPageRequest(_ outcome: ReaderPageRequestOutcome) {
            guard let request = pendingPageRequest else { return }
            pendingPageRequest = nil; respond(to: request, with: outcome)
        }
        private var queueGeneration = 0
        private var queuedPage: (direction: ReaderPageDirection, owner: ObjectIdentifier, navigation: UUID)?
        private func cancelPageTurn() {
            queuedPage = nil; queueGeneration += 1
            turnGeneration += 1; nativePageTurn = nil; automaticDestination = nil
            pageCurl.cancel(); finishPageRequest(.notReady)
        }
        func touchActivity(_ active: Bool) {
            guard !isInvalidated else { return }
            if active {
                automaticDestination = nil
                if pendingPageRequest?.origin == .automatic { cancelPageTurn() }
            }
            parent.onTouchActivity?(active)
        }
        fileprivate func wake(_ edge: ReaderChrome) {
            guard !isInvalidated else { return }
            parent.onWake(edge)
        }
        private func settleNativePageTurn() {
            guard !isInvalidated, let turn = nativePageTurn, let view, let document = view.document,
                  let page = view.currentPage, document.index(for: page) == turn.pageIndex else { return }
            let generation = turnGeneration
            DispatchQueue.main.async { [weak self, weak view] in
                guard let self, !self.isInvalidated, let view, self.turnGeneration == generation, self.nativePageTurn != nil,
                      self.parent.session.navigationID == turn.navigation,
                      ObjectIdentifier(self.parent.session) == turn.owner, !self.restoring,
                      let page = view.currentPage, view.document?.index(for: page) == turn.pageIndex else { return }
                view.layoutDocumentView(); view.layoutIfNeeded()
                self.nativePageTurn = nil
                if turn.origin == .automatic { self.automaticDestination = (turn.pageIndex, turn.navigation) }
                self.userScrolled = true
                if turn.origin == .user { self.parent.onReadingScroll() }
                self.capture(force: true); self.reportPagePosition()
                let paper: UIColor = self.parent.session.state.preferences.paperColor
                self.pageCurl.animate(from: turn.snapshot, over: view, direction: turn.direction, paper: paper, style: self.parent.session.state.preferences.pageAnimation) { [weak self] completed in
                    guard let self, !self.isInvalidated else { return }
                    guard completed, self.turnGeneration == generation, !self.restoring,
                          self.parent.session.navigationID == turn.navigation,
                          ObjectIdentifier(self.parent.session) == turn.owner else {
                        self.finishPageRequest(.notReady); return
                    }
                    self.finishPageRequest(.settled(navigationID: self.parent.session.navigationID))
                    self.drainQueuedPage()
                    if turn.origin == .user {
                        UIAccessibility.post(notification: .pageScrolled, argument: "第 \(turn.pageIndex + 1) 页，共 \(view.document?.pageCount ?? 0) 页")
                    }
                }
            }
        }
        private func drainQueuedPage() {
            guard let queued = queuedPage else { return }
            queuedPage = nil
            let generation = queueGeneration
            DispatchQueue.main.async { [weak self] in
                guard let self, !self.isInvalidated, self.queueGeneration == generation, queued.owner == ObjectIdentifier(self.parent.session),
                      queued.navigation == self.parent.session.navigationID, self.view?.currentSelection == nil else { return }
                _ = self.turnPage(queued.direction)
            }
        }
        @discardableResult func turnPage(_ direction: ReaderPageDirection, origin: ReaderPageTurnOrigin = .user) -> Bool {
            if origin == .user, !isInvalidated, !restoring, (pageCurl.isActive || nativePageTurn != nil),
               view?.currentSelection == nil, pageIsFitted, parent.session.state.preferences.navigationMode == .paged {
                queuedPage = (direction, ObjectIdentifier(parent.session), parent.session.navigationID)
                return true
            }
            guard canTurnFittedPage,
                  let view, view.currentSelection == nil, let document = view.document,
                  let page = view.currentPage else { return false }
            let next = document.index(for: page) + (direction == .next ? 1 : -1)
            guard next >= 0, next < document.pageCount else { return false }
            speechDestination = nil
            turnGeneration += 1
            let snapshot = pageCurl.snapshot(from: view)
            let paper: UIColor = parent.session.state.preferences.paperColor
            pageCurl.protect(snapshot, over: view, paper: paper)
            nativePageTurn = NativePageTurn(direction: direction, origin: origin, navigation: parent.session.navigationID,
                owner: ObjectIdentifier(parent.session), pageIndex: next, snapshot: snapshot)
            switch direction {
            case .next:
                view.goToNextPage(nil)
            case .previous:
                view.goToPreviousPage(nil)
            }
            settleNativePageTurn()
            return true
        }
        func capture(force: Bool = false) {
            guard !isInvalidated, !restoring, force || userScrolled, let anchor = visibleAnchor(),
                  let index = parent.session.book.chapters.firstIndex(where: { $0.id == anchor.chapterID }) else { return }
            parent.session.chapterIndex = index
            parent.session.moved(anchor)
            reportReadingPosition()
            reportPagePosition()
        }
        private func pageChanged() {
            guard !isInvalidated, !restoring else { return }
            if nativePageTurn != nil { settleNativePageTurn(); return }
            if let automatic = automaticDestination, automatic.navigation == parent.session.navigationID,
               let view, let page = view.currentPage, view.document?.index(for: page) == automatic.page,
               paragraphSelection?.isTouchActive != true {
                capture(force: true); reportReadingPosition(); reportPagePosition(); return
            }
            automaticDestination = nil
            if let destination = speechDestination, destination.navigation == parent.session.navigationID,
               view?.currentPage === destination.page, paragraphSelection?.isTouchActive != true {
                speechDestination = nil; reportReadingPosition(); reportPagePosition(); return
            }
            speechDestination = nil
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
                guard let self, !self.isInvalidated, self.restorationGeneration == generation, self.navigationID == navigation, self.lastReportedPage == position else { return }
                self.parent.onPageChange?(position)
            }
        }
        func invalidate() {
            guard !isInvalidated else { return }
            isInvalidated = true; restoring = true
            parent.onTouchActivity = nil; parent.onPageChange = nil
            parent.onReadingPosition = nil; parent.onPageRequestResult = nil
            if let native = pageGestureView as? ReaderPDFView { native.onReaderAccessibilityScroll = { _ in .blocked } }
            view?.accessibilityCustomActions = nil
            pageTurn?.isEnabled = false; pageTurn?.invalidate(); pageTurn = nil; pageGestureView = nil
            cancelPageTurn()
            paragraphSelection?.invalidate(); paragraphSelection = nil
            updateGeneration += 1; pendingUpdate?.cancel(); pendingUpdate = nil
            restorationGeneration += 1; cancelPendingScroll(); scrolling?.invalidate(); scrolling = nil
            observers.forEach { NotificationCenter.default.removeObserver($0) }; observers = []
            observedScroll = nil; view = nil
        }
        private func nativeSelectionChanged() {
            guard !isInvalidated else { return }
            paragraphSelection?.selectionChanged()
            nativeSelectionRevision += 1
            selectionChanged()
        }
        func selectionChanged() {
            guard !isInvalidated, !restoring else { return }
            guard let view, let selection = view.currentSelection, selection.pages.count == 1, let page = selection.pages.first, let index = view.document?.index(for: page), parent.session.book.chapters.indices.contains(index), let text = selection.string, !text.isEmpty else { parent.onSelection(nil); return }
            let chapter = parent.session.book.chapters[index], passage = chapter.passages[0]
            guard let anchor = PDFTextAnchor.make(selection: selection, page: page, chapterID: chapter.id, passageID: passage.id) else { parent.onSelection(nil); return }
            parent.onSelection(SelectedQuote(anchor: anchor, text: text))
        }
        func paragraphContext() -> String? {
            guard !restoring, let view, navigationID == parent.session.navigationID else { return nil }
            return parent.session.navigationID.uuidString + parent.session.book.sourceVersion + String(describing: view.bounds.size) + String(describing: view.scaleFactor)
        }
        @discardableResult func selectParagraph() -> Bool {
            guard !restoring, let view, let selection = view.currentSelection, selection.pages.count == 1,
                  let page = selection.pages.first, selection.numberOfTextRanges(on: page) == 1, let text = page.string,
                  let range = ReaderParagraphSelectionObserver.pdfParagraph(in: text, containing: selection.range(at: 0, on: page)),
                  let paragraph = page.selection(for: range) else { return false }
            view.setCurrentSelection(paragraph, animate: false)
            selectionChanged(); return true
        }
    }
}
