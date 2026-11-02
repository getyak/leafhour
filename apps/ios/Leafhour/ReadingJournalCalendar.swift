import SwiftUI
import LeafhourCore

struct JournalCalendar: View {
    @Binding var month: Date
    let journal: ReadingJournalModel
    let scope: JournalScope
    let notes: [ReadingJournal.Note]
    let open: (Date) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var calendar: Calendar { journal.calendar }
    private var days: [Date] { ReadingJournal.monthDays(month, calendar: calendar) }
    private var offset: Int { ((days.first.map { calendar.component(.weekday, from: $0) } ?? 2) + 5) % 7 }
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack {
                Text(month, format: .dateTime.year().month(.wide)).font(.system(.title2, design: .serif).weight(.medium))
                Spacer()
                Button("上个月", systemImage: "chevron.left") { shift(-1) }.labelStyle(.iconOnly).font(.system(size: 18, weight: .medium)).frame(width: 44, height: 44).accessibilityIdentifier("journal-previous-month")
                Button("下个月", systemImage: "chevron.right") { shift(1) }.labelStyle(.iconOnly).font(.system(size: 18, weight: .medium)).frame(width: 44, height: 44)
                    .disabled(ReadingJournal.monthKey(month) >= ReadingJournal.monthKey(Date())).accessibilityIdentifier("journal-next-month")
            }
            ScrollView(.horizontal, showsIndicators: false) { LazyVGrid(columns: Array(repeating: GridItem(.fixed(44), spacing: 2), count: 7), spacing: 8) {
                ForEach(Array(["一", "二", "三", "四", "五", "六", "日"].enumerated()), id: \.offset) { _, name in Text(name).font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity).accessibilityHidden(true) }
                ForEach(0..<offset, id: \.self) { _ in Color.clear.frame(height: 48).accessibilityHidden(true) }
                ForEach(days, id: \.self) { date in day(date) }
            }}
            Text("颜色越深，记录的阅读时间越长。小点表示当天有笔记。").font(.footnote).foregroundStyle(.secondary)
        }.padding(.top, 24)
    }
    private func day(_ date: Date) -> some View {
        let seconds = journal.seconds(on: date, scope: scope)
        let hasNotes = notes.contains { $0.date.map { calendar.isDate($0, inSameDayAs: date) } ?? false }
        let future = calendar.startOfDay(for: date) > calendar.startOfDay(for: Date())
        return Button { open(date) } label: {
            VStack(spacing: 6) {
                Text(String(calendar.component(.day, from: date))).font(.subheadline).foregroundStyle(.primary).lineLimit(1).minimumScaleFactor(0.7)
                Circle().fill(hasNotes ? Color.leafInk : .clear).frame(width: 3, height: 3)
            }.frame(maxWidth: .infinity, minHeight: 48)
                .background(Color.leafFill.opacity((seconds ?? 0) > 0 ? min(0.34, 0.08 + Double(seconds ?? 0) / 10800) : 0.025), in: RoundedRectangle(cornerRadius: 5))
                .overlay { RoundedRectangle(cornerRadius: 5).strokeBorder(calendar.isDateInToday(date) ? Color.leafInk : .clear, lineWidth: 1) }
                .opacity(future ? 0.4 : 1)
        }.buttonStyle(JournalPressStyle()).disabled(future)
            .accessibilityLabel(date.formatted(date: .complete, time: .omitted) + "，" + (seconds.map(ReadingJournal.duration) ?? "记录待读取") + (hasNotes ? "，有笔记" : ""))
            .accessibilityIdentifier("journal-day-" + ReadingJournal.dayKey(date, calendar: calendar))
    }
    private func shift(_ value: Int) {
        guard let next = calendar.date(byAdding: .month, value: value, to: month) else { return }
        withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.22)) { month = next }
    }
}
