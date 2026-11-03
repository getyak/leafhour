import SwiftUI

/// Reading and listening share chapter navigation; page turns remain gestures.
struct ReaderReadingTransport: View {
    let canPreviousChapter: Bool
    let canNextChapter: Bool
    let onPreviousChapter: () -> Void
    let onNextChapter: () -> Void
    let onTranslatePage: () -> Void
    var body: some View {
        HStack(spacing: 2) {
            action("上一章", symbol: "backward.end", id: "reader-previous-chapter", enabled: canPreviousChapter, run: onPreviousChapter)
            Button(action: onTranslatePage) {
                VStack(spacing: 3) { Image(systemName: "character.book.closed").font(.system(size: 18)); Text("本页翻译").font(.caption2) }
                    .frame(minWidth: 44, maxWidth: .infinity, minHeight: 44).padding(.vertical, 2).contentShape(Rectangle())
            }.buttonStyle(.plain).accessibilityLabel("当前页翻译").accessibilityIdentifier("reader-page-translation")
            action("下一章", symbol: "forward.end", id: "reader-next-chapter", enabled: canNextChapter, run: onNextChapter)
        }.padding(.horizontal, 6).foregroundStyle(.primary)
    }
    private func action(_ title: String, symbol: String, id: String, enabled: Bool, run: @escaping () -> Void) -> some View {
        Button(action: run) { Image(systemName: symbol).font(.system(size: 18)).frame(minWidth: 44, maxWidth: .infinity, minHeight: 44).contentShape(Rectangle()) }
            .buttonStyle(.plain).disabled(!enabled).accessibilityLabel(title).accessibilityIdentifier(id)
    }
}
