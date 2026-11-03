import SwiftUI
import UIKit
import LeafhourCore

/// Native hold/selection and an independent short contact for sentence seeking.
/// Word paint changes color only: it never replaces text or clears a selection.
struct ReaderListeningText: UIViewRepresentable {
    let text: String
    let preferences: ReaderPreferences
    var wordRange: NSRange? = nil
    var active = false
    var sentenceRange: NSRange? = nil
    var follows = false
    var followRevision: UUID? = nil
    var secondary = false
    var onSeek: ((Int) -> Void)? = nil
    var onSelection: (Bool) -> Void = { _ in }
    @Environment(\.dynamicTypeSize) private var typeSize
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.isEditable = false; view.isSelectable = true; view.isScrollEnabled = false
        view.backgroundColor = .clear; view.textContainerInset = .zero; view.textContainer.lineFragmentPadding = 0
        view.adjustsFontForContentSizeCategory = true
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.delegate = context.coordinator
        context.coordinator.install(view)
        return view
    }
    func updateUIView(_ view: UITextView, context: Context) {
        context.coordinator.parent = self
        context.coordinator.update(view, category: ReaderTypography.category(for: typeSize))
    }
    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        guard let width = proposal.width, width > 0 else { return nil }
        context.coordinator.parent = self
        context.coordinator.update(uiView, category: ReaderTypography.category(for: typeSize))
        return context.coordinator.size(uiView, width: width)
    }
    static func dismantleUIView(_ view: UITextView, coordinator: Coordinator) {
        if view.selectedRange.length > 0 { coordinator.parent.onSelection(false) }
        coordinator.invalidate(); view.delegate = nil
    }
    @MainActor final class Coordinator: NSObject, UITextViewDelegate, UIGestureRecognizerDelegate {
        var parent: ReaderListeningText
        private weak var view: UITextView?
        private var tap: ReaderShortTapGestureRecognizer?
        private var selectedAtStart = false
        private var disabled: [UITapGestureRecognizer] = []
        private var text = "", preferences: ReaderPreferences?, category: UIContentSizeCategory?
        private var measuredWidth: CGFloat?, measured: CGSize?
        private var paintedRange: NSRange?
        private var updating = false
        private var followedRange: NSRange?
        private var followedRevision: UUID?
        init(_ parent: ReaderListeningText) { self.parent = parent }
        func install(_ view: UITextView) {
            self.view = view
            let tap = ReaderShortTapGestureRecognizer(target: self, action: #selector(seek(_:)))
            tap.cancelsTouchesInView = false; tap.delegate = self; view.addGestureRecognizer(tap); self.tap = tap
        }
        func invalidate() { disabled.forEach { $0.isEnabled = true }; if let tap { view?.removeGestureRecognizer(tap) }; tap = nil }
        func update(_ view: UITextView, category: UIContentSizeCategory) {
            updating = true
            defer { updating = false }
            if text != parent.text || preferences != parent.preferences || self.category != category {
                let textChanged = text != parent.text
                text = parent.text; preferences = parent.preferences; self.category = category; measured = nil
                let font = ReaderTypography.font(style: parent.preferences.fontStyle, size: parent.preferences.fontSize * (parent.secondary ? 0.84 : 1),
                    traits: UITraitCollection(preferredContentSizeCategory: category), latin: parent.preferences.latinFont)
                let paragraph = NSMutableParagraphStyle(); paragraph.lineSpacing = parent.preferences.lineSpacing
                let selection = view.selectedRange
                view.attributedText = NSAttributedString(string: text, attributes: [.font: font, .paragraphStyle: paragraph])
                if !textChanged, selection.length > 0, NSMaxRange(selection) <= view.attributedText.length { view.selectedRange = selection }
                else if selection.length > 0 {
                    DispatchQueue.main.async { [weak self] in self?.parent.onSelection(false) }
                }
            }
            let full = NSRange(location: 0, length: view.textStorage.length)
            view.textStorage.beginEditing()
            view.textStorage.addAttribute(.foregroundColor, value: UIColor.secondaryLabel, range: full)
            if let sentence = parent.sentenceRange, sentence.location >= 0, NSMaxRange(sentence) <= full.length {
                view.textStorage.addAttribute(.foregroundColor, value: UIColor.label, range: sentence)
            }
            if let paintedRange, NSMaxRange(paintedRange) <= full.length { view.textStorage.removeAttribute(.backgroundColor, range: paintedRange) }
            paintedRange = nil
            if let range = parent.wordRange, range.length > 0, range.location >= 0, NSMaxRange(range) <= full.length, Range(range, in: text) != nil {
                view.textStorage.addAttribute(.foregroundColor, value: UIColor(Color.leafInk), range: range)
                paintedRange = range
            }
            view.textStorage.endEditing()
            view.accessibilityIdentifier = parent.secondary ? "reader-listening-comparison" : parent.active ? "reader-listening-active-sentence" : "reader-listening-sentence"
            view.accessibilityCustomActions = parent.onSeek == nil ? [] : [UIAccessibilityCustomAction(name: "从这句朗读", actionHandler: { [weak self] _ in self?.parent.onSeek?(0); return true })]
            refreshGestures(view)
            if followedRevision != parent.followRevision { followedRange = nil; followedRevision = parent.followRevision }
            if !parent.follows { followedRange = nil }
            else if let sentence = parent.sentenceRange, sentence != followedRange {
                followedRange = sentence
                DispatchQueue.main.async { [weak self, weak view] in
                    guard let self, let view, self.parent.follows, view.selectedRange.length == 0, !UIAccessibility.isVoiceOverRunning,
                          self.parent.sentenceRange == sentence else { return }
                    self.follow(sentence, in: view)
                }
            }
        }
        private func follow(_ range: NSRange, in view: UITextView) {
            var ancestor = view.superview
            while let node = ancestor, !(node is UIScrollView) { ancestor = node.superview }
            guard let scroll = ancestor as? UIScrollView, !scroll.isDragging, !scroll.isDecelerating else { return }
            view.layoutManager.ensureLayout(for: view.textContainer)
            let glyphs = view.layoutManager.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
            let rect = view.layoutManager.boundingRect(forGlyphRange: glyphs, in: view.textContainer)
            let target = view.convert(rect, to: scroll)
            let maximum = max(-scroll.adjustedContentInset.top, scroll.contentSize.height - scroll.bounds.height + scroll.adjustedContentInset.bottom)
            let y = min(maximum, max(-scroll.adjustedContentInset.top, target.minY - scroll.bounds.height * 0.32))
            scroll.setContentOffset(CGPoint(x: scroll.contentOffset.x, y: y), animated: !UIAccessibility.isReduceMotionEnabled)
        }
        private func refreshGestures(_ view: UITextView) {
            if UIAccessibility.isVoiceOverRunning { disabled.forEach { $0.isEnabled = true }; disabled = []; return }
            // UIKit can install text gestures lazily after the first layout.
            let gestures = (view.gestureRecognizers ?? []) + view.interactions.compactMap { $0 as? UITextInteraction }.flatMap(\.gesturesForFailureRequirements)
            for gesture in gestures.compactMap({ $0 as? UITapGestureRecognizer }) where gesture.numberOfTapsRequired > 1 && gesture.isEnabled {
                disabled.append(gesture); gesture.isEnabled = false
            }
        }
        func size(_ view: UITextView, width: CGFloat) -> CGSize {
            if measuredWidth == width, let measured { return measured }
            measuredWidth = width; let size = view.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)); measured = size; return size
        }
        func textViewDidChangeSelection(_ textView: UITextView) {
            guard !updating else { return }
            parent.onSelection(textView.selectedRange.length > 0)
        }
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            selectedAtStart = (view?.selectedRange.length ?? 0) > 0
            return !UIAccessibility.isVoiceOverRunning && parent.onSeek != nil && !selectedAtStart && touch.type == .direct
        }
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool { true }
        @objc private func seek(_ tap: ReaderShortTapGestureRecognizer) {
            guard tap.state == .ended, tap.isShortTap, !selectedAtStart, view?.selectedRange.length == 0 else { return }
            guard let view else { return }
            let point = tap.location(in: view)
            let glyph = view.layoutManager.glyphIndex(for: point, in: view.textContainer)
            guard glyph < view.layoutManager.numberOfGlyphs else { return }
            let rect = view.layoutManager.boundingRect(forGlyphRange: NSRange(location: glyph, length: 1), in: view.textContainer)
            guard rect.insetBy(dx: -4, dy: -4).contains(point) else { return }
            parent.onSeek?(view.layoutManager.characterIndexForGlyph(at: glyph))
        }
    }
}
