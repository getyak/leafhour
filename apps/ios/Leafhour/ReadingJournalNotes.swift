import SwiftUI
import LeafhourCore

struct JournalNoteDetail: View {
    let note: ReadingJournal.Note
    let openSource: () async -> String?
    @State private var busy = false
    @State private var error: String?
    @State private var sourceTask: Task<Void, Never>?
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text(note.title).font(.system(.title, design: .serif).weight(.medium))
                Text(note.attribution).font(.subheadline).foregroundStyle(Color.leafInk)
                if !note.text.isEmpty { Text(note.text).font(.system(.title3, design: .serif)).lineSpacing(9).textSelection(.enabled) }
                if !note.quote.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(note.quoteAttribution).font(.caption).foregroundStyle(.secondary)
                        Text(note.quote).font(.body).lineSpacing(7).textSelection(.enabled)
                    }.padding(.leading, 16).overlay(alignment: .leading) { Rectangle().fill(Color.secondary.opacity(0.25)).frame(width: 1) }
                }
                Button {
                    busy = true
                    sourceTask = Task { error = await openSource(); busy = false }
                } label: {
                    HStack { Label(note.isDraft ? "回到原文继续写" : "回到原文", systemImage: "arrow.up.right"); if busy { ProgressView() } }.frame(minHeight: 44)
                }.disabled(busy).accessibilityIdentifier("journal-note-source")
                if let error { Text(error).font(.subheadline).foregroundStyle(.secondary).accessibilityIdentifier("journal-source-error") }
                ShareLink(item: [note.title, note.attribution, note.text, note.quoteAttribution, note.quote].filter { !$0.isEmpty }.joined(separator: "\n\n")) { Label("导出这条笔记", systemImage: "square.and.arrow.up").frame(minHeight: 44) }
            }.padding(24).frame(maxWidth: 640, alignment: .leading).frame(maxWidth: .infinity)
        }.background(Color.shelfPaper).navigationTitle("笔记详情").navigationBarTitleDisplayMode(.inline)
            .onDisappear { sourceTask?.cancel(); sourceTask = nil; busy = false }
    }
}

struct JournalDayDetail: View {
    let date: Date
    let journal: ReadingJournalModel
    let scope: JournalScope
    let notes: [ReadingJournal.Note]
    let openNote: (ReadingJournal.Note) -> Void
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                Text(date, format: .dateTime.month(.wide).day()).font(.system(.largeTitle, design: .serif).weight(.medium))
                Text(date, format: .dateTime.weekday(.wide)).font(.subheadline).foregroundStyle(.secondary)
                Text(journal.seconds(on: date, scope: scope).map(ReadingJournal.duration) ?? "记录待读取")
                    .font(.system(.largeTitle, design: .serif)).accessibilityIdentifier("journal-day-duration")
                Divider()
                let ids = journal.bookIDs(on: date, scope: scope)
                Text("当天读过").font(.system(.title3, design: .serif).weight(.semibold))
                ForEach(ids, id: \.self) { id in
                    HStack(alignment: .firstTextBaseline, spacing: 14) {
                        Image(systemName: "book.closed").foregroundStyle(Color.leafInk)
                        Text(journal.title(id, on: date, scope: scope)).frame(maxWidth: .infinity, alignment: .leading)
                        Text(journal.seconds(on: date, scope: scope, bookID: id).map(ReadingJournal.duration) ?? "—").font(.subheadline).foregroundStyle(.secondary)
                    }.padding(.vertical, 4)
                }
                if ids.isEmpty, journal.seconds(on: date, scope: scope) != nil { Text("这一天没有记录阅读时间。").font(.subheadline).foregroundStyle(.secondary) }
                Divider()
                Text(scope == .device ? "当天更新的笔记" : "留下的想法").font(.system(.title3, design: .serif).weight(.semibold))
                let dayNotes = notes.filter { $0.date.map { journal.calendar.isDate($0, inSameDayAs: date) } ?? false }
                ForEach(dayNotes) { note in Button { openNote(note) } label: { JournalNotePreview(note: note) }.buttonStyle(JournalPressStyle()) }
                if dayNotes.isEmpty { Text("已载入的笔记中，没有这一天的记录。").font(.subheadline).foregroundStyle(.secondary) }
                if scope == .account, let count = journal.cloudDay(date)?["notes"].number, Int(count) > dayNotes.count {
                    Text("当天还有笔记未载入，可在笔记页继续读取。").font(.footnote).foregroundStyle(.secondary)
                }
            }.padding(24).frame(maxWidth: 640, alignment: .leading).frame(maxWidth: .infinity)
        }.background(Color.shelfPaper).navigationTitle("阅读日历").navigationBarTitleDisplayMode(.inline)
    }
}
