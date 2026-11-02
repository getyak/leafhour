import SwiftUI
import LeafhourCore

/// Reads the existing account protocol; cloud and device totals can overlap.
struct ReaderBookTimePanel: View {
    @Bindable var session: ReaderSession
    let library: OfflineLibrary?
    let cloud: CloudLibraryClient?
    @State private var day = Date()
    @State private var local: [ReadingJournal.Interval]?
    @State private var month: CloudJSON?
    @State private var localError: String?
    @State private var cloudError: String?
    @State private var loading = false
    @State private var loadID = UUID()
    private var calendar: Calendar { var c = Calendar(identifier: .gregorian); c.timeZone = .current; return c }
    private var monthKey: String { ReadingJournal.monthKey(day, calendar: calendar) }
    private var cloudSeconds: Int? {
        guard let month, let row = month["days"].array.first(where: { $0["date"].string == ReadingJournal.dayKey(day, calendar: calendar) }) else { return nil }
        let book = row["books"].array.first { $0["bookId"].string == session.book.cloud?.bookID }
        return Int(book?["durationSeconds"].number ?? 0)
    }
    var body: some View {
        Form {
            Section {
                Text(session.book.title).font(.headline)
            }
            ReaderTimeControls(session: session)
            Section("按日期查看这本书") {
                DatePicker("阅读日期", selection: $day, in: ...Date(), displayedComponents: .date)
                if loading { ProgressView("正在核对阅读时段…") }
                if let local {
                    LabeledContent("此设备", value: ReadingJournal.duration(ReadingJournal.seconds(local, on: day, calendar: calendar)))
                }
                if let localError { Text(localError).font(.footnote).foregroundStyle(.secondary) }
                if session.book.cloud != nil {
                    if let cloudSeconds { LabeledContent("账号书房 · 已同步", value: ReadingJournal.duration(cloudSeconds)) }
                    if let cloudError { Text(cloudError).font(.footnote).foregroundStyle(.secondary) }
                }
                Text("此设备与账号书房可能包含同一时段，分别显示，不相加。日期按当前时区 \(calendar.timeZone.identifier) 划分。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            if let local {
                Section("最近七天 · 此设备") {
                    ForEach(ReadingJournal.lastSevenDays(ending: Date(), calendar: calendar).reversed(), id: \.self) { date in
                        LabeledContent {
                            Text(ReadingJournal.duration(ReadingJournal.seconds(local, on: date, calendar: calendar))).monospacedDigit()
                        } label: { Text(date, format: .dateTime.month().day().weekday()) }
                    }
                }
            }
            Section {
                Text("前台估计会在两分钟没有操作后暂停；专注计时允许停留思考。听书、聊天、工具页和后台不计入阅读。过去没有记录的时长不会补算。")
                    .font(.footnote).foregroundStyle(.secondary)
                Button("重新读取", systemImage: "arrow.clockwise") { Task { await load() } }.disabled(loading)
            }
        }.navigationTitle("阅读时间").accessibilityElement(children: .contain).accessibilityIdentifier("reader-book-time")
            .task(id: monthKey) { await load() }
    }
    private func load() async {
        let key = monthKey, calendar = calendar, marker = UUID()
        loadID = marker
        loading = true; month = nil; localError = nil; cloudError = nil
        defer { if loadID == marker { loading = false } }
        if await session.flushReadingTime(), let library {
            do {
                let rows = try await library.readingTimeLedger(bookID: session.book.id).snapshots
                guard !Task.isCancelled, loadID == marker else { return }
                local = rows.flatMap { row in row.segments.map { ReadingJournal.Interval(bookID: row.bookId, start: $0.startedAt, end: $0.endedAt) } }
            } catch { localError = "此设备的时段暂未读取，请重试。" }
        } else { localError = session.readingTimeError ?? "此设备的阅读时段尚未保存，请重试。" }
        guard let identity = session.book.cloud, let cloud else { return }
        do {
            guard await cloud.activeAccount()?.id == identity.ownerID else { throw LibraryError.invalid("请登录这本书所属的账号。") }
            let data = try await cloud.data(path: "/api/library/reading-summary?month=" + key + "&timeZone=" + CloudJSON.component(calendar.timeZone.identifier), ownerID: identity.ownerID)
            let result = try CloudJSON.decode(data)
            try ReadingJournal.validateMonth(result, month: key, calendar: calendar)
            guard !Task.isCancelled, key == monthKey, loadID == marker, await cloud.activeAccount()?.id == identity.ownerID else { return }
            month = result
        } catch { if !Task.isCancelled, loadID == marker { cloudError = "账号书房的时段暂未读取；此设备记录仍保留。" } }
    }
}

struct ReaderTimeCapsule: View {
    @Bindable var session: ReaderSession
    let paper: Color
    let onOpen: () -> Void
    @Environment(\.dynamicTypeSize) private var typeSize
    private var time: String {
        let seconds = session.readingTimeDurationSeconds
        return String(format: "%02d:%02d", seconds / 60, seconds % 60)
    }
    private var label: String {
        if session.readingTimeError != nil { return "待保存" }
        if session.readingTimePhase == .idle { return "阅读时间" }
        if session.readingTimePhase == .finished { return "已记录" }
        if session.readingTimePhase == .paused { return "已暂停" }
        return session.readingTimeSource == .estimate ? "前台估计" : "专注"
    }
    var body: some View {
        Button(action: onOpen) {
            HStack(spacing: 6) {
                Image(systemName: session.readingTimePhase == .active ? "timer" : "pause.circle")
                Text(time).monospacedDigit()
                if !typeSize.isAccessibilitySize { Text(label) }
            }.font(.caption2).padding(.horizontal, 10).padding(.vertical, 6)
                .modifier(ReaderGlassSurface(paper: paper))
                .frame(minHeight: 44).contentShape(Capsule())
        }.buttonStyle(.plain).accessibilityIdentifier("reader-time-capsule")
            .accessibilityLabel("阅读时间，\(label)，本次 \(time)，查看按书与日期统计")
    }
}
