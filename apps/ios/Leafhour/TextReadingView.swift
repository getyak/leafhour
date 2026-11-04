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
    var onShare: ((SelectedQuote) -> Void)? = nil
    var onSelectionChange: ((SelectedQuote?, Bool) -> Void)? = nil
    var onPageChange: ((ReaderPagePosition) -> Void)? = nil
    var onVisiblePage: ((ReaderVisiblePage?) -> Void)? = nil
    var speechHighlight: ReaderSpeechHighlight? = nil
    var followsSpeech = false
    var onReadingPosition: ((ReaderSpeechLocation) -> Void)? = nil
    var onTouchActivity: ((Bool) -> Void)? = nil
    var isReadingSurfaceActive = true
    var pageRequest: ReaderPageRequest? = nil
    var onPageRequestResult: ((UUID, ReaderPageRequestOutcome) -> Void)? = nil
    var onBookmark: ((ReadingAnchor) -> Void)? = nil
    var onBookmarkPull: ((ReaderBookmarkPullFeedback) -> Void)? = nil
    var onBookmarkViewport: (([ReaderBookmarkVisibleRange]) -> Void)? = nil
    var onBookmarkCapture: ((ReaderBookmarkCapture) -> Void)? = nil
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
        context.coordinator.edgeTap = ReaderEdgeTapHandler(view: view, blocked: { [weak coordinator = context.coordinator] in
            coordinator?.blocksEdgeTaps != false
        }, onWake: { [weak coordinator = context.coordinator] edge in coordinator?.wake(edge) },
        isPaged: { [weak coordinator = context.coordinator] in coordinator?.parent.session.state.preferences.navigationMode == .paged && coordinator?.parent.session.state.preferences.pageInput.allowsTap == true },
        onTurn: { [weak coordinator = context.coordinator] direction in _ = coordinator?.turnPage(direction) },
        delay: { [weak coordinator = context.coordinator] in coordinator?.parent.session.state.preferences.pageTapDelay ?? 0 },
        context: { [weak coordinator = context.coordinator] in
            guard let session = coordinator?.parent.session else { return nil }
            return ReaderTapContext(owner: ObjectIdentifier(session), navigation: session.navigationID, preferences: session.state.preferences, size: coordinator?.view?.bounds.size ?? .zero)
        })
        context.coordinator.pageTurn = ReaderPageTurnGestureHandler(view: view, blocked: { [weak view, weak coordinator = context.coordinator] in
            (view?.selectedRange.length ?? 0) > 0 || coordinator?.restoring != false || coordinator?.parent.isReadingSurfaceActive != true
        }, onTurn: { [weak coordinator = context.coordinator] direction in _ = coordinator?.turnPage(direction) })
        view.readerEdgeTapHandler = context.coordinator.edgeTap
        view.readerTapRecognizer = context.coordinator.edgeTap?.recognizer
        view.readerPageRecognizer = context.coordinator.pageTurn?.recognizer
        context.coordinator.configureNavigation(view)
        let coordinator = context.coordinator
        let observer = ReaderParagraphSelectionObserver(view: view, eligible: { [weak view, weak coordinator] point in
            guard let view, coordinator?.restoring == false, view.selectedRange.length == 0,
                  (view.visibleReadingRect ?? view.bounds).contains(point) else { return false }
            return !ReaderEdgeTapHandler.isLink(at: point, in: view) && coordinator?.paragraphCharacter(at: point) != nil
        }, context: { [weak coordinator, weak view] in
            guard let coordinator, let view, !coordinator.restoring else { return nil }
            return coordinator.parent.session.navigationID.uuidString + coordinator.signature + String(describing: view.bounds.width)
        }, selectionActive: { [weak view] in (view?.selectedRange.length ?? 0) > 0 }, expand: { [weak view, weak coordinator] in
            guard let view, let coordinator else { return false }
            return coordinator.selectParagraph(containing: view.selectedRange)
        }, activity: { [weak coordinator] in coordinator?.touchActivity($0) }, finalized: { [weak coordinator] in coordinator?.presentParagraphMenu() }, initialSelection: { [weak coordinator] point in
            guard let coordinator, let character = coordinator.paragraphCharacter(at: point) else { return false }
            return coordinator.selectParagraph(containing: NSRange(location: character, length: 1))
        })
        coordinator.paragraphSelection = observer; view.paragraphSelection = observer; observer.install()
        coordinator.configureBookmarkGesture(view)
        return view
    }
    func updateUIView(_ view: UITextView, context: Context) {
        let coordinator = context.coordinator
        guard !coordinator.isInvalidated else { return }
        coordinator.parent = self
        coordinator.configureBookmarkGesture(view)
        if !isReadingSurfaceActive { coordinator.edgeTap?.cancelPending(); coordinator.cancelQueuedUserTurns() }
        coordinator.updateContent(view)
        coordinator.dismissSelection(in: view, id: selectionDismissalID)
        coordinator.updateSpeech(view)
        coordinator.consumePageRequest()
    }
    static func dismantleUIView(_ view: UITextView, coordinator: Coordinator) {
        (view as? ReflowTextView)?.onSizeChange = nil
        coordinator.invalidate(); view.delegate = nil
    }
    struct Span { var passage: Passage; var range: NSRange; var sourceOffsets: SourceTextOffsets; var sourceRange: NSRange? = nil; var isTranslation = false; var sourceUTF16Start = 0; var sourceUTF16End: Int? = nil; var bookmarkPresentation: ReaderBookmarkPresentation? = nil; var presentationTextLength: Int? = nil }
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
        private(set) var textWindow: ReadingTextWindow?
        private var nextWindowEndsAtAnchor = false
        func updateContent(_ view: UITextView) {
            guard !isInvalidated else { return }
            let coordinator = self, session = parent.session
            if renderedChapterID == nil { view.alpha = 0 }
            let column = layout(for: view)
            let layoutChanged = coordinator.renderedSize != view.bounds.size || coordinator.renderedInsets != column.insets
            var anchor = session.currentAnchor
            // UIKit can clamp the scroll offset while changing its container or
            // viewport. Keep those intermediate callbacks out of reading progress.
            if layoutChanged { coordinator.invalidateVisiblePage(); coordinator.restoring = true; coordinator.cancelPendingCapture() }
            if view.textContainerInset != column.insets {
                view.textContainerInset = column.insets
            }
            coordinator.renderedSize = view.bounds.size; coordinator.renderedInsets = column.insets
            let preferences = session.state.preferences
            let width = column.contentWidth
            var followingNewWindow = false
            if parent.followsSpeech, view.selectedRange.length == 0, let highlight = parent.speechHighlight,
               highlight.location.chapterID == session.chapter.id {
                let offsets = textWindow?.slices.first(where: { $0.original.id == highlight.location.passageID })?.offsets ?? SourceTextOffsets(highlight.location.snapshot)
                let scalar = highlight.location.layer == "original" ? offsets.scalarOffset(forUTF16Offset: highlight.wordRange.location) : 0
                let spoken = ReadingAnchor(chapterID: session.chapter.id, passageID: highlight.location.passageID, characterOffset: scalar)
                if textWindow?.contains(spoken) != true,
                   let passage = session.chapter.passages.first(where: { $0.id == spoken.passageID }),
                   (highlight.location.layer != "original" || passage.text == highlight.location.snapshot) {
                    anchor = spoken; followingNewWindow = true
                }
            }
            let windowSourceChanged = coordinator.indexedSessionID != ObjectIdentifier(session) || coordinator.indexedChapterIndex != session.chapterIndex
            if windowSourceChanged || textWindow == nil || followingNewWindow || (coordinator.navigationID != session.navigationID && anchor.map { textWindow?.contains($0) != true } == true) {
                let prepared = session.preparedTextWindow
                if textWindow == nil, !nextWindowEndsAtAnchor, let prepared,
                   prepared.chapterID == session.chapter.id,
                   anchor.map({ prepared.contains($0) }) ?? (prepared.previousAnchor == nil) {
                    textWindow = prepared
                } else {
                    textWindow = ReadingTextWindow(chapter: session.chapter, anchor: anchor, endingAtAnchor: nextWindowEndsAtAnchor,
                                                   reusing: coordinator.indexedSessionID == ObjectIdentifier(session) ? textWindow : prepared)
                }
                nextWindowEndsAtAnchor = false
            }
            guard let window = textWindow else { return }
            let displayedChapter = window.chapter(from: session.chapter)
            let signature = contentSignature(in: view, width: Int(width))
            let navigationModeChanged = renderedNavigationMode != preferences.navigationMode
            let navigating = coordinator.navigationID != session.navigationID
            // A session owns an immutable book/source version. Never carry indices into another source.
            let sameSource = coordinator.indexedSessionID == ObjectIdentifier(session) && coordinator.indexedChapterIndex == session.chapterIndex
            if sameSource, !navigating, !layoutChanged, !navigationModeChanged, coordinator.pageCurl.isActive,
               coordinator.sameTypography(coordinator.renderedPreferences, preferences), coordinator.signature != signature {
                coordinator.deferredContentUpdate = true
                return
            }
            if coordinator.pendingPageTransition != nil, !coordinator.pendingTransitionIsCurrent {
                coordinator.cancelPageTransition(.notReady)
            }
            if layoutChanged || navigating || navigationModeChanged || !sameSource || coordinator.signature != signature {
                coordinator.invalidateVisiblePage()
                if coordinator.pendingPageTransition == nil { coordinator.pageCurl.cancel(); coordinator.cancelQueuedUserTurns() }
                if coordinator.pendingPageTransition == nil { coordinator.finishPageRequest(.notReady) }
            }
            // A background result must not rebuild UIKit's selected text or its
            // native edit menu. The selection-ending callback requests a fresh render.
            if sameSource, !navigating, !layoutChanged, view.selectedRange.length > 0,
               coordinator.sameTypography(coordinator.renderedPreferences, preferences), coordinator.signature != signature { return }
            let bookmarkViewport = coordinator.requestedBookmarkViewport()
            let translatedViewport = bookmarkViewport ?? (sameSource && !navigating
                && coordinator.renderedPreferences?.viewMode == preferences.viewMode
                && coordinator.renderedPreferences?.translationVariant == preferences.translationVariant
                ? (coordinator.pendingTranslatedViewport ?? coordinator.translatedViewport()) : nil)
            if !sameSource || coordinator.signature != signature {
                deferredContentUpdate = false
                contentBuildCount += 1
                coordinator.protectRestoration(in: view)
                func sourceOffsets(for passage: Passage, at index: Int) -> SourceTextOffsets {
                    window.slices.indices.contains(index) ? window.slices[index].offsets : SourceTextOffsets(passage.text)
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
                coordinator.spans = []; coordinator.markdownDisplayPrefix = 0
                let font = ReaderTypography.font(style: preferences.fontStyle, size: preferences.fontSize, traits: view.traitCollection, latin: preferences.latinFont)
                if session.book.rendersMarkdown && window.isComplete && window.slices.allSatisfy({ $0.sourceRange.length == $0.offsets.utf16Count }) && (preferences.viewMode == .source || !displayedChapter.passages.contains { session.translations[$0.id]?.text(preferences.translationVariant) != nil }) {
                    if !sameSource || coordinator.markdownChapterID != session.chapter.id + window.signature {
                        coordinator.markdown = MarkdownChapterLayout(book: session.book, chapter: displayedChapter, original: session.original, useRetainedSource: window.isComplete)
                        coordinator.markdownChapterID = session.chapter.id + window.signature
                    }
                    if let layout = coordinator.markdown {
                        if preferences.viewMode != .source {
                            let caption = UIFontMetrics(forTextStyle: .caption1).scaledFont(for: .systemFont(ofSize: 12, weight: .medium), compatibleWith: view.traitCollection)
                            result.append(NSAttributedString(string: "译文尚未准备 · 原文\n\n", attributes: [.font: caption, .foregroundColor: UIColor.secondaryLabel]))
                            coordinator.markdownDisplayPrefix = result.length
                        }
                        let sourceScale = preferences.viewMode == .parallel ? preferences.parallelSourceScale : 1
                        result.append(layout.attributed(font: font.withSize(font.pointSize * sourceScale), size: preferences.fontSize * sourceScale,
                            lineSpacing: preferences.lineSpacing, contentWidth: width,
                            sourceOpacity: preferences.viewMode == .parallel ? preferences.parallelSourceOpacity : 1,
                            paragraphSpacing: preferences.viewMode == .parallel ? preferences.parallelSpacing : nil))
                        coordinator.spans = zip(displayedChapter.passages, layout.sourceRanges).enumerated().map { index, pair in
                            let (passage, source) = pair
                            let start = coordinator.markdownDisplayPrefix + layout.document.displayedUTF16Offset(forSourceUTF16Offset: source.location)
                            let end = coordinator.markdownDisplayPrefix + layout.document.displayedUTF16Offset(forSourceUTF16Offset: NSMaxRange(source))
                            return Span(passage: passage, range: NSRange(location: start, length: max(0, end - start)), sourceOffsets: sourceOffsets(for: passage, at: index), sourceRange: source)
                        }
                    }
                } else {
                coordinator.markdown = nil; coordinator.markdownChapterID = nil
                if session.book.rendersMarkdown && !window.isComplete {
                    let caption = UIFontMetrics(forTextStyle: .caption1).scaledFont(for: .systemFont(ofSize: 12), compatibleWith: view.traitCollection)
                    result.append(NSAttributedString(string: "Markdown 源文\n\n", attributes: [.font: caption, .foregroundColor: UIColor.secondaryLabel]))
                }
                for (passageIndex, passage) in displayedChapter.passages.enumerated() {
                    let slice = window.slices[passageIndex]
                    let start = result.length
                    let style = NSMutableParagraphStyle(); style.lineSpacing = preferences.lineSpacing; style.paragraphSpacing = preferences.viewMode == .parallel ? preferences.parallelSpacing : 20; style.baseWritingDirection = .natural
                    if let resource = passage.resourcePath {
                        let source = session.directory.appendingPathComponent("assets").appendingPathComponent(resource)
                        if session.canReadResource(resource), let imageSource = CGImageSourceCreateWithURL(source as CFURL, nil), let cgImage = CGImageSourceCreateThumbnailAtIndex(imageSource, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: 2048] as CFDictionary) {
                            let image = UIImage(cgImage: cgImage), attachment = NSTextAttachment()
                            attachment.image = image
                            attachment.bounds = CGRect(x: 0, y: 0, width: width, height: width * image.size.height / max(1, image.size.width))
                            result.append(NSAttributedString(attachment: attachment))
                            let alternative = passage.alternative?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                            let next = displayedChapter.passages.indices.contains(passageIndex + 1) ? displayedChapter.passages[passageIndex + 1].text.trimmingCharacters(in: .whitespacesAndNewlines) : nil
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
                        let layers = ReadingLayers.segments(passage: passage, preferences: preferences, translation: slice.sourceRange.length == slice.offsets.utf16Count ? session.translations[passage.id] : nil)
                        for layer in layers {
                            if layer.isTranslation || layer.translationMissing {
                                let variant = preferences.translationVariant == .literal ? "直译" : "意译"
                                let label = layer.translationMissing ? "译文尚未准备 · 原文" : variant + (layer.status == "reviewed" ? " · 已校订" : " · 未校订")
                                let caption = UIFontMetrics(forTextStyle: .caption1).scaledFont(for: .systemFont(ofSize: 12, weight: .medium), compatibleWith: view.traitCollection)
                                result.append(NSAttributedString(string: label + "\n", attributes: [.font: caption, .foregroundColor: UIColor.secondaryLabel, .paragraphStyle: style]))
                            }
                            let layerStart = result.length
                            let comparisonSource = preferences.viewMode == .parallel && !layer.isTranslation && !passage.heading
                            let ink = comparisonSource ? UIColor.label.withAlphaComponent(preferences.parallelSourceOpacity) : UIColor.label
                            let layerFont = comparisonSource ? actualFont.withSize(actualFont.pointSize * preferences.parallelSourceScale) : actualFont
                            let prefix = !layer.isTranslation && slice.sourceRange.location == 0 ? ReaderParagraphPresentation.leadingIndentUTF16(layer.text, kind: session.book.kind, heading: passage.heading) : 0
                            let displayed = (layer.text as NSString).substring(from: prefix)
                            let bodyStyle = style.mutableCopy() as! NSMutableParagraphStyle
                            if !passage.heading && (layer.isTranslation || slice.sourceRange.location == 0) { bodyStyle.firstLineHeadIndent = preferences.firstLineIndent == .twoCharacters ? layerFont.pointSize * 2 : 0 }
                            result.append(NSAttributedString(string: displayed, attributes: [.font: layerFont, .foregroundColor: ink, .paragraphStyle: bodyStyle]))
                            result.append(NSAttributedString(string: preferences.viewMode == .source ? "\n" : "\n\n", attributes: [.font: font, .paragraphStyle: style]))
                            let presentation = layer.isTranslation ? ReaderBookmarkPresentation(layer: preferences.translationVariant, targetLanguage: session.translationSettings.targetLanguage, text: layer.text, utf16Offset: 0, viewMode: preferences.viewMode) : nil
                            coordinator.spans.append(Span(passage: slice.original, range: NSRange(location: layerStart, length: result.length - layerStart), sourceOffsets: sourceOffsets(for: passage, at: passageIndex), isTranslation: layer.isTranslation, sourceUTF16Start: slice.sourceRange.location + prefix, sourceUTF16End: NSMaxRange(slice.sourceRange), bookmarkPresentation: presentation, presentationTextLength: layer.isTranslation ? layer.text.utf16.count : nil))
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
            } else if navigating || layoutChanged || navigationModeChanged {
                coordinator.protectRestoration(in: view)
                coordinator.navigationID = session.navigationID
                coordinator.restoring = true
                if navigating { view.selectedRange = NSRange(location: 0, length: 0) }
                coordinator.restore(anchor, translatedViewport: bookmarkViewport, persistCheckpoint: !navigating)
            }
            coordinator.renderedNavigationMode = preferences.navigationMode
            coordinator.configureNavigation(view)
            coordinator.reportVisiblePage()
        }
        private var restorationCover = false
        private var deferredContentUpdate = false
        private func protectRestoration(in view: UITextView) {
            guard pendingPageTransition == nil, view.attributedText.length > 0, !pageCurl.isActive else { return }
            if let snapshot = pageCurl.snapshot(from: view) {
                pageCurl.protect(snapshot, over: view, paper: pagePaper); restorationCover = true
            }
        }
        private var renderedNavigationMode: ReaderNavigationMode?
        private func sameTypography(_ rendered: ReaderPreferences?, _ current: ReaderPreferences) -> Bool {
            guard let rendered else { return false }
            return rendered.fontStyle == current.fontStyle && rendered.latinFont == current.latinFont && rendered.fontSize == current.fontSize
                && rendered.lineSpacing == current.lineSpacing && rendered.viewMode == current.viewMode
                && rendered.firstLineIndent == current.firstLineIndent
                && rendered.translationVariant == current.translationVariant
                && rendered.parallelOrder == current.parallelOrder && rendered.parallelSourceScale == current.parallelSourceScale
                && rendered.parallelSourceOpacity == current.parallelSourceOpacity && rendered.parallelSpacing == current.parallelSpacing
        }
        private func contentSignature(in view: UITextView, width: Int) -> String {
            let session = parent.session, p = session.state.preferences
            return "\(textWindow?.signature ?? "")-\(session.chapter.id)-\(p.fontStyle)-\(p.latinFont)-\(p.fontSize)-\(p.lineSpacing)-\(p.firstLineIndent)-\(p.viewMode)-\(p.translationVariant)-\(p.parallelOrder)-\(p.parallelSourceScale)-\(p.parallelSourceOpacity)-\(p.parallelSpacing)-\(p.viewMode == .source ? 0 : session.contentRevision)-\(session.packageVerificationPending)-\(view.traitCollection.preferredContentSizeCategory.rawValue)-\(width)"
        }
        var parent: TextReadingView
        weak var view: UITextView?
        private(set) var contentBuildCount = 0
        private(set) var paginationBuildCount = 0
        var spans: [Span] = []
        var markdown: MarkdownChapterLayout?
        var markdownChapterID: String?
        private(set) var markdownDisplayPrefix = 0
        private let speechFollower = ReaderSpeechTextFollower()
        var paragraphSelection: ReaderParagraphSelectionObserver?
        private var paragraphMenu: ReaderParagraphEditMenu?
        struct TranslatedViewport {
            let passageID: String
            let offset: Int
            let text: String
            var bookmarkPresentation: ReaderBookmarkPresentation? = nil
        }
        private func requestedBookmarkViewport() -> TranslatedViewport? {
            guard let request = parent.session.bookmarkNavigation, request.navigationID == parent.session.navigationID,
                  let text = parent.session.verifiedBookmarkText(anchor: request.anchor, presentation: request.presentation) else { return nil }
            return TranslatedViewport(passageID: request.anchor.passageID, offset: request.presentation.utf16Offset,
                text: text, bookmarkPresentation: request.presentation)
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
        private(set) var isInvalidated = false
        var edgeTap: ReaderEdgeTapHandler?
        var pageTurn: ReaderPageTurnGestureHandler?
        private var bookmarkGesture: ReaderBookmarkGestureHandler?
        private var lastBookmarkViewport: [ReaderBookmarkVisibleRange] = []
        var selectionDismissalID: UUID?
        private var pagination: ReaderTextPagination?
        private var paginationKey: String?
        private var lastReportedPage: ReaderPagePosition?
        private let visiblePageLayout = ReaderVisiblePageLayout()
        private var visiblePageGeometry: String?
        private var lastVisiblePage: ReaderVisiblePage?
        private var visiblePageReportGeneration = 0
        private struct PendingPageTransition {
            let direction: ReaderPageDirection
            let snapshot: UIView?
            let navigation: UUID
            let owner: ObjectIdentifier
            let chapterID: String
            let preferences: ReaderPreferences
            let size: CGSize
            let insets: UIEdgeInsets
            var restorationGeneration: Int?
        }
        private var pendingPageTransition: PendingPageTransition?
        private var pendingTransitionIsCurrent: Bool {
            guard let pending = pendingPageTransition, let view else { return false }
            return pending.navigation == parent.session.navigationID && pending.owner == ObjectIdentifier(parent.session)
                && pending.chapterID == parent.session.chapter.id && sameTypography(pending.preferences, parent.session.state.preferences)
                && pending.preferences.navigationMode == parent.session.state.preferences.navigationMode
                && pending.size == view.bounds.size && pending.insets == parent.pageInsets
        }
        private let pageCurl = ReaderPageCurlTransition()
        private var consumedPageRequests = Set<UUID>()
        private var pendingPageRequest: ReaderPageRequest?
        private var delayed: DispatchWorkItem?
        private var restorationGeneration = 0
        private var resignObserver: NSObjectProtocol?
        init(parent: TextReadingView) {
            self.parent = parent
            super.init()
            resignObserver = NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in MainActor.assumeIsolated {
                self?.bookmarkGesture?.cancel(); self?.cancelPageTransition(.notReady); self?.capture()
            } }
        }
        deinit { delayed?.cancel(); if let resignObserver { NotificationCenter.default.removeObserver(resignObserver) } }
        func dismissSelection(in textView: UITextView, id: UUID) {
            guard !isInvalidated else { return }
            guard selectionDismissalID != id else { return }
            selectionDismissalID = id
            guard let window = textView.window else { return }
            let owner = ObjectIdentifier(parent.session), navigation = parent.session.navigationID
            let chapterIndex = parent.session.chapterIndex, chapter = parent.session.chapter.id
            let generation = restorationGeneration, range = textView.selectedRange
            // Resigning here synchronously can ask SwiftUI for its next responder
            // while updateUIView is still updating that same responder graph.
            DispatchQueue.main.async { [weak self, weak textView, weak window] in
                guard let self, !self.isInvalidated, let textView, let window, self.view === textView,
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
            guard !isInvalidated else { return }
            invalidateVisiblePage()
            cancelPageTransition(.blocked)
            paragraphSelection?.cancel()
            restorationGeneration += 1; restoring = false; pendingTranslatedViewport = nil; cancelPendingCapture()
            parent.session.clearTransientSelection()
            parent.onReadingScroll()
        }
        func scrollViewDidScroll(_ scrollView: UIScrollView) {
            invalidateVisiblePage()
            guard checkpointVisible() else { return }
            schedulePersistence()
            reportPagePosition()
        }
        func cancelPendingCapture() { delayed?.cancel(); delayed = nil }
        private func schedulePersistence() {
            cancelPendingCapture()
            let generation = restorationGeneration, navigation = navigationID, chapter = renderedChapterID
            let work = DispatchWorkItem { [weak self] in
                guard let self, !self.isInvalidated, self.restorationGeneration == generation, self.navigationID == navigation,
                      self.renderedChapterID == chapter else { return }
                self.persistCheckpoint()
            }; delayed = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.18, execute: work)
        }
        func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) { capture(); continueScrollingWindow() }
        func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) { if !decelerate { capture(); continueScrollingWindow() } }
        private func continueScrollingWindow() {
            guard !restoring, let view, view.selectedRange.length == 0,
                  parent.session.state.preferences.navigationMode != .paged, let current = textWindow,
                  let anchor = parent.session.currentAnchor else { return }
            let nearEnd = view.contentOffset.y + view.bounds.height * 2 >= view.contentSize.height && current.nextAnchor != nil
            let nearStart = view.contentOffset.y <= view.bounds.height && current.previousAnchor != nil
            guard nearEnd || nearStart else { return }
            let next = ReadingTextWindow(chapter: parent.session.chapter, anchor: anchor, reusing: current)
            guard next.signature != current.signature else { return }
            let navigation = parent.session.navigationID
            DispatchQueue.main.async { [weak self, weak view] in
                guard let self, let view, !self.isInvalidated, !self.restoring,
                      self.parent.session.navigationID == navigation, view.selectedRange.length == 0 else { return }
                self.textWindow = next; self.updateContent(view)
            }
        }
        func capture() {
            if checkpointVisible() { cancelPendingCapture(); persistCheckpoint() }
            reportVisiblePage()
        }
        private func currentVisiblePageGeometry() -> String? {
            guard !isInvalidated, !restoring, !pageCurl.isActive, pendingPageTransition == nil,
                  let view, view.window != nil, !view.isDragging, !view.isDecelerating,
                  view.bounds.width > 0, view.bounds.height > 0, !spans.isEmpty,
                  indexedSessionID == ObjectIdentifier(parent.session), indexedChapterIndex == parent.session.chapterIndex,
                  renderedChapterID == parent.session.chapter.id, navigationID == parent.session.navigationID,
                  renderedSize == view.bounds.size, renderedInsets == view.textContainerInset,
                  renderedInsets == layout(for: view).insets,
                  signature == contentSignature(in: view, width: renderedWidth) else { return nil }
            return "\(signature)-\(view.bounds)-\(view.textContainerInset)-\(parent.pageInsets)-\(parent.session.state.preferences)-\(parent.session.contentRevision)"
        }
        func visiblePage() -> ReaderVisiblePage? {
            guard let geometry = currentVisiblePageGeometry(), let view else { return nil }
            view.layoutManager.ensureLayout(for: view.textContainer)
            let viewport = (view as? ReflowTextView)?.visibleReadingRect ?? view.bounds.inset(by: parent.pageInsets)
            let reading = viewport.offsetBy(dx: -view.textContainerInset.left, dy: -view.textContainerInset.top)
            guard reading.width > 0, reading.height > 0 else { return nil }
            let displayed = view.attributedText.string as NSString
            var ids = Set<String>()
            for span in spans where ReadingTranslationPlan.isPageText(span.passage, in: parent.session.book) && span.range.length > 0 {
                guard span.range.location >= 0, NSMaxRange(span.range) <= displayed.length else { return nil }
                var range = span.range
                while range.length > 0, let scalar = UnicodeScalar(displayed.character(at: NSMaxRange(range) - 1)), CharacterSet.whitespacesAndNewlines.contains(scalar) { range.length -= 1 }
                guard range.length > 0 else { continue }
                let glyphs = view.layoutManager.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
                var intersects = false
                view.layoutManager.enumerateEnclosingRects(forGlyphRange: glyphs, withinSelectedGlyphRange: NSRange(location: NSNotFound, length: 0), in: view.textContainer) { rect, _ in
                    let intersection = rect.intersection(reading)
                    if !intersection.isNull, intersection.width > 0, intersection.height > 0 { intersects = true }
                }
                if intersects { ids.insert(span.passage.id) }
            }
            guard !ids.isEmpty else { return nil }
            if visiblePageGeometry != geometry { visiblePageLayout.invalidate(); visiblePageGeometry = geometry }
            visiblePageLayout.bind { [weak self] in self?.currentVisiblePageGeometry() == geometry }
            return ReaderVisiblePage(session: parent.session, chapterID: parent.session.chapter.id,
                passageIDs: parent.session.chapter.passages.filter { ids.contains($0.id) }.map(\.id), layout: visiblePageLayout)
        }
        private func invalidateVisiblePage() {
            visiblePageLayout.invalidate(); visiblePageGeometry = nil
            publishVisiblePage(nil)
            publishBookmarkViewport([])
        }
        private func reportVisiblePage() { publishVisiblePage(visiblePage()); reportBookmarkViewport() }
        private func publishVisiblePage(_ page: ReaderVisiblePage?) {
            guard page != lastVisiblePage else { return }
            lastVisiblePage = page; visiblePageReportGeneration += 1
            let generation = visiblePageReportGeneration
            DispatchQueue.main.async { [weak self] in
                guard let self, !self.isInvalidated, self.visiblePageReportGeneration == generation else { return }
                guard page?.isCurrent(self.parent.session) != false else { return }
                self.parent.onVisiblePage?(page)
            }
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
                  signature == contentSignature(in: view, width: renderedWidth) else { return false }
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
            guard !isInvalidated, span.passage.resourcePath == nil else { return }
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
            guard !isInvalidated, !restoring else { return }
            var target: ReaderSpeechTextTarget?
            if view.selectedRange.length == 0, let highlight = parent.speechHighlight,
               highlight.location.chapterID == parent.session.chapter.id,
               let span = spans.first(where: { $0.passage.id == highlight.location.passageID && ($0.isTranslation == (highlight.location.layer != "original")) }) {
                let snapshot = span.isTranslation ? parent.session.translations[span.passage.id]?.text(parent.session.state.preferences.translationVariant) : span.passage.text
                let layerMatches = !span.isTranslation || parent.session.state.preferences.translationVariant.rawValue == highlight.location.layer
                func displayed(_ range: NSRange) -> NSRange? {
                    guard range.location >= 0, range.length > 0, NSMaxRange(range) <= highlight.location.snapshot.utf16.count else { return nil }
                    if let source = span.sourceRange, let markdown {
                        let start = self.markdownDisplayPrefix + markdown.document.displayedUTF16Offset(forSourceUTF16Offset: source.location + range.location)
                        let end = self.markdownDisplayPrefix + markdown.document.displayedUTF16Offset(forSourceUTF16Offset: source.location + NSMaxRange(range))
                        return NSRange(location: start, length: max(0, end - start))
                    }
                    let visible = span.isTranslation ? range : NSIntersectionRange(range, NSRange(location: span.sourceUTF16Start, length: (span.sourceUTF16End ?? span.sourceOffsets.utf16Count) - span.sourceUTF16Start))
                    guard visible.length > 0 else { return nil }
                    let start = span.range.location + visible.location - (span.isTranslation ? 0 : span.sourceUTF16Start)
                    guard start >= span.range.location, start + visible.length <= NSMaxRange(span.range) else { return nil }
                    return NSRange(location: start, length: visible.length)
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
                    guard let self, !self.isInvalidated, self.restorationGeneration == generation, self.navigationID == navigation else { return }
                    self.capture(); self.reportPagePosition()
                }
            }
        }
        private func sourceOffset(in span: Span, displayedIndex: Int) -> Int {
            if span.isTranslation { return 0 }
            if let source = span.sourceRange, let markdown {
                return min(max(span.sourceUTF16Start, span.sourceUTF16Start + markdown.document.sourceUTF16Offset(at: max(0, displayedIndex - markdownDisplayPrefix)) - source.location), span.sourceUTF16End ?? span.sourceOffsets.utf16Count)
            }
            return min(max(span.sourceUTF16Start, span.sourceUTF16Start + displayedIndex - span.range.location), span.sourceUTF16End ?? span.sourceOffsets.utf16Count)
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
            guard !isInvalidated else { return }
            if textView.selectedRange.length > 0 { edgeTap?.cancelPending(); cancelPageTransition(.blocked) }
            paragraphSelection?.selectionChanged()
            let range = textView.selectedRange, navigation = navigationID
            // UIKit can notify synchronously during representable updates. Publish
            // only the latest user selection after that update has completed.
            DispatchQueue.main.async { [weak self, weak textView] in
                guard let self, !self.isInvalidated, let textView, self.view === textView, !self.restoring,
                      self.indexedSessionID == ObjectIdentifier(self.parent.session),
                      self.indexedChapterIndex == self.parent.session.chapterIndex,
                      self.navigationID == navigation, self.parent.session.navigationID == navigation,
                      self.renderedChapterID == self.parent.session.chapter.id,
                      textView.selectedRange == range else { return }
                self.parent.onSelectionChange?(self.selectedQuote(in: textView, range: range), range.length > 0)
            }
        }
        func invalidate() {
            bookmarkGesture?.invalidate(); bookmarkGesture = nil
            edgeTap?.invalidate(); edgeTap = nil
            queuedPages = []
            guard !isInvalidated else { return }
            // SwiftUI may be invalidating its graph while native observers are
            // removed. Stop every host callback before any removal can reenter.
            isInvalidated = true; restoring = true
            visiblePageLayout.invalidate(); visiblePageGeometry = nil
            let onVisiblePage = parent.onVisiblePage; parent.onVisiblePage = nil
            DispatchQueue.main.async { onVisiblePage?(nil) }
            let onBookmarkViewport = parent.onBookmarkViewport
            parent.onBookmark = nil; parent.onBookmarkPull = nil; parent.onBookmarkViewport = nil; parent.onBookmarkCapture = nil
            DispatchQueue.main.async { onBookmarkViewport?([]) }
            parent.onTouchActivity = nil; parent.onSelectionChange = nil
            parent.onPageChange = nil; parent.onReadingPosition = nil; parent.onPageRequestResult = nil
            view?.delegate = nil
            cancelPageTransition(.notReady)
            paragraphMenu?.invalidate(); paragraphMenu = nil
            paragraphSelection?.invalidate(); paragraphSelection = nil
            restorationGeneration += 1; cancelPendingCapture(); view = nil
            spans = []; textWindow = nil; indexedSessionID = nil; indexedChapterIndex = nil
            markdown = nil; markdownChapterID = nil
            pageTurn?.invalidate(); pageTurn = nil; pagination = nil; paginationKey = nil
        }
        private var bookmarkBlocked: Bool {
            isInvalidated || !parent.isReadingSurfaceActive || parent.session.packageVerificationError != nil
                || restoring || pageCurl.isActive || pendingPageTransition != nil || view?.selectedRange.length != 0
                || UIMenuController.shared.isMenuVisible
        }
        private var bookmarkContext: String? {
            guard !bookmarkBlocked, let view, renderedChapterID == parent.session.chapter.id,
                  navigationID == parent.session.navigationID else { return nil }
            return "\(ObjectIdentifier(parent.session))-\(parent.session.navigationID)-\(parent.session.book.sourceVersion)-\(parent.session.state.preferences)-\(parent.session.contentRevision)-\(view.bounds.size)-\(parent.pageInsets)"
        }
        func configureBookmarkGesture(_ view: UITextView) {
            if bookmarkGesture == nil {
                bookmarkGesture = ReaderBookmarkGestureHandler(view: view, blocked: { [weak self] in self?.bookmarkBlocked != false },
                    isPaged: { [weak self] in self?.parent.session.state.preferences.navigationMode == .paged },
                    isTrueTop: { [weak self] scroll in
                        guard let self, self.textWindow?.previousAnchor == nil else { return false }
                        return scroll.contentOffset.y <= -scroll.adjustedContentInset.top + 1
                    }, capture: { [weak self] in
                        guard let self, let capture = self.bookmarkCapture(), let context = self.bookmarkContext else { return nil }
                        return ReaderBookmarkGestureCapture(anchor: capture.anchor, context: context, presentation: capture.presentation)
                    }, context: { [weak self] in self?.bookmarkContext }, readingRect: { [weak self, weak view] in
                        guard let self, let view else { return .zero }
                        return (view as? ReflowTextView)?.visibleReadingRect ?? view.bounds.inset(by: self.parent.pageInsets)
                    }, onBookmark: { [weak self] anchor in self?.parent.onBookmark?(anchor) },
                    onFeedback: { [weak self] value in self?.parent.onBookmarkPull?(value) },
                    onBookmarkCapture: { [weak self] value in _ = self?.emitBookmark(value) })
                (view as? ReflowTextView)?.readerBookmarkRecognizer = bookmarkGesture?.recognizer
            }
            bookmarkGesture?.observe(scroll: view)
            bookmarkGesture?.configure(enabled: (parent.onBookmark != nil || parent.onBookmarkCapture != nil) && parent.isReadingSurfaceActive)
        }
        @discardableResult private func emitBookmark(_ capture: ReaderBookmarkCapture) -> Bool {
            if let callback = parent.onBookmarkCapture { callback(capture); return true }
            guard capture.presentation == nil, let callback = parent.onBookmark else { return false }
            callback(capture.anchor); return true
        }
        func bookmarkCapture() -> ReaderBookmarkCapture? {
            guard !bookmarkBlocked, checkpointVisible(), let view else { return nil }
            let point = CGPoint(x: 1, y: max(0, view.contentOffset.y + max(0, parent.pageInsets.top) + 1 - view.textContainerInset.top))
            let index = view.layoutManager.characterIndex(for: point, in: view.textContainer, fractionOfDistanceBetweenInsertionPoints: nil)
            guard let span = spans.first(where: { NSMaxRange($0.range) > index }) ?? spans.last else { return nil }
            if var presentation = span.bookmarkPresentation, let length = span.presentationTextLength {
                presentation.utf16Offset = min(max(0, index - span.range.location), max(0, length - 1))
                let anchor = ReadingAnchor(chapterID: parent.session.chapter.id, passageID: span.passage.id)
                guard parent.session.verifiedBookmarkText(anchor: anchor, presentation: presentation) != nil else { return nil }
                return ReaderBookmarkCapture(anchor: anchor, presentation: presentation)
            }
            guard let anchor = parent.session.currentAnchor else { return nil }
            return ReaderBookmarkCapture(anchor: anchor)
        }
        private func reportBookmarkViewport() {
            guard parent.onBookmarkViewport != nil, currentVisiblePageGeometry() != nil, let view else { return }
            let viewport = (view as? ReflowTextView)?.visibleReadingRect ?? view.bounds.inset(by: parent.pageInsets)
            let reading = viewport.offsetBy(dx: -view.textContainerInset.left, dy: -view.textContainerInset.top)
            guard reading.width > 0, reading.height > 0 else { publishBookmarkViewport([]); return }
            let manager = view.layoutManager
            let glyphs = manager.glyphRange(forBoundingRect: reading, in: view.textContainer)
            let characters = manager.characterRange(forGlyphRange: glyphs, actualGlyphRange: nil)
            var ranges: [ReaderBookmarkVisibleRange] = []
            for span in spans where span.range.length > 0 {
                let overlap = NSIntersectionRange(span.range, characters)
                guard overlap.length > 0 else { continue }
                var start = ReadingAnchor(chapterID: parent.session.chapter.id, passageID: span.passage.id,
                    characterOffset: span.sourceOffsets.scalarOffset(forUTF16Offset: sourceOffset(in: span, displayedIndex: overlap.location)))
                var end = ReadingAnchor(chapterID: start.chapterID, passageID: start.passageID,
                    characterOffset: span.sourceOffsets.scalarOffset(forUTF16Offset: sourceOffset(in: span, displayedIndex: NSMaxRange(overlap) - 1)))
                if let image = renderedImageRect(in: span, view: view) {
                    let visible = image.intersection(reading)
                    guard !visible.isNull, !visible.isEmpty else { continue }
                    start.characterOffset = 0; end.characterOffset = 0
                    start.resourceY = Double(min(1, max(0, (visible.minY - image.minY) / image.height)))
                    end.resourceY = Double(min(1, max(0, (visible.maxY - image.minY) / image.height)))
                }
                if var presentation = span.bookmarkPresentation, let length = span.presentationTextLength {
                    let first = max(0, overlap.location - span.range.location)
                    guard first < length else { continue }
                    presentation.utf16Offset = first
                    let last = min(length - 1, NSMaxRange(overlap) - span.range.location - 1)
                    ranges.append(ReaderBookmarkVisibleRange(start: start, end: end, presentation: presentation, displayEndOffset: last))
                } else { ranges.append(ReaderBookmarkVisibleRange(start: start, end: end)) }
            }
            publishBookmarkViewport(ranges)
        }
        private func publishBookmarkViewport(_ ranges: [ReaderBookmarkVisibleRange]) {
            guard lastBookmarkViewport != ranges else { return }
            lastBookmarkViewport = ranges
            let owner = ObjectIdentifier(parent.session), navigation = parent.session.navigationID
            DispatchQueue.main.async { [weak self] in
                guard let self, !self.isInvalidated, ObjectIdentifier(self.parent.session) == owner,
                      self.parent.session.navigationID == navigation, self.lastBookmarkViewport == ranges else { return }
                self.parent.onBookmarkViewport?(ranges)
            }
        }
        func configureNavigation(_ view: UITextView) {
            guard !isInvalidated else { return }
            let paged = parent.session.state.preferences.navigationMode == .paged
            bookmarkGesture?.configure(enabled: (parent.onBookmark != nil || parent.onBookmarkCapture != nil) && parent.isReadingSurfaceActive)
            pageTurn?.isEnabled = paged && parent.session.state.preferences.pageInput.allowsSwipe
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
            if parent.onBookmark != nil || parent.onBookmarkCapture != nil {
                var actions = view.accessibilityCustomActions ?? []
                actions.append(UIAccessibilityCustomAction(name: "添加当前位置书签") { [weak self] _ in
                    guard let self, let capture = self.bookmarkCapture() else { return false }
                    return self.emitBookmark(capture)
                })
                view.accessibilityCustomActions = actions
            }
        }
        private func refreshPagination() {
            // Restoration needs the new last line-aligned origin and its scroll
            // allowance before positioning the saved source glyph.
            guard let view, parent.session.state.preferences.navigationMode == .paged else { return }
            let key = "\(ObjectIdentifier(parent.session))-\(signature)-\(view.bounds.size)-\(view.textContainerInset)-\(parent.pageInsets)"
            guard key != paginationKey else { return }
            paginationKey = key
            paginationBuildCount += 1
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
            reportVisiblePage()
            guard !restoring, let view, parent.session.state.preferences.navigationMode == .paged else { return }
            refreshPagination()
            guard let pagination else { return }
            let position = ReaderPagePosition(index: pagination.index(at: view.contentOffset.y), count: pagination.origins.count, chapterIndex: parent.session.chapterIndex, isChapterComplete: textWindow?.isComplete ?? true)
            guard position != lastReportedPage else { return }
            lastReportedPage = position
            let navigation = navigationID, generation = restorationGeneration
            DispatchQueue.main.async { [weak self] in
                guard let self, !self.isInvalidated, self.navigationID == navigation, self.restorationGeneration == generation,
                      self.lastReportedPage == position, self.parent.session.state.preferences.navigationMode == .paged else { return }
                self.parent.onPageChange?(position)
            }
        }
        func consumePageRequest() {
            guard !isInvalidated else { return }
            guard let request = parent.pageRequest, consumedPageRequests.insert(request.id).inserted else { return }
            guard request.expectedNavigationID == parent.session.navigationID,
                  navigationID == parent.session.navigationID, !restoring,
                  let view, view.bounds.width > 0, view.bounds.height > 0 else {
                respond(to: request, with: .notReady); return
            }
            guard pendingPageRequest == nil, !pageCurl.isActive,
                  view.selectedRange.length == 0, paragraphSelection?.isTouchActive != true,
                  parent.session.state.preferences.navigationMode == .paged else {
                respond(to: request, with: .blocked); return
            }
            pendingPageRequest = request
            let generation = restorationGeneration, navigation = navigationID, owner = ObjectIdentifier(parent.session)
            let source = signature, size = view.bounds.size, insets = parent.pageInsets
            // updateUIView is inside SwiftUI's rendering transaction. Native
            // snapshotView(afterScreenUpdates: true) must run after that call
            // returns, otherwise it can wait on the transaction it is blocking.
            DispatchQueue.main.async { [weak self, weak view] in
                guard let self, !self.isInvalidated, self.pendingPageRequest?.id == request.id else { return }
                guard let view, self.view === view, self.parent.pageRequest?.id == request.id,
                      ObjectIdentifier(self.parent.session) == owner,
                      self.navigationID == navigation, self.parent.session.navigationID == navigation,
                      self.restorationGeneration == generation, self.signature == source,
                      view.bounds.size == size, self.parent.pageInsets == insets else {
                    self.finishPageRequest(.notReady); return
                }
                guard !self.restoring, !self.pageCurl.isActive, view.selectedRange.length == 0,
                      self.paragraphSelection?.isTouchActive != true,
                      self.parent.session.state.preferences.navigationMode == .paged else {
                    self.finishPageRequest(.blocked); return
                }
                if !self.turnPage(request.direction, origin: request.origin) { self.finishPageRequest(.end) }
            }
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
        private func cancelPageTransition(_ outcome: ReaderPageRequestOutcome) {
            pendingPageTransition = nil; cancelQueuedUserTurns(); restorationCover = false; deferredContentUpdate = false
            finishPageRequest(outcome); pageCurl.cancel()
        }
        private var queueGeneration = 0
        private var drainingQueuedPage = false
        private var queuedPages: [(direction: ReaderPageDirection, owner: ObjectIdentifier, navigation: UUID)] = []
        var blocksEdgeTaps: Bool {
            isInvalidated || !parent.isReadingSurfaceActive || view?.selectedRange.length != 0 || (restoring && !pendingTransitionIsCurrent)
        }
        func touchActivity(_ active: Bool) {
            edgeTap?.touchActivity(active)
            if !active { DispatchQueue.main.async { [weak self] in self?.drainQueuedPage() } }
            guard !isInvalidated else { return }
            if active, pendingPageRequest?.origin == .automatic { queuedPages = []; cancelPageTransition(.blocked) }
            parent.onTouchActivity?(active)
        }
        fileprivate func wake(_ edge: ReaderChrome) {
            guard !isInvalidated else { return }
            parent.onWake(edge)
        }
        private var pagePaper: UIColor {
            return parent.session.state.preferences.paperColor
        }
        private func animatePage(from snapshot: UIView?, direction: ReaderPageDirection) {
            guard let view else { finishPageRequest(.notReady); return }
            let generation = restorationGeneration, navigation = navigationID, owner = indexedSessionID
            pageCurl.animate(from: snapshot, over: view, direction: direction, paper: pagePaper, style: parent.session.state.preferences.pageAnimation) { [weak self] completed in
                guard let self, !self.isInvalidated else { return }
                guard completed, self.restorationGeneration == generation, self.navigationID == navigation,
                      self.parent.session.navigationID == navigation, self.indexedSessionID == owner,
                      owner == ObjectIdentifier(self.parent.session), !self.restoring else {
                    self.finishPageRequest(.notReady); return
                }
                self.finishPageRequest(.settled(navigationID: self.parent.session.navigationID))
                self.reportVisiblePage()
                if !self.queuedPages.isEmpty { self.drainQueuedPage() }
                else { self.flushDeferredContentIfIdle() }
            }
        }
        private func flushDeferredContentIfIdle() {
            guard deferredContentUpdate, queuedPages.isEmpty, !isInvalidated, !restoring,
                  !pageCurl.isActive, let view, view.selectedRange.length == 0 else { return }
            deferredContentUpdate = false; updateContent(view)
        }
        private func drainQueuedPage() {
            guard !queuedPages.isEmpty, !drainingQueuedPage, !restoring, !pageCurl.isActive,
                  !pendingTransitionIsCurrent, paragraphSelection?.isTouchActive != true else { return }
            let queued = queuedPages.removeFirst(), generation = queueGeneration
            drainingQueuedPage = true
            DispatchQueue.main.async { [weak self] in
                guard let self, self.queueGeneration == generation else { return }
                self.drainingQueuedPage = false
                guard !self.isInvalidated, self.parent.isReadingSurfaceActive,
                      queued.owner == ObjectIdentifier(self.parent.session), queued.navigation == self.parent.session.navigationID,
                      self.view?.selectedRange.length == 0 else {
                    self.cancelQueuedUserTurns(); return
                }
                if self.paragraphSelection?.isTouchActive == true {
                    self.queuedPages.insert(queued, at: 0); return
                }
                if !self.turnPage(queued.direction, fromQueue: true) {
                    self.drainQueuedPage()
                    self.flushDeferredContentIfIdle()
                }
            }
        }
        private func rebaseQueuedNavigation(from previous: UUID) {
            let owner = ObjectIdentifier(parent.session), next = parent.session.navigationID
            for index in queuedPages.indices where queuedPages[index].owner == owner && queuedPages[index].navigation == previous {
                queuedPages[index].navigation = next
            }
            edgeTap?.rebaseNavigation(from: previous, to: next, owner: owner)
        }
        fileprivate func cancelQueuedUserTurns() { queuedPages = []; queueGeneration += 1; drainingQueuedPage = false }
        @discardableResult func turnPage(_ direction: ReaderPageDirection, origin: ReaderPageTurnOrigin = .user, fromQueue: Bool = false) -> Bool {
            guard parent.isReadingSurfaceActive else { return false }
            if origin == .user, !fromQueue, !isInvalidated,
               (pageCurl.isActive || pendingTransitionIsCurrent || drainingQueuedPage || !queuedPages.isEmpty),
               let view, view.selectedRange.length == 0, parent.session.state.preferences.navigationMode == .paged {
                queuedPages.append((direction, ObjectIdentifier(parent.session), parent.session.navigationID))
                drainQueuedPage(); return true
            }
            guard !isInvalidated, let view, !restoring, !pageCurl.isActive, view.selectedRange.length == 0,
                  parent.session.state.preferences.navigationMode == .paged else { return false }
            refreshPagination()
            guard let pagination else { return false }
            if let offset = pagination.destination(direction, from: view.contentOffset.y) {
                guard abs(offset - view.contentOffset.y) > 0.5 else { return false }
                let before = parent.session.state.preferences.pageAnimation == .none || UIAccessibility.isReduceMotionEnabled ? nil : pageCurl.snapshot(from: view)
                pageCurl.protect(before, over: view, paper: pagePaper)
                restorationGeneration += 1; cancelPendingCapture()
                if origin == .user { parent.onReadingScroll() }
                view.setContentOffset(CGPoint(x: 0, y: offset), animated: false)
                capture(); reportPagePosition()
                animatePage(from: before, direction: direction)
                return true
            }
            let windowAnchor = direction == .next ? textWindow?.nextAnchor : textWindow?.previousAnchor
            if let windowAnchor {
                if origin == .user { parent.onReadingScroll() }
                let snapshot = pageCurl.snapshot(from: view)
                pageCurl.protect(snapshot, over: view, paper: pagePaper)
                nextWindowEndsAtAnchor = direction == .previous
                let previousNavigation = parent.session.navigationID
                parent.session.go(to: parent.session.chapterIndex, anchor: windowAnchor)
                rebaseQueuedNavigation(from: previousNavigation)
                pendingPageTransition = PendingPageTransition(direction: direction, snapshot: snapshot, navigation: parent.session.navigationID,
                    owner: ObjectIdentifier(parent.session), chapterID: parent.session.chapter.id, preferences: parent.session.state.preferences,
                    size: view.bounds.size, insets: parent.pageInsets)
                updateContent(view)
                return true
            }
            let session = parent.session, chapter = session.chapterIndex + (direction == .next ? 1 : -1)
            guard session.book.chapters.indices.contains(chapter) else { return false }
            if origin == .user { parent.onReadingScroll() }
            let snapshot = pageCurl.snapshot(from: view)
            pageCurl.protect(snapshot, over: view, paper: pagePaper)
            var anchor: ReadingAnchor?
            if direction == .previous, let passage = session.book.chapters[chapter].passages.last {
                anchor = ReadingAnchor(chapterID: session.book.chapters[chapter].id, passageID: passage.id, characterOffset: max(0, passage.text.unicodeScalars.count - 1))
            }
            let previousNavigation = session.navigationID
            session.go(to: chapter, anchor: anchor)
            rebaseQueuedNavigation(from: previousNavigation)
            pendingPageTransition = PendingPageTransition(direction: direction, snapshot: snapshot, navigation: session.navigationID,
                owner: ObjectIdentifier(session), chapterID: session.chapter.id, preferences: session.state.preferences,
                size: view.bounds.size, insets: parent.pageInsets)
            updateContent(view)
            return true
        }
        func restore(_ anchor: ReadingAnchor?, translatedViewport: TranslatedViewport? = nil, persistCheckpoint: Bool = false) {
            guard !isInvalidated, let view else { return }
            restoring = true; cancelPendingCapture(); restorationGeneration += 1
            let generation = restorationGeneration, chapter = renderedChapterID, navigation = navigationID
            if pendingTransitionIsCurrent { pendingPageTransition?.restorationGeneration = generation }
            else if pendingPageTransition != nil { cancelPageTransition(.notReady) }
            let owner = indexedSessionID, chapterIndex = indexedChapterIndex
            DispatchQueue.main.async { [weak self, weak view] in
                guard let self, !self.isInvalidated, let view, self.view === view, self.restorationGeneration == generation,
                      self.indexedSessionID == owner, owner == ObjectIdentifier(self.parent.session),
                      self.indexedChapterIndex == chapterIndex, chapterIndex == self.parent.session.chapterIndex,
                      self.renderedChapterID == chapter, self.parent.session.chapter.id == chapter,
                      self.navigationID == navigation, self.parent.session.navigationID == navigation else { return }
                view.layoutManager.ensureLayout(for: view.textContainer)
                self.refreshPagination()
                let requested = self.parent.session.bookmarkNavigation
                if let requested, requested.navigationID == navigation,
                   self.parent.session.verifiedBookmarkText(anchor: requested.anchor, presentation: requested.presentation) == nil {
                    self.parent.session.rejectBookmarkNavigation(requested)
                    self.restoring = false; view.alpha = 1; return
                }
                let positionAnchor = anchor ?? translatedViewport.map { ReadingAnchor(chapterID: self.parent.session.chapter.id, passageID: $0.passageID) }
                let translatedSpan = translatedViewport.flatMap { viewport in
                    self.spans.first { span in span.isTranslation && span.passage.id == viewport.passageID
                        && NSMaxRange(span.range) <= view.attributedText.length
                        && (viewport.bookmarkPresentation.map { $0.snapshotKey == span.bookmarkPresentation?.snapshotKey } ?? ((view.attributedText.string as NSString).substring(with: span.range) == viewport.text)) }
                }
                if translatedViewport?.bookmarkPresentation != nil, translatedSpan == nil {
                    if let requested, requested.navigationID == navigation { self.parent.session.rejectBookmarkNavigation(requested) }
                    self.restoring = false; view.alpha = 1; return
                }
                if let anchor = positionAnchor, anchor.chapterID == chapter, view.attributedText.length > 0,
                   let span = translatedSpan ?? self.spans.first(where: { $0.passage.id == anchor.passageID && !$0.isTranslation }) ?? self.spans.first(where: { $0.passage.id == anchor.passageID }) {
                    let offset = span.sourceOffsets.utf16Offset(forScalarOffset: anchor.characterOffset)
                    let displayedOffset: Int
                    if let source = span.sourceRange, let markdown = self.markdown { displayedOffset = self.markdownDisplayPrefix + markdown.document.displayedUTF16Offset(forSourceUTF16Offset: source.location + offset) }
                    else if span.isTranslation {
                        // This is a temporary display offset, never an invented
                        // source-language offset or a persisted sentence alignment.
                        displayedOffset = span.range.location + (translatedSpan == nil ? 0 : min(translatedViewport?.offset ?? 0, max(0, span.range.length - 1)))
                    } else { displayedOffset = span.range.location + max(0, offset - span.sourceUTF16Start) }
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
                if requested?.navigationID == self.parent.session.navigationID { self.parent.session.completeBookmarkNavigation(navigationID: self.parent.session.navigationID) }
                view.alpha = 1
                if let pending = self.pendingPageTransition, pending.restorationGeneration == generation, self.pendingTransitionIsCurrent {
                    self.pendingPageTransition = nil
                    if self.parent.session.state.preferences.navigationMode == .paged, pending.direction == .previous {
                        view.setContentOffset(CGPoint(x: 0, y: self.pagination?.origins.last ?? -view.adjustedContentInset.top), animated: false)
                    }
                    self.capture()
                    self.animatePage(from: pending.snapshot, direction: pending.direction)
                }
                if self.restorationCover {
                    self.restorationCover = false; self.pageCurl.cancel()
                }
                self.configureNavigation(view)
                self.updateSpeech(view)
                self.reportReadingPosition(in: view)
                self.reportVisiblePage()
                if persistCheckpoint { self.schedulePersistence() }
                self.flushDeferredContentIfIdle()
            }
        }
        func paragraphCharacter(at point: CGPoint) -> Int? {
            guard let view, !restoring, view.attributedText.length > 0 else { return nil }
            let local = CGPoint(x: point.x - view.textContainerInset.left, y: point.y - view.textContainerInset.top)
            let glyph = view.layoutManager.glyphIndex(for: local, in: view.textContainer)
            guard glyph < view.layoutManager.numberOfGlyphs,
                  view.layoutManager.boundingRect(forGlyphRange: NSRange(location: glyph, length: 1), in: view.textContainer).insetBy(dx: -2, dy: -2).contains(local) else { return nil }
            let character = view.layoutManager.characterIndexForGlyph(at: glyph)
            return paragraphRange(containing: NSRange(location: character, length: 1)) == nil ? nil : character
        }
        private func paragraphRange(containing range: NSRange) -> NSRange? {
            guard let view, range.location >= 0, range.length > 0,
                  let span = spans.first(where: { $0.range.location <= range.location && NSMaxRange(range) <= NSMaxRange($0.range) }),
                  span.passage.resourcePath == nil else { return nil }
            var result = span.range
            let text = view.text as NSString
            guard NSMaxRange(result) <= text.length else { return nil }
            while result.length > 0 && [10, 13].contains(text.character(at: NSMaxRange(result) - 1)) { result.length -= 1 }
            return result.length > 0 ? result : nil
        }
        @discardableResult func selectParagraph(containing range: NSRange) -> Bool {
            guard !restoring, let view, navigationID == parent.session.navigationID,
                  indexedSessionID == ObjectIdentifier(parent.session), renderedChapterID == parent.session.chapter.id,
                  let paragraph = paragraphRange(containing: range) else { return false }
            let offset = view.contentOffset, wasRestoring = restoring
            cancelPendingCapture(); restoring = true
            UIView.performWithoutAnimation {
                view.becomeFirstResponder(); view.selectedRange = paragraph
                view.setContentOffset(offset, animated: false)
            }
            restoring = wasRestoring
            textViewDidChangeSelection(view)
            return true
        }
        func presentParagraphMenu() {
            guard let view, !restoring, navigationID == parent.session.navigationID, view.selectedRange.length > 0 else { return }
            if paragraphMenu == nil {
                paragraphMenu = ReaderParagraphEditMenu(view: view, makeMenu: { [weak self, weak view] suggested in
                    guard let self, let view else { return nil }
                    return self.textView(view, editMenuForTextIn: view.selectedRange, suggestedActions: suggested)
                }, target: { [weak view] in
                    guard let view else { return .zero }
                    let body = (view as? ReflowTextView)?.visibleReadingRect ?? view.bounds
                    let visible = view.selectedTextRange.map { view.selectionRects(for: $0).map(\.rect).map { $0.intersection(body) }.first { !$0.isNull && !$0.isEmpty } } ?? nil
                    return visible ?? CGRect(x: body.midX, y: body.minY + 1, width: 1, height: 1)
                })
            }
            paragraphMenu?.present()
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
            guard !isInvalidated else { return nil }
            let selectionGuidance = "请在同一段内选择文字，以保留准确引用。"
            func quote() -> SelectedQuote? {
                guard !isInvalidated else { return nil }
                let value = selectedQuote(in: textView, range: textView.selectedRange)
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
            if let paragraph = paragraphRange(containing: range), paragraph != range {
                actions.insert(UIAction(title: "选择整段", image: UIImage(systemName: "text.alignleft")) { [weak self, weak textView] _ in
                    guard let self, let textView else { return }; _ = self.selectParagraph(containing: textView.selectedRange)
                    self.presentParagraphMenu()
                }, at: 0)
            }
            if parent.onExplain != nil {
                actions.insert(UIAction(title: "AI 引用", image: UIImage(systemName: "text.bubble")) { [weak self] _ in
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
            if parent.onShare != nil {
                actions.append(UIAction(title: "分享摘录…", image: UIImage(systemName: "square.and.arrow.up")) { [weak self] _ in
                    guard let value = quote() else { return }; self?.parent.onShare?(value)
                })
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
    weak var readerEdgeTapHandler: ReaderEdgeTapHandler?
    weak var readerTapRecognizer: UIGestureRecognizer?
    weak var readerPageRecognizer: UIGestureRecognizer?
    weak var readerBookmarkRecognizer: UIGestureRecognizer?
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
        if gestureRecognizer === readerTapRecognizer || gestureRecognizer === readerPageRecognizer || gestureRecognizer === readerBookmarkRecognizer { return true }
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
        readerEdgeTapHandler?.refreshSelectionGestures()
        updateReadingClip()
        if changed { onSizeChange?() }
    }
}
