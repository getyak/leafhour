import SwiftUI
import UIKit
import ImageIO
import LeafhourCore

/// UIKit owns selection/copy and accessibility. Source XHTML never executes or loads remote resources.
struct TextReadingView: UIViewRepresentable {
    let session: ReaderSession
    var pageInsets = UIEdgeInsets(top: 64, left: 24, bottom: 24, right: 24)
    var selectionDismissalID = UUID()
    let onNote: (SelectedQuote) -> Void
    let onSource: (SelectedQuote) -> Void
    var onExplain: ((SelectedQuote) -> Void)? = nil
    let onWake: (ReaderChrome) -> Void
    let onReadingScroll: () -> Void
    var onTranslate: ((SelectedQuote) -> Void)? = nil
    var onDiscuss: ((SelectedQuote) -> Void)? = nil
    var onSelectionChange: ((SelectedQuote?, Bool) -> Void)? = nil
    var onPageChange: ((ReaderPagePosition) -> Void)? = nil
    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }
    func makeUIView(context: Context) -> UITextView {
        let view = ReflowTextView(usingTextLayoutManager: false)
        view.isEditable = false; view.isSelectable = true; view.backgroundColor = .clear
        // Entry tools overlay the page. A stable first-page margin keeps the title
        // below navigation without reflowing the text when those tools go to sleep.
        view.textContainerInset = pageInsets
        view.textContainer.lineFragmentPadding = 0
        view.adjustsFontForContentSizeCategory = true; view.alwaysBounceVertical = true
        view.delegate = context.coordinator; view.accessibilityIdentifier = "leafhour-epub-reader"
        context.coordinator.view = view
        view.onSizeChange = { [weak coordinator = context.coordinator, weak view] in
            guard let coordinator, let view else { return }; coordinator.updateContent(view)
        }
        context.coordinator.edgeTap = ReaderEdgeTapHandler(view: view, blocked: { [weak view] in (view?.selectedRange.length ?? 0) > 0 }, onWake: { [weak coordinator = context.coordinator] edge in coordinator?.parent.onWake(edge) })
        context.coordinator.pageTurn = ReaderPageTurnGestureHandler(view: view, blocked: { [weak view, weak coordinator = context.coordinator] in
            (view?.selectedRange.length ?? 0) > 0 || coordinator?.restoring != false
        }, onTurn: { [weak coordinator = context.coordinator] direction in _ = coordinator?.turnPage(direction) })
        context.coordinator.configureNavigation(view)
        return view
    }
    func updateUIView(_ view: UITextView, context: Context) {
        let coordinator = context.coordinator
        coordinator.parent = self
        coordinator.updateContent(view)
        if coordinator.selectionDismissalID != selectionDismissalID {
            coordinator.selectionDismissalID = selectionDismissalID
            view.selectedRange = NSRange(location: 0, length: 0)
            view.resignFirstResponder()
        }
    }
    static func dismantleUIView(_ view: UITextView, coordinator: Coordinator) {
        (view as? ReflowTextView)?.onSizeChange = nil
        coordinator.invalidate(); view.delegate = nil
    }
    struct Span { var passage: Passage; var range: NSRange; var sourceOffsets: SourceTextOffsets; var sourceRange: NSRange? = nil }
    @MainActor final class Coordinator: NSObject, UITextViewDelegate {
        private func layout(for view: UITextView) -> (contentWidth: CGFloat, insets: UIEdgeInsets) {
            let viewport = view.bounds.width > 0 ? view.bounds.width : UIScreen.main.bounds.width
            var insets = parent.pageInsets
            let available = max(1, viewport - insets.left - insets.right)
            let width = min(680, available)
            let extraMargin = max(0, (available - width) / 2)
            insets.left += extraMargin; insets.right += extraMargin
            return (width, insets)
        }
        func updateContent(_ view: UITextView) {
            let coordinator = self, session = parent.session
            let column = layout(for: view)
            if view.textContainerInset != column.insets {
                let topChange = column.insets.top - view.textContainerInset.top
                view.textContainerInset = column.insets
                // A larger accessibility toolbar may change the first-page margin.
                // Preserve the same visible line; changing the bottom margin needs no scrolling.
                if topChange != 0 { view.contentOffset.y += topChange }
            }
            let preferences = session.state.preferences
            let width = column.contentWidth
            let signature = "\(session.chapter.id)-\(preferences)-\(view.traitCollection.preferredContentSizeCategory.rawValue)-\(Int(width))"
            let navigating = coordinator.navigationID != session.navigationID
            // A session owns an immutable book/source version. Never carry indices into another source.
            let sameSource = coordinator.indexedSessionID == ObjectIdentifier(session) && coordinator.indexedChapterIndex == session.chapterIndex
            if !sameSource || coordinator.signature != signature {
                let previousSpans = sameSource ? coordinator.spans : []
                func sourceOffsets(for passage: Passage, at index: Int) -> SourceTextOffsets {
                    if previousSpans.indices.contains(index), previousSpans[index].passage.id == passage.id,
                       previousSpans[index].passage.text.utf8.elementsEqual(passage.text.utf8) {
                        return previousSpans[index].sourceOffsets
                    }
                    return SourceTextOffsets(passage.text)
                }
                let selection = !navigating && sameSource ? coordinator.selectedText() : nil
                if !navigating { coordinator.checkpointVisible() }
                let anchor = session.currentAnchor
                coordinator.signature = signature; coordinator.restoring = true
                coordinator.cancelPendingCapture()
                coordinator.renderedChapterID = session.chapter.id; coordinator.renderedWidth = Int(width)
                coordinator.indexedSessionID = ObjectIdentifier(session); coordinator.indexedChapterIndex = session.chapterIndex
                let result = NSMutableAttributedString(string: "")
                coordinator.spans = []
                let base = UIFont.systemFont(ofSize: preferences.fontSize)
                let font = UIFontMetrics(forTextStyle: .body).scaledFont(for: UIFont(descriptor: base.fontDescriptor.withDesign(.serif) ?? base.fontDescriptor, size: preferences.fontSize))
                if session.book.rendersMarkdown {
                    if !sameSource || coordinator.markdownChapterID != session.chapter.id {
                        coordinator.markdown = MarkdownChapterLayout(book: session.book, chapter: session.chapter, original: session.original)
                        coordinator.markdownChapterID = session.chapter.id
                    }
                    if let layout = coordinator.markdown {
                        result.append(layout.attributed(font: font, size: preferences.fontSize, lineSpacing: preferences.lineSpacing, contentWidth: width))
                        coordinator.spans = zip(session.chapter.passages, layout.sourceRanges).enumerated().map { index, pair in
                            let (passage, source) = pair
                            let start = layout.document.displayedUTF16Offset(forSourceUTF16Offset: source.location)
                            let end = layout.document.displayedUTF16Offset(forSourceUTF16Offset: NSMaxRange(source))
                            return Span(passage: passage, range: NSRange(location: start, length: max(0, end - start)), sourceOffsets: sourceOffsets(for: passage, at: index), sourceRange: source)
                        }
                    }
                } else {
                coordinator.markdown = nil; coordinator.markdownChapterID = nil
                for (passageIndex, passage) in session.chapter.passages.enumerated() {
                    let start = result.length
                    let style = NSMutableParagraphStyle(); style.lineSpacing = preferences.lineSpacing; style.paragraphSpacing = 20; style.baseWritingDirection = .natural
                    if let resource = passage.resourcePath {
                        let source = session.directory.appendingPathComponent("assets").appendingPathComponent(resource)
                        if let imageSource = CGImageSourceCreateWithURL(source as CFURL, nil), let cgImage = CGImageSourceCreateThumbnailAtIndex(imageSource, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: 2048] as CFDictionary) {
                            let image = UIImage(cgImage: cgImage), attachment = NSTextAttachment()
                            attachment.image = image
                            attachment.bounds = CGRect(x: 0, y: 0, width: width, height: width * image.size.height / max(1, image.size.width))
                            result.append(NSAttributedString(attachment: attachment))
                            let alternative = passage.alternative?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                            let next = session.chapter.passages.indices.contains(passageIndex + 1) ? session.chapter.passages[passageIndex + 1].text.trimmingCharacters(in: .whitespacesAndNewlines) : nil
                            if !alternative.isEmpty && alternative != next {
                                // Keep source image metadata reachable to system reading and
                                // selection, without inventing prose or an author-text anchor.
                                let captionFont = UIFontMetrics(forTextStyle: .footnote).scaledFont(for: .systemFont(ofSize: max(14, preferences.fontSize * 0.72)))
                                result.append(NSAttributedString(string: "\n插图说明 · " + alternative + "\n\n", attributes: [.font: captionFont, .foregroundColor: UIColor.secondaryLabel, .paragraphStyle: style]))
                            } else { result.append(NSAttributedString(string: "\n\n")) }
                        } else {
                            result.append(NSAttributedString(string: "[插图：\(passage.alternative ?? "此设备暂不支持显示，原件仍保留")]\n\n", attributes: [.font: font, .foregroundColor: UIColor.secondaryLabel, .paragraphStyle: style]))
                        }
                    } else {
                        let actualFont = passage.heading ? UIFontMetrics(forTextStyle: .title2).scaledFont(for: .systemFont(ofSize: preferences.fontSize + 5, weight: .semibold)) : font
                        result.append(NSAttributedString(string: passage.text, attributes: [.font: actualFont, .foregroundColor: UIColor.label, .paragraphStyle: style]))
                        result.append(NSAttributedString(string: "\n", attributes: [.font: font, .paragraphStyle: style]))
                    }
                    coordinator.spans.append(Span(passage: passage, range: NSRange(location: start, length: result.length - start), sourceOffsets: sourceOffsets(for: passage, at: passageIndex)))
                }
                }
                view.attributedText = result
                if let selection, NSMaxRange(selection.range) <= result.length,
                   (result.string as NSString).substring(with: selection.range) == selection.text {
                    view.selectedRange = selection.range
                } else { view.selectedRange = NSRange(location: 0, length: 0) }
                coordinator.navigationID = session.navigationID
                coordinator.restore(anchor, persistCheckpoint: !navigating)
            } else if navigating {
                coordinator.navigationID = session.navigationID
                coordinator.restoring = true
                view.selectedRange = NSRange(location: 0, length: 0)
                coordinator.restore(session.currentAnchor)
            }
            coordinator.configureNavigation(view)
        }
        var parent: TextReadingView
        weak var view: UITextView?
        var spans: [Span] = []
        var markdown: MarkdownChapterLayout?
        var markdownChapterID: String?
        var signature = ""
        var navigationID: UUID?
        var renderedChapterID: String?
        var renderedWidth = 0
        private var indexedSessionID: ObjectIdentifier?
        private var indexedChapterIndex: Int?
        var restoring = false
        var edgeTap: ReaderEdgeTapHandler?
        var pageTurn: ReaderPageTurnGestureHandler?
        var selectionDismissalID: UUID?
        private var pagination: ReaderTextPagination?
        private var paginationKey: String?
        private var lastReportedPage: ReaderPagePosition?
        private var pendingPageTransition: ReaderPageDirection?
        private var delayed: DispatchWorkItem?
        private var restorationGeneration = 0
        private var resignObserver: NSObjectProtocol?
        init(parent: TextReadingView) {
            self.parent = parent
            super.init()
            resignObserver = NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in MainActor.assumeIsolated { self?.capture() } }
        }
        deinit { delayed?.cancel(); if let resignObserver { NotificationCenter.default.removeObserver(resignObserver) } }
        func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
            restorationGeneration += 1; restoring = false; cancelPendingCapture()
            parent.session.clearTransientSelection()
            parent.onReadingScroll()
        }
        func scrollViewDidScroll(_ scrollView: UIScrollView) {
            guard checkpointVisible() else { return }
            schedulePersistence()
            reportPagePosition()
        }
        func cancelPendingCapture() { delayed?.cancel(); delayed = nil }
        private func schedulePersistence() {
            cancelPendingCapture()
            let generation = restorationGeneration, navigation = navigationID, chapter = renderedChapterID
            let work = DispatchWorkItem { [weak self] in
                guard let self, self.restorationGeneration == generation, self.navigationID == navigation,
                      self.renderedChapterID == chapter else { return }
                self.persistCheckpoint()
            }; delayed = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.18, execute: work)
        }
        func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) { capture() }
        func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) { if !decelerate { capture() } }
        func capture() {
            if checkpointVisible() { cancelPendingCapture(); persistCheckpoint() }
        }
        @discardableResult func checkpointVisible() -> Bool {
            guard !restoring, let view, view.bounds.width > 0, !spans.isEmpty,
                  indexedSessionID == ObjectIdentifier(parent.session), indexedChapterIndex == parent.session.chapterIndex,
                  renderedChapterID == parent.session.chapter.id, navigationID == parent.session.navigationID,
                  renderedWidth == Int(layout(for: view).contentWidth) else { return false }
            // Sample inside the visible line. Its exact top edge may resolve to
            // the previous paragraph's trailing newline after a width reflow.
            let readingTop = max(50, parent.pageInsets.top)
            let point = CGPoint(x: 1, y: max(0, view.contentOffset.y + readingTop + 1 - view.textContainerInset.top))
            let index = view.layoutManager.characterIndex(for: point, in: view.textContainer, fractionOfDistanceBetweenInsertionPoints: nil)
            let span = spans.last(where: { $0.range.location <= index }) ?? spans[0]
            let utf16Offset = sourceOffset(in: span, displayedIndex: index)
            let scalarOffset = span.sourceOffsets.scalarOffset(forUTF16Offset: utf16Offset)
            parent.session.recordVisible(ReadingAnchor(chapterID: parent.session.chapter.id, passageID: span.passage.id, characterOffset: scalarOffset), navigationID: parent.session.navigationID)
            return true
        }
        private func sourceOffset(in span: Span, displayedIndex: Int) -> Int {
            if let source = span.sourceRange, let markdown {
                return min(max(0, markdown.document.sourceUTF16Offset(at: displayedIndex) - source.location), span.sourceOffsets.utf16Count)
            }
            return min(max(0, displayedIndex - span.range.location), span.sourceOffsets.utf16Count)
        }
        private func persistCheckpoint() {
            guard !restoring, renderedChapterID == parent.session.chapter.id, navigationID == parent.session.navigationID,
                  indexedSessionID == ObjectIdentifier(parent.session), indexedChapterIndex == parent.session.chapterIndex,
                  let anchor = parent.session.currentAnchor else { return }
            parent.session.moved(anchor)
        }
        func selectedText() -> (range: NSRange, text: String)? {
            guard let view, view.selectedRange.length > 0, NSMaxRange(view.selectedRange) <= view.attributedText.length else { return nil }
            return (view.selectedRange, (view.attributedText.string as NSString).substring(with: view.selectedRange))
        }
        func textViewDidChangeSelection(_ textView: UITextView) {
            let range = textView.selectedRange, navigation = navigationID
            // UIKit can notify synchronously during representable updates. Publish
            // only the latest user selection after that update has completed.
            DispatchQueue.main.async { [weak self, weak textView] in
                guard let self, let textView, self.view === textView, !self.restoring,
                      self.indexedSessionID == ObjectIdentifier(self.parent.session),
                      self.indexedChapterIndex == self.parent.session.chapterIndex,
                      self.navigationID == navigation, self.parent.session.navigationID == navigation,
                      self.renderedChapterID == self.parent.session.chapter.id,
                      textView.selectedRange == range else { return }
                self.parent.onSelectionChange?(self.selectedQuote(in: textView, range: range), range.length > 0)
            }
        }
        func invalidate() {
            restorationGeneration += 1; cancelPendingCapture(); view = nil
            spans = []; indexedSessionID = nil; indexedChapterIndex = nil
            markdown = nil; markdownChapterID = nil
            pageTurn?.invalidate(); pageTurn = nil; pagination = nil; paginationKey = nil
        }
        func configureNavigation(_ view: UITextView) {
            let paged = parent.session.state.preferences.navigationMode == .paged
            pageTurn?.isEnabled = paged
            // Preserve UITextView's selection/editing recognizers and native
            // autoscroll. Only ordinary content-drag navigation changes mode.
            view.panGestureRecognizer.isEnabled = !paged
            if let reflow = view as? ReflowTextView {
                reflow.onPageScroll = paged ? { [weak self] direction in self?.turnPage(direction) ?? false } : nil
            }
            if paged {
                view.accessibilityCustomActions = [
                    UIAccessibilityCustomAction(name: "下一屏") { [weak self] _ in self?.turnPage(.next) ?? false },
                    UIAccessibilityCustomAction(name: "上一屏") { [weak self] _ in self?.turnPage(.previous) ?? false }
                ]
                refreshPagination()
                reportPagePosition()
            } else {
                view.accessibilityCustomActions = nil
                pagination = nil; paginationKey = nil; lastReportedPage = nil
            }
        }
        private func refreshPagination() {
            guard let view, !restoring, parent.session.state.preferences.navigationMode == .paged else { return }
            let key = "\(ObjectIdentifier(parent.session))-\(signature)-\(view.bounds.size)-\(view.textContainerInset)-\(parent.pageInsets)"
            guard key != paginationKey else { return }
            paginationKey = key
            pagination = ReaderTextPagination(textView: view, readingTop: max(50, parent.pageInsets.top), bottomInset: parent.pageInsets.bottom)
        }
        private func reportPagePosition() {
            guard !restoring, let view, parent.session.state.preferences.navigationMode == .paged else { return }
            refreshPagination()
            guard let pagination else { return }
            let position = ReaderPagePosition(index: pagination.index(at: view.contentOffset.y), count: pagination.origins.count, chapterIndex: parent.session.chapterIndex)
            guard position != lastReportedPage else { return }
            lastReportedPage = position
            let navigation = navigationID, generation = restorationGeneration
            DispatchQueue.main.async { [weak self] in
                guard let self, self.navigationID == navigation, self.restorationGeneration == generation,
                      self.lastReportedPage == position, self.parent.session.state.preferences.navigationMode == .paged else { return }
                self.parent.onPageChange?(position)
            }
        }
        @discardableResult func turnPage(_ direction: ReaderPageDirection) -> Bool {
            guard let view, !restoring, view.selectedRange.length == 0,
                  parent.session.state.preferences.navigationMode == .paged else { return false }
            refreshPagination()
            guard let pagination else { return false }
            if let offset = pagination.destination(direction, from: view.contentOffset.y) {
                guard abs(offset - view.contentOffset.y) > 0.5 else { return false }
                restorationGeneration += 1; cancelPendingCapture()
                parent.onReadingScroll()
                ReaderPageTransition.apply(to: view, direction: direction)
                view.setContentOffset(CGPoint(x: 0, y: offset), animated: false)
                capture(); reportPagePosition()
                return true
            }
            let session = parent.session, chapter = session.chapterIndex + (direction == .next ? 1 : -1)
            guard session.book.chapters.indices.contains(chapter) else { return false }
            parent.onReadingScroll()
            pendingPageTransition = direction
            var anchor: ReadingAnchor?
            if direction == .previous, let passage = session.book.chapters[chapter].passages.last {
                anchor = ReadingAnchor(chapterID: session.book.chapters[chapter].id, passageID: passage.id, characterOffset: max(0, passage.text.unicodeScalars.count - 1))
            }
            session.go(to: chapter, anchor: anchor)
            updateContent(view)
            return true
        }
        func restore(_ anchor: ReadingAnchor?, persistCheckpoint: Bool = false) {
            guard let view else { return }
            restoring = true; cancelPendingCapture(); restorationGeneration += 1
            let generation = restorationGeneration, chapter = renderedChapterID, navigation = navigationID
            let owner = indexedSessionID, chapterIndex = indexedChapterIndex
            DispatchQueue.main.async { [weak self, weak view] in
                guard let self, let view, self.view === view, self.restorationGeneration == generation,
                      self.indexedSessionID == owner, owner == ObjectIdentifier(self.parent.session),
                      self.indexedChapterIndex == chapterIndex, chapterIndex == self.parent.session.chapterIndex,
                      self.renderedChapterID == chapter, self.parent.session.chapter.id == chapter,
                      self.navigationID == navigation, self.parent.session.navigationID == navigation else { return }
                view.layoutManager.ensureLayout(for: view.textContainer)
                if let anchor, anchor.chapterID == chapter, view.attributedText.length > 0,
                   let span = self.spans.first(where: { $0.passage.id == anchor.passageID }) {
                    let offset = span.sourceOffsets.utf16Offset(forScalarOffset: anchor.characterOffset)
                    let displayedOffset: Int
                    if let source = span.sourceRange, let markdown = self.markdown { displayedOffset = markdown.document.displayedUTF16Offset(forSourceUTF16Offset: source.location + offset) }
                    else { displayedOffset = span.range.location + offset }
                    let position = min(max(0, view.attributedText.length - 1), displayedOffset)
                    let glyph = view.layoutManager.glyphRange(forCharacterRange: NSRange(location: position, length: 1), actualCharacterRange: nil)
                    let rect = view.layoutManager.boundingRect(forGlyphRange: glyph, in: view.textContainer)
                    let readingTop = max(50, self.parent.pageInsets.top)
                    let y = max(-view.adjustedContentInset.top, rect.minY + view.textContainerInset.top - readingTop)
                    view.setContentOffset(CGPoint(x: 0, y: min(y, max(0, view.contentSize.height - view.bounds.height))), animated: false)
                } else { view.setContentOffset(.zero, animated: false) }
                self.restoring = false
                if let direction = self.pendingPageTransition {
                    self.pendingPageTransition = nil
                    ReaderPageTransition.apply(to: view, direction: direction)
                    if self.parent.session.state.preferences.navigationMode == .paged, direction == .previous {
                        view.setContentOffset(CGPoint(x: 0, y: max(-view.adjustedContentInset.top, view.contentSize.height - view.bounds.height + view.adjustedContentInset.bottom)), animated: false)
                    }
                    self.capture()
                }
                self.configureNavigation(view)
                if persistCheckpoint { self.schedulePersistence() }
            }
        }
        func selectedQuote(in textView: UITextView, range: NSRange) -> SelectedQuote? {
            guard range.location >= 0, range.length > 0, NSMaxRange(range) <= (textView.text as NSString).length,
                  let span = spans.first(where: { $0.range.location <= range.location && NSMaxRange(range) <= NSMaxRange($0.range) }),
                  span.passage.resourcePath == nil, !span.passage.text.isEmpty else { return nil }
            let source = span.passage.text as NSString
            let start = sourceOffset(in: span, displayedIndex: range.location)
            let end = sourceSelectionEnd(in: span, displayedRange: range)
            guard end > start, end <= span.sourceOffsets.utf16Count else { return nil }
            let scalarOffset = span.sourceOffsets.scalarOffset(forUTF16Offset: start)
            let selected = (textView.text as NSString).substring(with: range)
            return SelectedQuote(anchor: ReadingAnchor(chapterID: parent.session.chapter.id, passageID: span.passage.id, characterOffset: scalarOffset),
                text: selected, sourceText: source.substring(with: NSRange(location: start, length: end - start)))
        }
        private func sourceSelectionEnd(in span: Span, displayedRange: NSRange) -> Int {
            let boundary = sourceOffset(in: span, displayedIndex: NSMaxRange(displayedRange))
            guard markdown != nil else { return boundary }
            let source = span.passage.text as NSString
            let last = sourceOffset(in: span, displayedIndex: NSMaxRange(displayedRange) - 1)
            guard last < source.length else { return boundary }
            // Point mappings belong to visible character starts. The next
            // visible character can be after closing **, ` or a link URL.
            var end = min(boundary, NSMaxRange(source.rangeOfComposedCharacterSequence(at: last)))
            if source.character(at: last) == 38 {
                let semicolon = source.range(of: ";", options: [], range: NSRange(location: last, length: min(32, source.length - last)))
                // A decoded entity maps its whole visible scalar/grapheme to
                // the raw '&'. Keep all encoded source bytes, but only when
                // the next visible mapping has passed that complete entity.
                if semicolon.location != NSNotFound, NSMaxRange(semicolon) <= boundary { end = NSMaxRange(semicolon) }
            }
            return end
        }
        func textView(_ textView: UITextView, editMenuForTextIn range: NSRange, suggestedActions: [UIMenuElement]) -> UIMenu? {
            let selectionGuidance = "请在同一段原文内选择文字，以保留准确引用。"
            func quote() -> SelectedQuote? {
                let value = selectedQuote(in: textView, range: range)
                if value == nil { parent.session.message = selectionGuidance }
                return value
            }
            let note = UIAction(title: "记笔记", image: UIImage(systemName: "square.and.pencil")) { [weak self] _ in
                guard let self else { return }
                guard let value = quote() else { return }
                self.parent.onNote(value)
            }
            let source = UIAction(title: "核对原文", image: UIImage(systemName: "text.quote")) { [weak self] _ in if let value = quote() { self?.parent.onSource(value) } }
            var actions: [UIMenuElement] = [note, source]
            if parent.onExplain != nil {
                actions.insert(UIAction(title: "解释这句", image: UIImage(systemName: "text.bubble")) { [weak self] _ in
                    guard let self else { return }
                    guard let value = quote() else { return }
                    self.parent.onExplain?(value)
                }, at: 0)
            }
            if parent.onTranslate != nil {
                actions.append(UIAction(title: "查看译文", image: UIImage(systemName: "character.bubble")) { [weak self] _ in if let value = quote() { self?.parent.onTranslate?(value) } })
            }
            if parent.onDiscuss != nil {
                actions.append(UIAction(title: "问陪读", image: UIImage(systemName: "bubble.left.and.bubble.right")) { [weak self] _ in if let value = quote() { self?.parent.onDiscuss?(value) } })
            }
            // Keep UIKit's Copy/Select editing group ahead of optional reading
            // actions. Preserve every system element and its original behavior.
            let editing = suggestedActions.filter { ($0 as? UIMenu)?.identifier == .standardEdit }
            let other = suggestedActions.filter { ($0 as? UIMenu)?.identifier != .standardEdit }
            let leading = editing.isEmpty ? suggestedActions : editing
            let trailing = editing.isEmpty ? [] : other
            if selectedQuote(in: textView, range: range) == nil {
                for case let action as UIAction in actions { action.attributes = action.attributes.union(.disabled) }
                return UIMenu(children: leading + [UIMenu(title: selectionGuidance, options: .displayInline, children: actions)] + trailing)
            }
            return UIMenu(children: leading + actions + trailing)
        }
    }
}

/// UIKit can resize the text container without a new SwiftUI state update.
private final class ReflowTextView: UITextView {
    var onSizeChange: (() -> Void)?
    var onPageScroll: ((ReaderPageDirection) -> Bool)?
    private var laidOutSize = CGSize.zero
    override func accessibilityScroll(_ direction: UIAccessibilityScrollDirection) -> Bool {
        if let onPageScroll {
            switch direction {
            case .left, .next: return onPageScroll(.next)
            case .right, .previous: return onPageScroll(.previous)
            default: return false
            }
        }
        return super.accessibilityScroll(direction)
    }
    override func layoutSubviews() {
        let size = CGSize(width: CGFloat(Int(bounds.width)), height: CGFloat(Int(bounds.height)))
        let changed = size.width > 0 && size != laidOutSize
        if changed { laidOutSize = size }
        super.layoutSubviews()
        if changed { onSizeChange?() }
    }
}
