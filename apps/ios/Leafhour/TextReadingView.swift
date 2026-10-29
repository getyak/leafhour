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
        view.onWidthChange = { [weak coordinator = context.coordinator, weak view] in
            guard let coordinator, let view else { return }; coordinator.updateContent(view)
        }
        context.coordinator.edgeTap = ReaderEdgeTapHandler(view: view, blocked: { [weak view] in (view?.selectedRange.length ?? 0) > 0 }, onWake: { [weak coordinator = context.coordinator] edge in coordinator?.parent.onWake(edge) })
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
        (view as? ReflowTextView)?.onWidthChange = nil
        coordinator.invalidate(); view.delegate = nil
    }
    struct Span { var passage: Passage; var range: NSRange; var sourceRange: NSRange? = nil }
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
            if coordinator.signature != signature {
                let selection = !navigating && coordinator.renderedChapterID == session.chapter.id ? coordinator.selectedText() : nil
                if !navigating { coordinator.checkpointVisible() }
                let anchor = session.currentAnchor
                coordinator.signature = signature; coordinator.restoring = true
                coordinator.cancelPendingCapture()
                coordinator.renderedChapterID = session.chapter.id; coordinator.renderedWidth = Int(width)
                let result = NSMutableAttributedString(string: "")
                coordinator.spans = []
                let base = UIFont.systemFont(ofSize: preferences.fontSize)
                let font = UIFontMetrics(forTextStyle: .body).scaledFont(for: UIFont(descriptor: base.fontDescriptor.withDesign(.serif) ?? base.fontDescriptor, size: preferences.fontSize))
                if session.book.rendersMarkdown {
                    if coordinator.markdownChapterID != session.chapter.id {
                        coordinator.markdown = MarkdownChapterLayout(book: session.book, chapter: session.chapter, original: session.original)
                        coordinator.markdownChapterID = session.chapter.id
                    }
                    if let layout = coordinator.markdown {
                        result.append(layout.attributed(font: font, size: preferences.fontSize, lineSpacing: preferences.lineSpacing, contentWidth: width))
                        coordinator.spans = zip(session.chapter.passages, layout.sourceRanges).map { passage, source in
                            let start = layout.document.displayedUTF16Offset(forSourceUTF16Offset: source.location)
                            let end = layout.document.displayedUTF16Offset(forSourceUTF16Offset: NSMaxRange(source))
                            return Span(passage: passage, range: NSRange(location: start, length: max(0, end - start)), sourceRange: source)
                        }
                    }
                } else {
                coordinator.markdown = nil; coordinator.markdownChapterID = nil
                for (index, passage) in session.chapter.passages.enumerated() {
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
                            let next = session.chapter.passages.indices.contains(index + 1) ? session.chapter.passages[index + 1].text.trimmingCharacters(in: .whitespacesAndNewlines) : nil
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
                        result.append(NSAttributedString(string: "\n\n", attributes: [.font: font, .paragraphStyle: style]))
                    }
                    coordinator.spans.append(Span(passage: passage, range: NSRange(location: start, length: result.length - start)))
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
        var restoring = false
        var edgeTap: ReaderEdgeTapHandler?
        var selectionDismissalID: UUID?
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
                  renderedChapterID == parent.session.chapter.id, navigationID == parent.session.navigationID,
                  renderedWidth == Int(layout(for: view).contentWidth) else { return false }
            // Sample inside the visible line. Its exact top edge may resolve to
            // the previous paragraph's trailing newline after a width reflow.
            let point = CGPoint(x: 1, y: max(0, view.contentOffset.y + 51 - view.textContainerInset.top))
            let index = view.layoutManager.characterIndex(for: point, in: view.textContainer, fractionOfDistanceBetweenInsertionPoints: nil)
            let span = spans.last(where: { $0.range.location <= index }) ?? spans[0]
            let utf16Offset = sourceOffset(in: span, displayedIndex: index)
            let scalarOffset = (span.passage.text as NSString).substring(to: utf16Offset).unicodeScalars.count
            parent.session.recordVisible(ReadingAnchor(chapterID: parent.session.chapter.id, passageID: span.passage.id, characterOffset: scalarOffset), navigationID: parent.session.navigationID)
            return true
        }
        private func sourceOffset(in span: Span, displayedIndex: Int) -> Int {
            if let source = span.sourceRange, let markdown {
                return min(max(0, markdown.document.sourceUTF16Offset(at: displayedIndex) - source.location), (span.passage.text as NSString).length)
            }
            return min(max(0, displayedIndex - span.range.location), (span.passage.text as NSString).length)
        }
        private func persistCheckpoint() {
            guard !restoring, renderedChapterID == parent.session.chapter.id, navigationID == parent.session.navigationID,
                  let anchor = parent.session.currentAnchor else { return }
            parent.session.moved(anchor)
        }
        func selectedText() -> (range: NSRange, text: String)? {
            guard let view, view.selectedRange.length > 0, NSMaxRange(view.selectedRange) <= view.attributedText.length else { return nil }
            return (view.selectedRange, (view.attributedText.string as NSString).substring(with: view.selectedRange))
        }
        func invalidate() { restorationGeneration += 1; cancelPendingCapture(); view = nil }
        func restore(_ anchor: ReadingAnchor?, persistCheckpoint: Bool = false) {
            guard let view else { return }
            restoring = true; cancelPendingCapture(); restorationGeneration += 1
            let generation = restorationGeneration, chapter = renderedChapterID, navigation = navigationID
            DispatchQueue.main.async { [weak self, weak view] in
                guard let self, let view, self.view === view, self.restorationGeneration == generation,
                      self.renderedChapterID == chapter, self.parent.session.chapter.id == chapter,
                      self.navigationID == navigation, self.parent.session.navigationID == navigation else { return }
                view.layoutManager.ensureLayout(for: view.textContainer)
                if let anchor, anchor.chapterID == chapter, view.attributedText.length > 0,
                   let span = self.spans.first(where: { $0.passage.id == anchor.passageID }) {
                    let text = span.passage.text
                    let end = text.unicodeScalars.index(text.unicodeScalars.startIndex, offsetBy: min(anchor.characterOffset, text.unicodeScalars.count))
                    let offset = String(text.unicodeScalars[..<end]).utf16.count
                    let displayedOffset: Int
                    if let source = span.sourceRange, let markdown = self.markdown { displayedOffset = markdown.document.displayedUTF16Offset(forSourceUTF16Offset: source.location + offset) }
                    else { displayedOffset = span.range.location + offset }
                    let position = min(max(0, view.attributedText.length - 1), displayedOffset)
                    let glyph = view.layoutManager.glyphRange(forCharacterRange: NSRange(location: position, length: 1), actualCharacterRange: nil)
                    let rect = view.layoutManager.boundingRect(forGlyphRange: glyph, in: view.textContainer)
                    let y = max(-view.adjustedContentInset.top, rect.minY + view.textContainerInset.top - 50)
                    view.setContentOffset(CGPoint(x: 0, y: min(y, max(0, view.contentSize.height - view.bounds.height))), animated: false)
                } else { view.setContentOffset(.zero, animated: false) }
                self.restoring = false
                if persistCheckpoint { self.schedulePersistence() }
            }
        }
        func selectedQuote(in textView: UITextView, range: NSRange) -> SelectedQuote? {
            guard range.location >= 0, range.length > 0, NSMaxRange(range) <= (textView.text as NSString).length,
                  let span = spans.first(where: { $0.range.location <= range.location && NSMaxRange(range) <= NSMaxRange($0.range) }),
                  span.passage.resourcePath == nil, !span.passage.text.isEmpty else { return nil }
            let source = span.passage.text as NSString
            let start = sourceOffset(in: span, displayedIndex: range.location)
            let end = sourceOffset(in: span, displayedIndex: NSMaxRange(range))
            guard end > start, end <= source.length else { return nil }
            let prefix = source.substring(to: start), selected = (textView.text as NSString).substring(with: range)
            return SelectedQuote(anchor: ReadingAnchor(chapterID: parent.session.chapter.id, passageID: span.passage.id, characterOffset: prefix.unicodeScalars.count),
                text: selected, sourceText: source.substring(with: NSRange(location: start, length: end - start)))
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
            if selectedQuote(in: textView, range: range) == nil {
                for case let action as UIAction in actions { action.attributes = action.attributes.union(.disabled) }
                return UIMenu(children: [UIMenu(title: selectionGuidance, options: .displayInline, children: actions)] + suggestedActions)
            }
            return UIMenu(children: actions + suggestedActions)
        }
    }
}

/// UIKit can resize the text container without a new SwiftUI state update.
private final class ReflowTextView: UITextView {
    var onWidthChange: (() -> Void)?
    private var laidOutWidth = 0
    override func layoutSubviews() {
        let width = Int(bounds.width)
        let changed = width > 0 && width != laidOutWidth
        if changed { laidOutWidth = width }
        super.layoutSubviews()
        if changed { onWidthChange?() }
    }
}
