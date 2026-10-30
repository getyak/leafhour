import SwiftUI
import LeafhourCore

struct ReaderThemeChoices: View {
    @Bindable var session: ReaderSession
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    private let choices = [("paper", "清纸"), ("night", "夜读"), ("system", "系统")]
    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) { ForEach(choices, id: \.0) { choice in tile(choice.0, title: choice.1) } }
            VStack(spacing: 12) { ForEach(choices, id: \.0) { choice in tile(choice.0, title: choice.1) } }
        }
    }
    private func tile(_ value: String, title: String) -> some View {
        let selected = session.state.preferences.theme == value
        let paper: Color = value == "paper" ? .readingPaper : value == "night" ? Color(white: 0.12) : Color(uiColor: .systemBackground)
        let ink: Color = value == "night" ? Color(white: 0.92) : value == "paper" ? Color(white: 0.2) : .primary
        return Button {
            var preferences = session.state.preferences; preferences.theme = value; session.changePreferences(preferences)
        } label: {
            VStack(spacing: 10) {
                Text("Aa").font(.system(.title2, design: .serif)).foregroundStyle(ink).padding(.top, 4)
                HStack(spacing: 5) {
                    Text(title).font(.subheadline).foregroundStyle(ink)
                    if selected { Image(systemName: "checkmark").font(.caption.weight(.semibold)).foregroundStyle(ink) }
                }
            }
            .frame(maxWidth: .infinity, minHeight: 86).padding(.horizontal, 8).padding(.vertical, 8)
            .background(paper, in: RoundedRectangle(cornerRadius: 14))
            .overlay { RoundedRectangle(cornerRadius: 14).strokeBorder(selected ? Color.leafInk : Color.primary.opacity(0.1), lineWidth: selected ? 2 : 1) }
            .contentShape(RoundedRectangle(cornerRadius: 14))
        }
        .buttonStyle(.plain).accessibilityLabel(title == "系统" ? "跟随系统" : title)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
