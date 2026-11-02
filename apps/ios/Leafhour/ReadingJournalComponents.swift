import SwiftUI
import LeafhourCore

enum JournalSection: String, CaseIterable, Identifiable {
    case overview = "概览", calendar = "日历", notes = "笔记"
    var id: Self { self }
}

struct JournalPressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.opacity(configuration.isPressed ? 0.78 : 1)
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.97 : 1)
            .animation(reduceMotion ? nil : .spring(response: 0.26, dampingFraction: 0.78), value: configuration.isPressed)
    }
}

struct JournalSectionPicker: View {
    @Binding var selection: JournalSection
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var underline
    var body: some View {
        HStack(spacing: 0) {
            ForEach(JournalSection.allCases) { section in
                Button {
                    withAnimation(reduceMotion ? nil : .spring(response: 0.32, dampingFraction: 0.86)) { selection = section }
                } label: {
                    VStack(spacing: 11) {
                        Text(section.rawValue).font(.body.weight(selection == section ? .semibold : .regular))
                            .foregroundStyle(selection == section ? Color.leafInk : .secondary)
                        ZStack {
                            Color.clear.frame(height: 2)
                            if selection == section { Rectangle().fill(Color.leafInk).frame(height: 2).matchedGeometryEffect(id: "underline", in: underline) }
                        }
                    }.frame(maxWidth: .infinity).padding(.top, 10).contentShape(Rectangle())
                }.buttonStyle(.plain)
                    .accessibilityAddTraits(selection == section ? .isSelected : [])
                    .accessibilityIdentifier("journal-section-" + String(describing: section))
            }
        }.overlay(alignment: .bottom) { Divider().offset(y: 1) }
            .sensoryFeedback(.selection, trigger: selection)
    }
}

struct JournalSpines: View {
    let dates: [Date]
    let values: [Int?]
    let open: (Date) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var textSize
    @State private var appeared = false
    private let colors: [Color] = [.leafFill, Color(red: 0.48, green: 0.48, blue: 0.34), Color(red: 0.48, green: 0.34, blue: 0.28)]
    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) { HStack(alignment: .bottom, spacing: 2) {
            ForEach(Array(dates.enumerated()), id: \.element) { index, date in
                spine(index, date)
            }
        }}.padding(.top, 14)
            .onAppear { appeared = true }
    }
    private func spine(_ index: Int, _ date: Date) -> some View {
        let seconds = values.indices.contains(index) ? values[index] : nil
        let maximum = max(1, values.compactMap { $0 }.max() ?? 1)
        let height = seconds.map { $0 > 0 ? 30 + 90 * Double($0) / Double(maximum) : 2 } ?? 2
        return Button { open(date) } label: {
            VStack(spacing: 10) {
                ZStack(alignment: .bottom) {
                    Color.clear.frame(height: 144)
                    VStack(spacing: 7) {
                        if !textSize.isAccessibilitySize {
                            Text(seconds.map { $0 == 0 ? "—" : $0 < 60 ? "<1分" : "\($0 / 60)分" } ?? "待读取")
                                .font(.caption2).monospacedDigit().foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.7)
                        }
                        RoundedRectangle(cornerRadius: seconds == 0 ? 1 : 4)
                            .fill(colors[index % colors.count].gradient)
                            .overlay(alignment: .leading) { Rectangle().fill(.white.opacity(0.16)).frame(width: 1).padding(.leading, 4).padding(.vertical, 3) }
                            .overlay { if (seconds ?? 0) > 0 { VStack { Rectangle().frame(height: 1); Spacer(); Rectangle().frame(height: 1) }.foregroundStyle(.white.opacity(0.28)).padding(.vertical, 12).padding(.horizontal, 4) } }
                            .frame(width: 29, height: height)
                            .scaleEffect(x: 1, y: appeared || reduceMotion ? 1 : 0.04, anchor: .bottom)
                            .animation(reduceMotion ? nil : .spring(response: 0.42, dampingFraction: 0.85).delay(Double(index) * 0.025), value: appeared)
                    }
                }
                VStack(spacing: 5) {
                    Text(String(Calendar.current.component(.day, from: date))).font(.caption).lineLimit(1).minimumScaleFactor(0.7)
                    Text(date, format: .dateTime.weekday(.narrow)).font(.caption2).foregroundStyle(.secondary)
                    Circle().fill(Calendar.current.isDateInToday(date) ? Color.leafInk : .clear).frame(width: 4, height: 4)
                }
            }.frame(minWidth: 44, maxWidth: .infinity).contentShape(Rectangle())
        }.buttonStyle(JournalPressStyle())
            .contextMenu { Button("查看这一天", systemImage: "calendar") { open(date) }; Text(seconds.map(ReadingJournal.duration) ?? "记录待读取") }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(date.formatted(date: .complete, time: .omitted) + "，" + (seconds.map(ReadingJournal.duration) ?? "记录待读取"))
            .accessibilityHint("查看当天读过的书和笔记")
            .accessibilityIdentifier("journal-spine-" + ReadingJournal.dayKey(date))
    }
}

struct JournalNotePreview: View {
    let note: ReadingJournal.Note
    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack(alignment: .firstTextBaseline) {
                Text(note.title).lineLimit(2)
                Spacer(minLength: 8)
                Text(note.isDraft ? "草稿" : note.attribution).foregroundStyle(Color.leafInk)
            }.font(.caption).foregroundStyle(.secondary)
            Text(note.text.isEmpty ? note.quote : note.text)
                .font(.system(.body, design: .serif)).lineSpacing(7).lineLimit(4)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.leading, 14).overlay(alignment: .leading) { Rectangle().fill(Color.leafInk.opacity(0.65)).frame(width: 2) }
            if let date = note.date { Text(date, format: .dateTime.month().day()).font(.caption2).foregroundStyle(.secondary) }
        }.padding(.vertical, 15).contentShape(Rectangle())
    }
}
