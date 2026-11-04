import SwiftUI
import LeafhourCore

private enum JournalRoute: Hashable { case day(Date), note(String) }

struct MyReadingScreen: View {
    @Bindable var model: LibraryModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.rootNavigationDepthChanged) private var rootNavigationDepthChanged
    @Environment(\.dynamicTypeSize) private var textSize
    @State private var journal = ReadingJournalModel()
    @State private var section: JournalSection = .overview
    @State private var scope: JournalScope = .account
    @State private var month = Date()
    @State private var query = ""
    @State private var kind = "all"
    @State private var settings = false
    @State private var path: [JournalRoute] = []
    @State private var openedNotes: [String: ReadingJournal.Note] = [:]
    @FocusState private var searchFocused: Bool
    private var effectiveScope: JournalScope { model.account == nil ? .device : scope }
    private var notes: [ReadingJournal.Note] { journal.notes(model, scope: effectiveScope) }
    private var requestKey: String { effectiveScope.rawValue + ReadingJournal.monthKey(month) + (section == .overview ? "recent" : "month") }
    private var days: [Date] { ReadingJournal.lastSevenDays(ending: Date(), calendar: journal.calendar) }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text("读过的日子，留下的想法。").font(.system(.subheadline, design: .serif)).foregroundStyle(.secondary).padding(.bottom, 16)
                    if model.account != nil {
                        Menu {
                            Picker("记录范围", selection: $scope) { ForEach(JournalScope.allCases) { Text($0.title).tag($0) } }
                        } label: { HStack(spacing: 6) { Text(effectiveScope.title); Image(systemName: "chevron.down").font(.caption2) }.font(.subheadline).frame(minHeight: 44) }
                            .accessibilityIdentifier("journal-scope")
                    }
                    JournalSectionPicker(selection: $section)
                    if section == .overview { overview }
                    else if section == .calendar { JournalCalendar(month: $month, journal: journal, scope: effectiveScope, notes: notes) { path.append(.day($0)) } }
                    else { notebook }
                    AccountRecordsStatus(state: journal.state, title: "阅读记录") { Task { await refresh(explicit: true) } }.padding(.top, 20)
                    if effectiveScope == .account {
                        AccountRecordsStatus(state: model.notebookState, title: "笔记") { Task { await model.loadNotebookRecords(refresh: true) } }.padding(.top, 12)
                    }
                }.padding(.horizontal, 24).padding(.bottom, 32).frame(maxWidth: 640, alignment: .leading).frame(maxWidth: .infinity)
            }.accessibilityIdentifier("journal-history").scrollDismissesKeyboard(.interactively).scrollBounceBehavior(.always, axes: .vertical).background(Color.shelfPaper)
                .navigationTitle("我的阅读").navigationBarTitleDisplayMode(.large)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("账号与设置", systemImage: "person.crop.circle") { settings = true }.labelStyle(.iconOnly)
                            .frame(minWidth: 44, minHeight: 44).accessibilityIdentifier("journal-settings")
                    }
                }
                .navigationDestination(for: JournalRoute.self) { route in
                    switch route {
                    case .day(let date): JournalDayDetail(date: date, journal: journal, scope: effectiveScope, notes: notes, openNote: showNote)
                    case .note(let id):
                        if let note = openedNotes[id] { JournalNoteDetail(note: note) { await openSource(note) } }
                        else { ContentUnavailableView("笔记暂不可用", systemImage: "text.book.closed") }
                    }
                }
                .sheet(isPresented: $settings) { AppSettingsScreen(model: model, presented: true) }
                .task(id: requestKey) { await refresh() }
                .task(id: model.importAccountContext) { await model.loadNotebookRecords() }
                .onChange(of: model.readingJournalRevision) { _, _ in Task { await refresh() } }
                .onAppear { rootNavigationDepthChanged(!path.isEmpty) }
                .onChange(of: path.isEmpty) { _, empty in rootNavigationDepthChanged(!empty) }
                .refreshable { await refresh(explicit: true) }
                .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await refresh() } } }
                .sensoryFeedback(.selection, trigger: path)
        }.accessibilityIdentifier("my-reading-screen")
    }
    private var overview: some View {
        VStack(alignment: .leading, spacing: 22) {
            VStack(alignment: .leading, spacing: 10) {
                Text("最近七天").font(.subheadline).foregroundStyle(.secondary)
                let values = days.map { journal.seconds(on: $0, scope: effectiveScope) }
                Text(values.allSatisfy { $0 != nil } ? ReadingJournal.duration(values.compactMap { $0 }.reduce(0, +)) : "—")
                    .font(.system(textSize.isAccessibilitySize ? .largeTitle : .largeTitle, design: .serif)).fontWeight(.medium)
                    .contentTransition(.numericText()).accessibilityIdentifier("journal-week-duration")
                if values.allSatisfy({ $0 != nil }) {
                    Text("阅读 \(values.compactMap { $0 }.filter { $0 > 0 }.count) 天")
                        .font(.subheadline).foregroundStyle(.secondary)
                }
                JournalSpines(dates: days, values: values) { path.append(.day($0)) }
            }.padding(.top, 28)
            Divider()
            HStack {
                Text("最近的想法").font(.system(.title3, design: .serif).weight(.semibold))
                Spacer()
                Button("全部笔记 →") { withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) { section = .notes } }.font(.subheadline).frame(minHeight: 44)
            }
            ForEach(Array(notes.prefix(3))) { note in Button { showNote(note) } label: { JournalNotePreview(note: note) }.buttonStyle(JournalPressStyle()) }
            if notes.isEmpty, notesReady {
                Text("读到值得留下的地方，可以写下一点想法。").font(.body).foregroundStyle(.secondary).padding(.vertical, 12)
            }
            if effectiveScope == .account, model.notebookCursor != nil { Text("这里只展示已载入的笔记。").font(.footnote).foregroundStyle(.secondary) }
        }
    }
    private var notebook: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("搜索书名、笔记与摘录", text: $query).focused($searchFocused).submitLabel(.search).onSubmit { searchFocused = false }.textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityIdentifier("journal-note-search")
                if !query.isEmpty { Button("清除", systemImage: "xmark.circle.fill") { query = "" }.labelStyle(.iconOnly).frame(width: 44, height: 44) }
            }.padding(.horizontal, 12).frame(minHeight: 48).background(.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 8))
            HStack {
                Picker("笔记类型", selection: $kind) { Text("全部类型").tag("all"); Text("笔记").tag("note"); Text("提问").tag("question"); Text("摘录").tag("highlight"); Text("草稿").tag("draft") }.pickerStyle(.menu)
                Spacer()
                if effectiveScope == .account { NavigationLink("阅读摘要") { SavedReadingSummariesScreen(model: model) }.font(.subheadline) }
            }
            let filtered = notes.filter { $0.matches(query) && (kind == "all" || $0.kind == kind) }
            ForEach(filtered) { note in
                Button { showNote(note) } label: { JournalNotePreview(note: note) }.buttonStyle(JournalPressStyle()).accessibilityIdentifier("journal-note-" + note.id)
                Divider()
            }
            if filtered.isEmpty, notesReady {
                ContentUnavailableView(query.isEmpty ? "还没有这类笔记" : "已载入的笔记中没有匹配内容", systemImage: "text.book.closed", description: Text("书里的想法、提问与摘录会留在这里。"))
            }
            if effectiveScope == .account, model.notebookCursor != nil {
                Button("载入更多笔记") { Task { await model.loadNotebookRecords(more: true) } }.frame(minHeight: 44).disabled(model.notebookState.isLoading).accessibilityIdentifier("journal-more-notes")
                Text("搜索范围是已载入的笔记。").font(.footnote).foregroundStyle(.secondary)
            }
        }.padding(.top, 24)
    }
    private var notesReady: Bool { effectiveScope == .device ? journal.hasCompleteDeviceNotes : model.notebookState.hasSnapshot }
    private func refresh(explicit: Bool = false) async {
        // Notebook pagination and latency never hold back the seven-day measurements.
        if explicit {
            async let notes: Void = model.loadNotebookRecords(refresh: true)
            await journal.load(model, scope: effectiveScope, month: month, recent: section == .overview, refresh: true)
            _ = await notes
        } else {
            await journal.load(model, scope: effectiveScope, month: month, recent: section == .overview)
        }
    }
    private func showNote(_ note: ReadingJournal.Note) { openedNotes[note.id] = note; path.append(.note(note.id)) }
    private func openSource(_ note: ReadingJournal.Note) async -> String? {
        let marker = model.importAccountContext, sourceScope = effectiveScope
        func current() -> Bool { marker == model.importAccountContext && sourceScope == effectiveScope && path.last == .note(note.id) && !Task.isCancelled }
        guard let version = note.contentVersion, let passage = note.passageID else { return "这条记录尚未保存可核对的原文位置。" }
        var book = model.books.first { sourceScope == .device ? $0.id == note.bookID : $0.cloud?.bookID == note.bookID && $0.cloud?.contentVersion == version }
        if book == nil, sourceScope == .account {
            let catalog = model.cloudBooks + (model.accountShelf?.archivedBooks ?? [])
            guard let remote = catalog.first(where: { $0.id == note.bookID && $0.contentVersion == version }) else { return "原文版本暂不可用，笔记仍保留在这里。" }
            await model.download(remote, openAfter: false)
            guard current() else { return "阅读位置已切换，请重新打开这条笔记。" }
            book = model.books.first { $0.cloud?.bookID == note.bookID && $0.cloud?.contentVersion == version }
        }
        guard let book, (sourceScope == .device ? book.sourceVersion : book.cloud?.contentVersion) == version,
              let index = book.chapters.firstIndex(where: { chapter in chapter.passages.contains { $0.id == passage } && (note.anchor == nil || chapter.id == note.anchor?.chapterID) }) else { return "原文位置暂时无法核对，笔记与草稿都已保留。" }
        guard current() else { return "书房已切换，请重新打开。" }
        await model.open(book)
        guard marker == model.importAccountContext, let session = model.reader, session.book.id == book.id else { return "暂时无法打开原文，请稍后重试。" }
        session.go(to: index, anchor: note.anchor ?? ReadingAnchor(chapterID: book.chapters[index].id, passageID: passage))
        return nil
    }
}
