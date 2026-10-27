import SwiftUI
import UIKit
import ImageIO
import LeafhourCore

/// UIKit owns selection/copy and accessibility. Source XHTML never executes or loads remote resources.
struct TextReadingView: UIViewRepresentable {
    let session: ReaderSession
    let onNote: (SelectedQuote) -> Void
    let onSource: (SelectedQuote) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }
    func makeUIView(context: Context) -> UITextView {
        let view = UITextView(usingTextLayoutManager: false)
        view.isEditable = false; view.isSelectable = true; view.backgroundColor = .clear
        view.textContainerInset = UIEdgeInsets(top: 60, left: 24, bottom: 72, right: 24)
        view.textContainer.lineFragmentPadding = 0
        view.adjustsFontForContentSizeCategory = true; view.alwaysBounceVertical = true
        view.delegate = context.coordinator; view.accessibilityIdentifier = "leafhour-epub-reader"
        context.coordinator.view = view
        return view
    }
    func updateUIView(_ view: UITextView, context: Context) {
        let coordinator = context.coordinator
        coordinator.parent = self
        let preferences = session.state.preferences
        let width = max(240, view.bounds.width > 0 ? view.bounds.width - 48 : UIScreen.main.bounds.width - 48)
        let signature = "\(session.chapter.id)-\(preferences)-\(view.traitCollection.preferredContentSizeCategory.rawValue)-\(Int(width))"
        if coordinator.signature != signature {
            coordinator.signature = signature; coordinator.restoring = true
            let result = NSMutableAttributedString(string: "")
            coordinator.spans = []
            let base = UIFont.systemFont(ofSize: preferences.fontSize)
            let font = UIFontMetrics(forTextStyle: .body).scaledFont(for: UIFont(descriptor: base.fontDescriptor.withDesign(.serif) ?? base.fontDescriptor, size: preferences.fontSize))
            for passage in session.chapter.passages {
                let start = result.length
                let style = NSMutableParagraphStyle(); style.lineSpacing = preferences.lineSpacing; style.paragraphSpacing = 20; style.baseWritingDirection = .natural
                if let resource = passage.resourcePath {
                    let source = session.directory.appendingPathComponent("assets").appendingPathComponent(resource)
                    if let imageSource = CGImageSourceCreateWithURL(source as CFURL, nil), let cgImage = CGImageSourceCreateThumbnailAtIndex(imageSource, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: 2048] as CFDictionary) {
                        let image = UIImage(cgImage: cgImage), attachment = NSTextAttachment()
                        attachment.image = image
                        attachment.bounds = CGRect(x: 0, y: 0, width: width, height: width * image.size.height / max(1, image.size.width))
                        result.append(NSAttributedString(attachment: attachment)); result.append(NSAttributedString(string: "\n\n"))
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
            view.attributedText = result
            coordinator.restore(session.state.anchor)
        } else if coordinator.navigationID != session.navigationID {
            coordinator.restore(session.state.anchor)
        }
        coordinator.navigationID = session.navigationID
    }
    struct Span { var passage: Passage; var range: NSRange }
    @MainActor final class Coordinator: NSObject, UITextViewDelegate {
        var parent: TextReadingView
        weak var view: UITextView?
        var spans: [Span] = []
        var signature = ""
        var navigationID: UUID?
        var restoring = false
        private var delayed: DispatchWorkItem?
        private var resignObserver: NSObjectProtocol?
        init(parent: TextReadingView) {
            self.parent = parent
            super.init()
            resignObserver = NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in MainActor.assumeIsolated { self?.capture() } }
        }
        deinit { delayed?.cancel(); if let resignObserver { NotificationCenter.default.removeObserver(resignObserver) } }
        func scrollViewDidScroll(_ scrollView: UIScrollView) {
            guard !restoring else { return }
            delayed?.cancel()
            let work = DispatchWorkItem { [weak self] in self?.capture() }; delayed = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.18, execute: work)
        }
        func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) { capture() }
        func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) { if !decelerate { capture() } }
        func capture() {
            guard !restoring, let view, view.bounds.width > 0, !spans.isEmpty else { return }
            let point = CGPoint(x: 1, y: max(0, view.contentOffset.y + 50 - view.textContainerInset.top))
            let index = view.layoutManager.characterIndex(for: point, in: view.textContainer, fractionOfDistanceBetweenInsertionPoints: nil)
            let span = spans.last(where: { $0.range.location <= index }) ?? spans[0]
            let utf16Offset = min(max(0, index - span.range.location), (span.passage.text as NSString).length)
            let scalarOffset = (span.passage.text as NSString).substring(to: utf16Offset).unicodeScalars.count
            parent.session.moved(ReadingAnchor(chapterID: parent.session.chapter.id, passageID: span.passage.id, characterOffset: scalarOffset))
        }
        func restore(_ anchor: ReadingAnchor?) {
            guard let view else { return }
            restoring = true
            DispatchQueue.main.async { [weak self, weak view] in
                guard let self, let view else { return }
                view.layoutManager.ensureLayout(for: view.textContainer)
                if let anchor, let span = self.spans.first(where: { $0.passage.id == anchor.passageID }) {
                    let text = span.passage.text
                    let end = text.unicodeScalars.index(text.unicodeScalars.startIndex, offsetBy: min(anchor.characterOffset, text.unicodeScalars.count))
                    let offset = String(text.unicodeScalars[..<end]).utf16.count
                    let position = min(max(0, view.attributedText.length - 1), span.range.location + offset)
                    let glyph = view.layoutManager.glyphRange(forCharacterRange: NSRange(location: position, length: 1), actualCharacterRange: nil)
                    let rect = view.layoutManager.boundingRect(forGlyphRange: glyph, in: view.textContainer)
                    let y = max(-view.adjustedContentInset.top, rect.minY + view.textContainerInset.top - 50)
                    view.setContentOffset(CGPoint(x: 0, y: min(y, max(0, view.contentSize.height - view.bounds.height))), animated: false)
                } else { view.setContentOffset(.zero, animated: false) }
                self.restoring = false
            }
        }
        func textView(_ textView: UITextView, editMenuForTextIn range: NSRange, suggestedActions: [UIMenuElement]) -> UIMenu? {
            func quote() -> SelectedQuote? {
                guard range.length > 0, let span = spans.first(where: { $0.range.location <= range.location && range.location + range.length <= $0.range.location + ($0.passage.text as NSString).length }) else { return nil }
                let prefix = (span.passage.text as NSString).substring(to: range.location - span.range.location)
                let selected = (textView.text as NSString).substring(with: range)
                return SelectedQuote(anchor: ReadingAnchor(chapterID: parent.session.chapter.id, passageID: span.passage.id, characterOffset: prefix.unicodeScalars.count), text: selected)
            }
            let note = UIAction(title: "记笔记", image: UIImage(systemName: "square.and.pencil")) { [weak self] _ in
                guard let self else { return }
                guard let value = quote() else { self.parent.session.message = "请在同一段内选择文字，以保留准确原句引用。"; return }
                self.parent.onNote(value)
            }
            let source = UIAction(title: "核对原文", image: UIImage(systemName: "text.quote")) { [weak self] _ in if let value = quote() { self?.parent.onSource(value) } }
            return UIMenu(children: [note, source] + suggestedActions)
        }
    }
}
