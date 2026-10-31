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
    var speechHighlight: ReaderSpeechHighlight? = nil
    var followsSpeech = false
    var onReadingPosition: ((ReaderSpeechLocation) -> Void)? = nil
    var onTouchActivity: ((Bool) -> Void)? = nil
    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }
    func makeUIView(context: Context) -> UITextView {
        let view = ReflowTextView()
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
        context.coordinator.edgeTap = ReaderEdgeTapHandler(view: view, blocked: { [weak view, weak coordinator = context.coordinator] in
            (view?.selectedRange.length ?? 0) > 0 || coordinator?.restoring != false
        }, onWake: { [weak coordinator = context.coordinator] edge in coordinator?.parent.onWake(edge) },
        isPaged: { [weak coordinator = context.coordinator] in coordinator?.parent.session.state.preferences.navigationMode == .paged },
        onTurn: { [weak coordinator = context.coordinator] direction in _ = coordinator?.turnPage(direction) })
        context.coordinator.pageTurn = ReaderPageTurnGestureHandler(view: view, blocked: { [weak view, weak coordinator = context.coordinator] in
            (view?.selectedRange.length ?? 0) > 0 || coordinator?.restoring != false
        }, onTurn: { [weak coordinator = context.coordinator] direction in _ = coordinator?.turnPage(direction) })
        view.readerTapRecognizer = context.coordinator.edgeTap?.recognizer
        view.readerPageRecognizer = context.coordinator.pageTurn?.recognizer
        context.coordinator.configureNavigation(view)
        let coordinator = context.coordinator
        let observer = ReaderParagraphSelectionObserver(view: view, eligible: { [weak view, weak coordinator] point in
            guard let view, coordinator?.restoring == false, view.selectedRange.length == 0,
                  (view.visibleReadingRect ?? view.bounds).contains(point) else { return false }
            return !ReaderEdgeTapHandler.isLink(at: point, in: view)
        }, context: { [weak coordinator, weak view] in
            guard let coordinator, let view, !coordinator.restoring else { return nil }
            return coordinator.parent.session.navigationID.uuidString + coordinator.signature + String(describing: view.bounds.width)
        }, selectionActive: { [weak view] in (view?.selectedRange.length ?? 0) > 0 }, expand: { false }, activity: { [weak coordinator] in coordinator?.parent.onTouchActivity?($0) })
        coordinator.paragraphSelection = observer; view.paragraphSelection = observer; observer.install()
        return view
    }
    func updateUIView(_ view: UITextView, context: Context) {
        let coordinator = context.coordinator
        coordinator.parent = self
        coordinator.updateContent(view)
        coordinator.dismissSelection(in: view, id: selectionDismissalID)
        coordinator.updateSpeech(view)
    }
    static func dismantleUIView(_ view: UITextView, coordinator: Coordinator) {
        (view as? ReflowTextView)?.onSizeChange = nil
        coordinator.invalidate(); view.delegate = nil
    }
    struct Span { var passage: Passage; var range: NSRange; var sourceOffsets: SourceTextOffsets; var sourceRange: NSRange? = nil; var isTranslation = false }
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
            let layoutChanged = coordinator.renderedSize != view.bounds.size || coordinator.renderedInsets != column.insets
            let anchor = session.currentAnchor
            // UIKit can clamp the scroll offset while changing its container or
            // viewport. Keep those intermediate callbacks out of reading progress.
            if layoutChanged { coordinator.restoring = true; coordinator.cancelPendingCapture() }
            if view.textContainerInset != column.insets {
                view.textContainerInset = column.insets
            }
            coordinator.renderedSize = view.bounds.size; coordinator.renderedInsets = column.insets
            let preferences = session.state.preferences
            let width = column.contentWidth
            let signature = "\(session.chapter.id)-\(preferences)-\(session.contentRevision)-\(view.traitCollection.preferredContentSizeCategory.rawValue)-\(Int(width))"
            let navigating = coordinator.navigationID != session.navigationID
            // A session owns an immutable book/source version. Never carry indices into another source.
            let sameSource = coordinator.indexedSessionID == ObjectIdentifier(session) && coordinator.indexedChapterIndex == session.chapterIndex
            // A background result must not rebuild UIKit's selected text or its
            // native edit menu. The selection-ending callback requests a fresh render.
            if sameSource, !navigating, !layoutChanged, view.selectedRange.length > 0,
               coordinator.renderedPreferences == preferences, coordinator.signature != signature { return }
            let translatedViewport = sameSource && !navigating
                && coordinator.renderedPreferences?.viewMode == preferences.viewMode
                && coordinator.renderedPreferences?.translationVariant == preferences.translationVariant
                ? (coordinator.pendingTranslatedViewport ?? coordinator.translatedViewport()) : nil
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
                // Real scrolling and committed page turns already checkpoint
                // immediately. Re-sampling a restored line for a preference
                // change would replace its canonical scalar with a new line start.
                coordinator.signature = signature; coordinator.restoring = true
                coordinator.renderedPreferences = preferences; coordinator.pendingTranslatedViewport = translatedViewport
                coordinator.cancelPendingCapture()
                coordinator.renderedChapterID = session.chapter.id; coordinator.renderedWidth = Int(width)
                coordinator.indexedSessionID = ObjectIdentifier(session); coordinator.indexedChapterIndex = session.chapterIndex
                let result = NSMutableAttributedString(string: "")
                coordinator.spans = []
                let base = UIFont.systemFont(ofSize: preferences.fontSize)
                let font = UIFontMetrics(forTextStyle: .body).scaledFont(for: UIFont(descriptor: base.fontDescriptor.withDesign(.serif) ?? base.fontDescriptor, size: preferences.fontSize), compatibleWith: view.traitCollection)
                if session.book.rendersMarkdown && (preferences.viewMode == .source || !session.chapter.passages.contains { session.translations[$0.id]?.text(preferences.translationVariant) != nil }) {
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
                                let captionFont = UIFontMetrics(forTextStyle: .footnote).scaledFont(for: .systemFont(ofSize: max(14, preferences.fontSize * 0.72)), compatibleWith: view.traitCollection)
                                result.append(NSAttributedString(string: "\n插图说明 · " + alternative + "\n\n", attributes: [.font: captionFont, .foregroundColor: UIColor.secondaryLabel, .paragraphStyle: style]))
                            } else { result.append(NSAttributedString(string: "\n\n")) }
                        } else {
                            result.append(NSAttributedString(string: "[插图：\(passage.alternative ?? "此设备暂不支持显示，原件仍保留")]\n\n", attributes: [.font: font, .foregroundColor: UIColor.secondaryLabel, .paragraphStyle: style]))
                        }
                    } else {
                        let actualFont = passage.heading ? UIFontMetrics(forTextStyle: .title2).scaledFont(for: .systemFont(ofSize: preferences.fontSize + 5, weight: .semibold), compatibleWith: view.traitCollection) : font
                        let layers = ReadingLayers.segments(passage: passage, preferences: preferences, translation: session.translations[passage.id])
                        for layer in layers {
                            if layer.isTranslation || layer.translationMissing {
                                let variant = preferences.translationVariant == .literal ? "直译" : "意译"
                                let label = layer.translationMissing ? "译文尚未准备 · 原文" : variant + (layer.status == "reviewed" ? " · 已校订" : " · 未校订")
                                let caption = UIFontMetrics(forTextStyle: .caption1).scaledFont(for: .systemFont(ofSize: 12, weight: .medium), compatibleWith: view.traitCollection)
                                result.append(NSAttributedString(string: label + "\n", attributes: [.font: caption, .foregroundColor: UIColor.secondaryLabel, .paragraphStyle: style]))
                            }
                            let layerStart = result.length
                            let ink = preferences.viewMode == .parallel && !layer.isTranslation && !passage.heading ? UIColor.secondaryLabel : UIColor.label
                            result.append(NSAttributedString(string: layer.text, attributes: [.font: actualFont, .foregroundColor: ink, .paragraphStyle: style]))
                            result.append(NSAttributedString(string: preferences.viewMode == .source ? "\n" : "\n\n", attributes: [.font: font, .paragraphStyle: style]))
                            coordinator.spans.append(Span(passage: passage, range: NSRange(location: layerStart, length: result.length - layerStart), sourceOffsets: sourceOffsets(for: passage, at: passageIndex), isTranslation: layer.isTranslation))
                        }
                    }
                    if passage.resourcePath != nil {
                        coordinator.spans.append(Span(passage: passage, range: NSRange(location: start, length: result.length - start), sourceOffsets: sourceOffsets(for: passage, at: passageIndex)))
                    }
                }
                }
                // TextKit's extra trailing line also needs the real body font on
                // its first layout. Set the default before restoring every run's
                // own heading, caption and link attributes below.
                view.font = font
                coordinator.speechFollower.invalidate(in: view)
                view.attributedText = result
                if let selection, NSMaxRange(selection.range) <= result.length,
                   (result.string as NSString).substring(with: selection.range) == selection.text {
                    view.selectedRange = selection.range
                } else { view.selectedRange = NSRange(location: 0, length: 0) }
                coordinator.navigationID = session.navigationID
                coordinator.restore(anchor, translatedViewport: translatedViewport, persistCheckpoint: !navigating)
            } else if navigating || layoutChanged {
                coordinator.navigationID = session.navigationID
                coordinator.restoring = true
                if navigating { view.selectedRange = NSRange(location: 0, length: 0) }
                coordinator.restore(anchor, persistCheckpoint: !navigating)
            }
            coordinator.configureNavigation(view)
        }
        var parent: TextReadingView
        weak var view: UITextView?
        var spans: [Span] = []
        var markdown: MarkdownChapterLayout?
        var markdownChapterID: String?
        private let speechFollower = ReaderSpeechTextFollower()
        var paragraphSelection: ReaderParagraphSelectionObserver?
        private var paragraphMenu: ReaderParagraphEditMenu?
        struct TranslatedViewport {
            let passageID: String
            let offset: Int
            let text: String
        }
        private var renderedPreferences: ReaderPreferences?
        private var pendingTranslatedViewport: TranslatedViewport?
        private func translatedViewport() -> TranslatedViewport? {
            guard let view, view.bounds.width > 0, view.attributedText.length > 0 else { return nil }
            let readingTop = max(0, parent.pageInsets.top)
            let point = CGPoint(x: 1, y: max(0, view.contentOffset.y + readingTop + 1 - view.textContainerInset.top))
            let index = view.layoutManager.characterIndex(for: point, in: view.textContainer, fractionOfDistanceBetweenInsertionPoints: nil)
            guard let span = spans.last(where: { $0.range.location <= index }), span.isTranslation,
                  NSMaxRange(span.range) <= view.attributedText.length else { return nil }
            return TranslatedViewport(passageID: span.passage.id, offset: min(max(0, index - span.range.location), max(0, span.range.length - 1)),
                                      text: (view.attributedText.string as NSString).substring(with: span.range))
        }
        var signature = ""
        var navigationID: UUID?
        var renderedChapterID: String?
        var renderedWidth = 0
        private var renderedSize = CGSize.zero
        private var renderedInsets = UIEdgeInsets.zero
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
        func dismissSelection(in textView: UITextView, id: UUID) {
            guard selectionDismissalID != id else { return }
            selectionDismissalID = id
            guard let window = textView.window else { return }
            let owner = ObjectIdentifier(parent.session), navigation = parent.session.navigationID
            let chapterIndex = parent.session.chapterIndex, chapter = parent.session.chapter.id
            let generation = restorationGeneration, range = textView.selectedRange
            // Resigning here synchronously can ask SwiftUI for its next responder
            // while updateUIView is still updating that same responder graph.
            DispatchQueue.main.async { [weak self, weak textView, weak window] in
                guard let self, let textView, let window, self.view === textView,
                      self.selectionDismissalID == id, textView.window === window,
                      self.indexedSessionID == owner, owner == ObjectIdentifier(self.parent.session),
                      self.indexedChapterIndex == chapterIndex, chapterIndex == self.parent.session.chapterIndex,
                      self.renderedChapterID == chapter, chapter == self.parent.session.chapter.id,
                      self.navigationID == navigation, navigation == self.parent.session.navigationID,
                      self.restorationGeneration == generation, textView.selectedRange == range else { return }
                if textView.selectedRange != NSRange(location: 0, length: 0) {
                    textView.selectedRange = NSRange(location: 0, length: 0)
                }
                if textView.isFirstResponder { textView.resignFirstResponder() }
            }
        }
        func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
            paragraphSelection?.cancel()
            restorationGeneration += 1; restoring = false; pendingTranslatedViewport = nil; cancelPendingCapture()
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
        private func renderedImageRect(in span: Span, view: UITextView) -> CGRect? {
            guard span.passage.resourcePath != nil, span.range.length > 0,
                  span.range.location < view.attributedText.length,
                  let attachment = view.attributedText.attribute(.attachment, at: span.range.location, effectiveRange: nil) as? NSTextAttachment,
                  attachment.image != nil else { return nil }
            let glyphs = view.layoutManager.glyphRange(forCharacterRange: NSRange(location: span.range.location, length: 1), actualCharacterRange: nil)
            let rect = view.layoutManager.boundingRect(forGlyphRange: glyphs, in: view.textContainer)
            guard rect.minY.isFinite, rect.height.isFinite, rect.height > 0 else { return nil }
            return rect
        }
        @discardableResult func checkpointVisible() -> Bool {
            guard !restoring, let view, view.bounds.width > 0, !spans.isEmpty,
                  indexedSessionID == ObjectIdentifier(parent.session), indexedChapterIndex == parent.session.chapterIndex,
                  renderedChapterID == parent.session.chapter.id, navigationID == parent.session.navigationID,
                  renderedWidth == Int(layout(for: view).contentWidth), renderedSize == view.bounds.size,
                  renderedInsets == view.textContainerInset, renderedInsets == layout(for: view).insets,
                  signature == "\(parent.session.chapter.id)-\(parent.session.state.preferences)-\(parent.session.contentRevision)-\(view.traitCollection.preferredContentSizeCategory.rawValue)-\(renderedWidth)" else { return false }
            // Sample inside the visible line. Its exact top edge may resolve to
            // the previous paragraph's trailing newline after a width reflow.
            let readingTop = max(0, parent.pageInsets.top)
            let point = CGPoint(x: 1, y: max(0, view.contentOffset.y + readingTop + 1 - view.textContainerInset.top))
            let index = view.layoutManager.characterIndex(for: point, in: view.textContainer, fractionOfDistanceBetweenInsertionPoints: nil)
            let span = spans.last(where: { $0.range.location <= index }) ?? spans[0]
            let utf16Offset = sourceOffset(in: span, displayedIndex: index)
            let scalarOffset = span.sourceOffsets.scalarOffset(forUTF16Offset: utf16Offset)
            var anchor = ReadingAnchor(chapterID: parent.session.chapter.id, passageID: span.passage.id, characterOffset: scalarOffset)
            // The image's rendered height changes with column width. Preserve a
            // source-relative point, not a page number or old display offset.
            let readingY = view.contentOffset.y + readingTop - view.textContainerInset.top
            // An image span also contains its displayed alternative and trailing
            // spacing. Keep those at the source-image endpoint, never an invented
            // author-text scalar or a fallback to the top of a tall illustration.
            if let image = renderedImageRect(in: span, view: view), readingY >= image.minY {
                anchor.characterOffset = 0
                anchor.resourceY = min(1, max(0, Double((readingY - image.minY) / image.height)))
            }
            parent.session.recordVisible(anchor, navigationID: parent.session.navigationID)
            reportReadingPosition(span: span, displayedIndex: index)
            return true
        }
        private func reportReadingPosition(span: Span, displayedIndex: Int) {
            guard span.passage.resourcePath == nil else { return }
            let layer = span.isTranslation ? parent.session.state.preferences.translationVariant.rawValue : "original"
            let text = span.isTranslation ? parent.session.translations[span.passage.id]?.text(parent.session.state.preferences.translationVariant) : span.passage.text
            guard let text else { return }
            let offset = span.isTranslation ? min(text.utf16.count, max(0, displayedIndex - span.range.location)) : sourceOffset(in: span, displayedIndex: displayedIndex)
            parent.onReadingPosition?(ReaderSpeechLocation(chapterID: parent.session.chapter.id, passageID: span.passage.id, layer: layer, snapshot: text, utf16Offset: offset))
        }
        private func reportReadingPosition(in view: UITextView) {
            guard !restoring, !spans.isEmpty else { return }
            let point = CGPoint(x: 1, y: max(0, view.contentOffset.y + parent.pageInsets.top + 1 - view.textContainerInset.top))
            let index = view.layoutManager.characterIndex(for: point, in: view.textContainer, fractionOfDistanceBetweenInsertionPoints: nil)
            let span = spans.last(where: { $0.range.location <= index }) ?? spans[0]
            reportReadingPosition(span: span, displayedIndex: index)
        }
        func updateSpeech(_ view: UITextView) {
            guard !restoring else { return }
            var target: ReaderSpeechTextTarget?
            if view.selectedRange.length == 0, let highlight = parent.speechHighlight,
               highlight.location.chapterID == parent.session.chapter.id,
               let span = spans.first(where: { $0.passage.id == highlight.location.passageID && ($0.isTranslation == (highlight.location.layer != "original")) }) {
                let snapshot = span.isTranslation ? parent.session.translations[span.passage.id]?.text(parent.session.state.preferences.translationVariant) : span.passage.text
                let layerMatches = !span.isTranslation || parent.session.state.preferences.translationVariant.rawValue == highlight.location.layer
                func displayed(_ range: NSRange) -> NSRange? {
                    guard range.location >= 0, range.length > 0, NSMaxRange(range) <= highlight.location.snapshot.utf16.count else { return nil }
                    if let source = span.sourceRange, let markdown {
                        let start = markdown.document.displayedUTF16Offset(forSourceUTF16Offset: source.location + range.location)
                        let end = markdown.document.displayedUTF16Offset(forSourceUTF16Offset: source.location + NSMaxRange(range))
                        return NSRange(location: start, length: max(0, end - start))
                    }
                    return NSRange(location: span.range.location + range.location, length: range.length)
                }
                if snapshot == highlight.location.snapshot, layerMatches, let sentence = displayed(highlight.sentenceRange), let word = displayed(highlight.wordRange) {
                    target = ReaderSpeechTextTarget(sentence: sentence, word: word)
                }
            }
            let viewport = (view as? ReflowTextView)?.visibleReadingRect ?? CGRect(x: view.bounds.minX, y: view.bounds.minY + parent.pageInsets.top, width: view.bounds.width, height: max(1, view.bounds.height - parent.pageInsets.top - parent.pageInsets.bottom))
            let wasRestoring = restoring; restoring = true
            speechFollower.apply(to: view, target: target, following: parent.followsSpeech, viewport: viewport, pages: parent.session.state.preferences.navigationMode == .paged ? pagination : nil)
            restoring = wasRestoring
            if target != nil {
                let generation = restorationGeneration, navigation = navigationID
                DispatchQueue.main.async { [weak self] in
                    guard let self, self.restorationGeneration == generation, self.navigationID == navigation else { return }
                    self.capture(); self.reportPagePosition()
                }
            }
        }
        private func sourceOffset(in span: Span, displayedIndex: Int) -> Int {
            if span.isTranslation { return 0 }
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
            paragraphSelection?.selectionChanged()
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
            paragraphMenu?.invalidate(); paragraphMenu = nil
            paragraphSelection?.invalidate(); paragraphSelection = nil
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
                reflow.pagedReadingInsets = paged ? UIEdgeInsets(top: max(0, parent.pageInsets.top), left: 0, bottom: parent.pageInsets.bottom, right: 0) : nil
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
                setPaginationBottomAllowance(nil)
                pagination = nil; paginationKey = nil; lastReportedPage = nil
            }
        }
        private func refreshPagination() {
            // Restoration needs the new last line-aligned origin and its scroll
            // allowance before positioning the saved source glyph.
            guard let view, parent.session.state.preferences.navigationMode == .paged else { return }
            let key = "\(ObjectIdentifier(parent.session))-\(signature)-\(view.bounds.size)-\(view.textContainerInset)-\(parent.pageInsets)"
            guard key != paginationKey else { return }
            paginationKey = key
            pagination = ReaderTextPagination(textView: view, readingTop: max(0, parent.pageInsets.top), bottomInset: parent.pageInsets.bottom)
            setPaginationBottomAllowance(pagination?.origins.last)
        }
        private var paginationBottomAllowance: CGFloat = 0
        private func setPaginationBottomAllowance(_ lastOrigin: CGFloat?) {
            guard let view else { return }
            let minimum = -view.adjustedContentInset.top
            let naturalMaximum = max(minimum, view.contentSize.height - view.bounds.height + view.adjustedContentInset.bottom - paginationBottomAllowance)
            let allowance = lastOrigin.map { max(0, $0 - naturalMaximum) } ?? 0
            guard allowance != paginationBottomAllowance else { return }
            let offset = view.contentOffset, wasRestoring = restoring
            restoring = true; defer { restoring = wasRestoring }
            let change = allowance - paginationBottomAllowance
            paginationBottomAllowance = allowance
            view.contentInset.bottom += change
            // Changing insets must not record UIKit's intermediate adjustment as
            // new reading progress. Returning to scrolling clamps naturally; the
            // same saved source remains visible within the continuous viewport.
            view.setContentOffset(CGPoint(x: offset.x, y: min(max(minimum, offset.y), naturalMaximum + allowance)), animated: false)
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
        func restore(_ anchor: ReadingAnchor?, translatedViewport: TranslatedViewport? = nil, persistCheckpoint: Bool = false) {
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
                self.refreshPagination()
                let positionAnchor = anchor ?? translatedViewport.map { ReadingAnchor(chapterID: self.parent.session.chapter.id, passageID: $0.passageID) }
                let translatedSpan = translatedViewport.flatMap { viewport in
                    self.spans.first { span in span.isTranslation && span.passage.id == viewport.passageID
                        && NSMaxRange(span.range) <= view.attributedText.length
                        && (view.attributedText.string as NSString).substring(with: span.range) == viewport.text }
                }
                if let anchor = positionAnchor, anchor.chapterID == chapter, view.attributedText.length > 0,
                   let span = translatedSpan ?? self.spans.first(where: { $0.passage.id == anchor.passageID }) {
                    let offset = span.sourceOffsets.utf16Offset(forScalarOffset: anchor.characterOffset)
                    let displayedOffset: Int
                    if let source = span.sourceRange, let markdown = self.markdown { displayedOffset = markdown.document.displayedUTF16Offset(forSourceUTF16Offset: source.location + offset) }
                    else if span.isTranslation {
                        // This is a temporary display offset, never an invented
                        // source-language offset or a persisted sentence alignment.
                        displayedOffset = span.range.location + (translatedSpan == nil ? 0 : min(translatedViewport?.offset ?? 0, max(0, span.range.length - 1)))
                    } else { displayedOffset = span.range.location + offset }
                    let position = min(max(0, view.attributedText.length - 1), displayedOffset)
                    let glyph = view.layoutManager.glyphRange(forCharacterRange: NSRange(location: position, length: 1), actualCharacterRange: nil)
                    let rect = view.layoutManager.boundingRect(forGlyphRange: glyph, in: view.textContainer)
                    let readingTop = max(0, self.parent.pageInsets.top)
                    let sourceY: CGFloat
                    if let resourceY = anchor.resourceY, resourceY.isFinite, (0...1).contains(resourceY), anchor.pageY == nil,
                       let image = self.renderedImageRect(in: span, view: view) {
                        sourceY = image.minY + CGFloat(resourceY) * image.height
                    } else { sourceY = rect.minY }
                    let y = max(-view.adjustedContentInset.top, sourceY + view.textContainerInset.top - readingTop)
                    let maximum = self.parent.session.state.preferences.navigationMode == .paged
                        ? (self.pagination?.origins.last ?? -view.adjustedContentInset.top)
                        : max(-view.adjustedContentInset.top, view.contentSize.height - view.bounds.height + view.adjustedContentInset.bottom)
                    view.setContentOffset(CGPoint(x: 0, y: min(y, maximum)), animated: false)
                } else { view.setContentOffset(.zero, animated: false) }
                self.restoring = false; self.pendingTranslatedViewport = nil
                if let direction = self.pendingPageTransition {
                    self.pendingPageTransition = nil
                    ReaderPageTransition.apply(to: view, direction: direction)
                    if self.parent.session.state.preferences.navigationMode == .paged, direction == .previous {
                        view.setContentOffset(CGPoint(x: 0, y: self.pagination?.origins.last ?? -view.adjustedContentInset.top), animated: false)
                    }
                    self.capture()
                }
                self.configureNavigation(view)
                self.updateSpeech(view)
                self.reportReadingPosition(in: view)
                if persistCheckpoint { self.schedulePersistence() }
            }
        }
        func selectedQuote(in textView: UITextView, range: NSRange) -> SelectedQuote? {
            guard range.location >= 0, range.length > 0, NSMaxRange(range) <= (textView.text as NSString).length,
                  let span = spans.first(where: { $0.range.location <= range.location && NSMaxRange(range) <= NSMaxRange($0.range) }),
                  span.passage.resourcePath == nil, !span.passage.text.isEmpty else { return nil }
            if span.isTranslation {
                return SelectedQuote(anchor: ReadingAnchor(chapterID: parent.session.chapter.id, passageID: span.passage.id),
                    text: (textView.text as NSString).substring(with: range), sourceText: span.passage.text,
                    origin: "translation", variant: parent.session.state.preferences.translationVariant.rawValue, translationOffset: range.location - span.range.location)
            }
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
            let selectionGuidance = "请在同一段内选择文字，以保留准确引用。"
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

/// Clip only TextKit's ink, leaving UIKit's selection handles outside the paper
/// body intact. The text container, page origins and source geometry never move.
private final class ReaderPageLayoutManager: NSLayoutManager, ReaderSpeechPaintingLayout {
    var speechHighlightRange: NSRange? {
        didSet {
            guard oldValue != speechHighlightRange else { return }
            let count = textStorage?.length ?? 0
            for range in [oldValue, speechHighlightRange].compactMap({ $0 }) where range.location >= 0 && range.location < count {
                invalidateDisplay(forCharacterRange: NSRange(location: range.location, length: min(range.length, count - range.location)))
            }
        }
    }
    var readingClip: CGRect?
    override func drawGlyphs(forGlyphRange glyphsToShow: NSRange, at origin: CGPoint) {
        guard let readingClip, let context = UIGraphicsGetCurrentContext() else {
            super.drawGlyphs(forGlyphRange: glyphsToShow, at: origin); return
        }
        context.saveGState(); context.clip(to: readingClip.offsetBy(dx: origin.x, dy: origin.y))
        super.drawGlyphs(forGlyphRange: glyphsToShow, at: origin)
        context.restoreGState()
    }
    override func drawBackground(forGlyphRange glyphsToShow: NSRange, at origin: CGPoint) {
        guard let context = UIGraphicsGetCurrentContext() else { super.drawBackground(forGlyphRange: glyphsToShow, at: origin); return }
        context.saveGState()
        if let readingClip { context.clip(to: readingClip.offsetBy(dx: origin.x, dy: origin.y)) }
        super.drawBackground(forGlyphRange: glyphsToShow, at: origin)
        if let range = speechHighlightRange, range.length > 0, range.location >= 0, NSMaxRange(range) <= (textStorage?.length ?? 0), let container = textContainers.first {
            let glyphs = NSIntersectionRange(glyphRange(forCharacterRange: range, actualCharacterRange: nil), glyphsToShow)
            if glyphs.length > 0 {
                UIColor { traits in UIColor(red: 0.38, green: 0.66, blue: 0.43, alpha: traits.userInterfaceStyle == .dark ? 0.35 : 0.20) }.setFill()
                enumerateEnclosingRects(forGlyphRange: glyphs, withinSelectedGlyphRange: NSRange(location: NSNotFound, length: 0), in: container) { rect, _ in
                    UIBezierPath(roundedRect: rect.offsetBy(dx: origin.x, dy: origin.y), cornerRadius: 3).fill()
                }
            }
        }
        context.restoreGState()
    }
}

/// UIKit can resize the text container without a new SwiftUI state update.
final class ReflowTextView: UITextView {
    var paragraphSelection: ReaderParagraphSelectionObserver?
    var onSizeChange: (() -> Void)?
    var onPageScroll: ((ReaderPageDirection) -> Bool)?
    weak var readerTapRecognizer: UIGestureRecognizer?
    weak var readerPageRecognizer: UIGestureRecognizer?
    var pagedReadingInsets: UIEdgeInsets? { didSet { updateReadingClip() } }
    private(set) var visibleReadingRect: CGRect?
    private var laidOutSize = CGSize.zero
    private var updatingClip = false
    private var selectionTouchBeganInBody: Bool?
    init() {
        let storage = NSTextStorage(), manager = ReaderPageLayoutManager()
        let container = NSTextContainer(size: CGSize(width: 0, height: CGFloat.greatestFiniteMagnitude))
        container.widthTracksTextView = true; container.heightTracksTextView = false
        storage.addLayoutManager(manager); manager.addTextContainer(container)
        super.init(frame: .zero, textContainer: container)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override var contentOffset: CGPoint { didSet { updateReadingClip() } }

    private func updateReadingClip() {
        guard !updatingClip, let manager = layoutManager as? ReaderPageLayoutManager else { return }
        updatingClip = true; defer { updatingClip = false }
        var body = pagedReadingInsets.map { insets in
            CGRect(x: bounds.minX, y: bounds.minY + insets.top, width: bounds.width,
                   height: max(0, bounds.height - insets.top - insets.bottom))
        }
        if var rect = body, rect.height > 0 {
            let containerRect = rect.offsetBy(dx: -textContainerInset.left, dy: -textContainerInset.top)
            let range = manager.glyphRange(forBoundingRect: containerRect, in: textContainer)
            // A normal next-page line must not leave half its glyphs at the foot
            // of this page. Oversized illustrations still render in page slices.
            manager.enumerateLineFragments(forGlyphRange: range) { _, used, _, _, _ in
                let bottom = used.maxY + self.textContainerInset.top
                let top = used.minY + self.textContainerInset.top
                if top < rect.maxY, bottom > rect.maxY + 0.5, used.height <= rect.height {
                    rect.size.height = max(0, top - rect.minY)
                }
            }
            body = rect
        }
        let clip = body?.offsetBy(dx: -textContainerInset.left, dy: -textContainerInset.top)
        guard clip != manager.readingClip else { visibleReadingRect = body; return }
        // TextKit can cache glyph tiles between page turns. Invalidate both the
        // old and new viewport so clipped ink is redrawn when it becomes visible.
        let dirty = bounds.union(visibleReadingRect ?? bounds).union(body ?? bounds)
        visibleReadingRect = body; manager.readingClip = clip
        let containerDirty = dirty.offsetBy(dx: -textContainerInset.left, dy: -textContainerInset.top)
        let glyphs = manager.glyphRange(forBoundingRect: containerDirty, in: textContainer)
        manager.invalidateDisplay(forGlyphRange: glyphs)
        textInputView.setNeedsDisplay(convert(dirty, to: textInputView))
    }

    private func isSelectionHandle(_ view: UIView?) -> Bool {
        var candidate = view
        while let current = candidate, current !== self {
            if #available(iOS 17.0, *), current is any UITextSelectionHandleView { return true }
            candidate = current.superview
        }
        return false
    }
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        let hit = super.hitTest(point, with: event)
        guard let body = visibleReadingRect, bounds.contains(point), hit != nil else { return hit }
        let selectable = body.contains(point) || isSelectionHandle(hit)
        // Record the touch origin, not its later pan position: a native handle
        // or selection drag begun in the body may continue across the margin.
        if event?.allTouches?.contains(where: { $0.phase == .began }) == true {
            selectionTouchBeganInBody = selectable
        }
        return selectable ? hit : self
    }
    override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        guard let body = visibleReadingRect else { return super.gestureRecognizerShouldBegin(gestureRecognizer) }
        if gestureRecognizer === readerTapRecognizer || gestureRecognizer === readerPageRecognizer { return true }
        let point = gestureRecognizer.location(in: self)
        let handle = isSelectionHandle(super.hitTest(point, with: nil))
        guard selectionTouchBeganInBody ?? (body.contains(point) || handle) else { return false }
        return super.gestureRecognizerShouldBegin(gestureRecognizer)
    }
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
        paragraphSelection?.install()
        updateReadingClip()
        if changed { onSizeChange?() }
    }
}
