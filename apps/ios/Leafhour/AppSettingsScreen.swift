import SwiftUI
import LeafhourCore

struct AppSettingsScreen: View {
    @Bindable var model: LibraryModel
    var presented = false
    @Environment(\.dismiss) private var dismiss
    @State private var account = false
    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button { account = true } label: {
                        HStack(spacing: 14) {
                            Image(systemName: "person.crop.circle").font(.largeTitle).foregroundStyle(Color.leafInk)
                            VStack(alignment: .leading, spacing: 5) {
                                Text(model.account == nil ? "登录自己的书房" : "我的书房账号").font(.headline).foregroundStyle(.primary)
                                Text(model.account?.email ?? "同步书籍、笔记与阅读位置").font(.subheadline).foregroundStyle(.secondary)
                            }
                            Spacer(minLength: 0)
                            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                        }.padding(.vertical, 8)
                    }.accessibilityIdentifier("settings-account")
                }
                Section("阅读") {
                    NavigationLink {
                        GlobalReadingStyleScreen(library: model.library).id(model.importAccountContext)
                    } label: { settingsRow("阅读风格", detail: "纸面、字体与排版", symbol: "textformat.size") }
                    .accessibilityIdentifier("settings-reading-style")
                    if model.account != nil {
                        NavigationLink { AccountRecordsScreen(model: model) } label: { settingsRow("笔记与阅读记录", detail: "回到留下想法的地方", symbol: "text.book.closed") }
                        NavigationLink { SavedReadingSummariesScreen(model: model) } label: { Label("阅读摘要", systemImage: "doc.text").frame(minHeight: 44) }
                    }
                }
                Section("书房与数据") {
                    if model.account != nil {
                        Button { Task { await model.synchronize() } } label: {
                            HStack { Label(model.syncing ? "正在同步" : "同步书房", systemImage: "arrow.triangle.2.circlepath"); Spacer(); if model.syncing { ProgressView() } }.frame(minHeight: 44)
                        }.disabled(model.syncing)
                        if !model.syncStatus.isEmpty { Text(model.syncStatus).font(.footnote).foregroundStyle(.secondary) }
                    }
                    NavigationLink {
                        List {
                            Section("保存在此设备") { Text("下载的书可离线阅读。笔记与位置先保存在此设备，联网后同步到原账号；未提交的笔记草稿留在本机。") }
                            Section("带走自己的记录") { Text("打开一本书，在阅读工具中可导出笔记与草稿；书籍详情可分享原文件。完整书房备份可在网页版的数据与 Agent 页面导出。") }
                            Section("AI 查阅范围") { Text("Chat 会显示本次引用的书与原文。提问前确认范围和点数，不读取私人笔记。") }
                        }.navigationTitle("离线与数据").navigationBarTitleDisplayMode(.inline)
                    } label: { Label("离线阅读与数据", systemImage: "iphone") }.frame(minHeight: 44)
                }
                Section {
                    LabeledContent("Leafhour", value: "留一点时间，读进一本书。")
                        .font(.footnote).foregroundStyle(.secondary)
                }.listRowBackground(Color.clear)
            }.scrollContentBackground(.hidden).background(Color.shelfPaper)
                .navigationTitle("设置")
                .toolbar { if presented { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } } } }
                .sheet(isPresented: $account, onDismiss: { Task { await model.cancelNativeAuthentication() } }) { AccountScreen(model: model) }
        }
    }
    private func settingsRow(_ title: String, detail: String, symbol: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: symbol).foregroundStyle(Color.leafInk).frame(width: 26)
            VStack(alignment: .leading, spacing: 4) { Text(title); Text(detail).font(.caption).foregroundStyle(.secondary) }
        }.frame(minHeight: 48)
    }
}

@MainActor @Observable final class ReadingStyleModel {
    var preferences = ReaderPreferences()
    var ready = false
    var error: String?
    private var library: OfflineLibrary?
    @ObservationIgnored private var writing: Task<Void, Never>?
    func load(_ library: OfflineLibrary?) async {
        await writing?.value
        ready = false
        self.library = library
        do {
            guard let library else { throw LibraryError.invalid("书房暂不可用，请返回书房后重试。") }
            preferences = try await library.readingPreferences(); ready = true; error = nil
        } catch { self.error = error.localizedDescription }
    }
    func update(_ preferences: ReaderPreferences) {
        self.preferences = preferences
        save()
    }
    func save() {
        guard ready, let library else { return }
        let value = preferences, previous = writing
        writing = Task {
            await previous?.value
            do { try await library.saveReaderPreferences(value); error = nil }
            catch { self.error = error.localizedDescription }
        }
    }
}

struct GlobalReadingStyleScreen: View {
    let library: OfflineLibrary?
    @State private var style = ReadingStyleModel()
    @State private var category: ReadingStyleCategory = .text
    @Environment(\.colorScheme) private var systemScheme
    private var preferences: Binding<ReaderPreferences> { Binding(get: { style.preferences }, set: { style.update($0) }) }
    var body: some View {
        Form {
            if style.ready {
                Section { ReadingStyleTabs(selection: $category) }.listRowBackground(Color.clear).listRowInsets(EdgeInsets())
                if category != .reading { Section {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("排版预览").font(.caption).foregroundStyle(.secondary)
                        ReaderPreferencesPanel.TypographyPreview(text: "留一点时间，读进一本书。\nStay with a book.", fontSize: style.preferences.fontSize, lineSpacing: style.preferences.lineSpacing, fontStyle: style.preferences.fontStyle)
                    }.padding(20).background(Color(uiColor: style.preferences.paperColor))
                        .environment(\.colorScheme, style.preferences.colorScheme(following: systemScheme))
                }.listRowInsets(EdgeInsets()) }
                ReadingAppearanceControls(preferences: preferences, category: category)
                if category == .reading { ReaderNavigationControls(preferences: preferences) }
            } else if style.error == nil { ProgressView("正在读取阅读风格…") }
            if let error = style.error {
                Section {
                    Text(error).font(.subheadline).foregroundStyle(.secondary)
                    Button("重试") { Task { if style.ready { style.save() } else { await style.load(library) } } }.frame(minHeight: 44)
                }
            }
        }.navigationTitle("阅读风格").navigationBarTitleDisplayMode(.inline)
            .task { await style.load(library) }
            .accessibilityIdentifier("global-reading-style")
    }
}
