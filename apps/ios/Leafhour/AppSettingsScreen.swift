import SwiftUI
import LeafhourCore
import UniformTypeIdentifiers

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
                                Text(model.account?.displayName?.isEmpty == false ? model.account!.displayName! : model.account == nil ? "登录" : "我的账号").font(.headline).foregroundStyle(.primary)
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
                    } label: { Label("阅读风格", systemImage: "textformat.size").frame(minHeight: 44) }
                    .accessibilityIdentifier("settings-reading-style")
                    if model.account != nil {
                        NavigationLink { AccountRecordsScreen(model: model) } label: { Label("笔记与记录", systemImage: "text.book.closed").frame(minHeight: 44) }
                        NavigationLink { SavedReadingSummariesScreen(model: model) } label: { Label("阅读摘要", systemImage: "doc.text").frame(minHeight: 44) }
                    }
                }
                Section("书房与数据") {
                    if model.account != nil {
                        Button { Task { await model.synchronize() } } label: {
                            HStack { Label(model.syncing ? "正在同步" : "同步书房", systemImage: "arrow.triangle.2.circlepath"); Spacer(); if model.syncing { ProgressView() } }.frame(minHeight: 44)
                        }.disabled(model.syncing)
                        if !model.syncStatus.isEmpty && !model.syncing { Text(model.syncStatus).font(.footnote).foregroundStyle(.secondary) }
                    }
                    NavigationLink {
                        List {
                            Section("保存在此设备") { Text("下载的书可离线阅读。笔记与位置先保存在此设备，联网后同步到原账号；未提交的笔记草稿留在本机。") }
                            Section("AI 查阅范围") { Text("Chat 会显示本次引用的书与原文。提问前确认范围和点数，不读取私人笔记。") }
                        }.navigationTitle("离线与数据").navigationBarTitleDisplayMode(.inline)
                    } label: { Label("离线阅读与数据", systemImage: "iphone") }.frame(minHeight: 44)
                    NavigationLink { AccountDataScreen(model: model).id(model.importAccountContext) } label: { Label("导出数据", systemImage: "square.and.arrow.up").frame(minHeight: 44) }
                }
                if model.account != nil { Section("连接") {
                    NavigationLink { ExternalMcpScreen(model: model).id(model.importAccountContext) } label: { Label("外部 MCP 服务器", systemImage: "puzzlepiece.extension").frame(minHeight: 44) }
                    NavigationLink { LeafhourMcpScreen(model: model).id(model.importAccountContext) } label: { Label("Leafhour MCP 服务器", systemImage: "arrow.up.right.square").frame(minHeight: 44) }
                }
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

}

extension LibraryModel {
    func settingsRequest(_ path: String, body: [String: CloudJSON]? = nil) async throws -> CloudJSON {
        guard let owner = account?.id else { throw LibraryError.invalid("请先登录。") }
        let marker = importAccountContext
        let bytes = try await cloud.data(path: path, method: body == nil ? "GET" : "POST", body: body.map { try CloudJSON.encode($0) }, ownerID: owner, timeout: 90)
        guard marker == importAccountContext, owner == account?.id else { throw CancellationError() }
        return try CloudJSON.decode(bytes)
    }
}

struct AccountDataScreen: View {
    @Bindable var model: LibraryModel
    @State private var originals = false
    @State private var audio = false
    @State private var working = false
    @State private var document: RecordsDocument?
    @State private var exporting = false
    @State private var filename = "Leafhour-data"
    @State private var message: String?
    var body: some View {
        Form {
            Section {
                Toggle("包含原文件", isOn: $originals)
                if model.account != nil { Toggle("包含云端听读音频", isOn: $audio) }
                Button { prepare(settingsOnly: false) } label: { HStack { Text("导出本人数据"); Spacer(); if working { ProgressView() } } }
                    .accessibilityIdentifier("settings-export-data")
            } footer: { Text(model.account == nil ? "包含本机书房的书籍信息、笔记、草稿、书签和阅读记录。" : "包含此账号的云端书房、译文、笔记、对话，以及此设备已保存的记录与草稿。") }
            Section {
                Button("导出设置") { prepare(settingsOnly: true) }.accessibilityIdentifier("settings-export-preferences")
            } footer: { Text("JSON 格式，可直接阅读。不包含密码或访问令牌。") }
            if let message { Section { Text(message).font(.footnote).foregroundStyle(.secondary).accessibilityIdentifier("settings-export-status") } }
        }.navigationTitle("导出数据").navigationBarTitleDisplayMode(.inline).disabled(working)
            .fileExporter(isPresented: $exporting, document: document, contentType: .json, defaultFilename: filename) { result in
                if case .failure(let error) = result { message = error.localizedDescription }
                document = nil
            }
    }
    private func prepare(settingsOnly: Bool) {
        guard !working else { return }
        working = true; message = "正在读取并校验…"; let marker = model.importAccountContext, owner = model.account?.id, deviceLibrary = model.library
        let includeOriginals = originals, includeAudio = audio
        Task {
            defer { working = false }
            do {
                let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
                var value: [String: CloudJSON] = ["kind": .string(settingsOnly ? "leafhour-settings" : "leafhour-personal-data"), "schemaVersion": .number(1)]
                if let owner {
                    if settingsOnly { value["account"] = try await model.settingsRequest("/api/account/settings/export") }
                    else { value = try await model.cloud.exportPersonalData(ownerID: owner, includeOriginals: includeOriginals, includeAudio: includeAudio).object }
                }
                guard marker == model.importAccountContext, owner == model.account?.id else { throw CancellationError() }
                if let library = deviceLibrary {
                    let used = try encoder.encode(CloudJSON.object(value)).count
                    value["device"] = try await library.exportDeviceRecords(includeOriginals: includeOriginals, settingsOnly: settingsOnly, maximumBytes: 512 * 1024 * 1024 - used)
                }
                guard marker == model.importAccountContext, owner == model.account?.id else { throw CancellationError() }
                let payload = CloudJSON.object(value)
                let bytes = try await Task.detached { let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]; return try encoder.encode(payload) }.value
                guard marker == model.importAccountContext, owner == model.account?.id else { throw CancellationError() }
                document = RecordsDocument(data: bytes); filename = settingsOnly ? "Leafhour-settings" : "Leafhour-data"; exporting = true; message = nil
            } catch is CancellationError { message = "账号已变化，请重新导出。" }
            catch { message = error.localizedDescription }
        }
    }
}

struct ExternalMcpScreen: View {
    @Bindable var model: LibraryModel
    @State private var connections: [CloudJSON] = []
    @State private var name = ""
    @State private var url = ""
    @State private var token = ""
    @State private var working = false
    @State private var message: String?
    var body: some View {
        Form {
            Section { Text("把外部工具连接到 Leafhour。不会自动发送书房内容。").font(.subheadline).foregroundStyle(.secondary) }
            Section("已连接") {
                if connections.isEmpty { Text("还没有连接").foregroundStyle(.secondary) }
                ForEach(Array(connections.enumerated()), id: \.offset) { _, connection in
                    if let id = connection["id"].string {
                        NavigationLink { McpToolsScreen(model: model, connection: connection) } label: {
                            VStack(alignment: .leading, spacing: 4) { Text(connection["name"].string ?? "MCP"); Text(connection["url"].string ?? "").font(.caption).foregroundStyle(.secondary).lineLimit(2) }
                        }
                        Button("断开连接", role: .destructive) { perform { let receipt = try await model.settingsRequest("/api/account/mcp-connectors/" + id + "/remove", body: [:]); try await load(); if (receipt["pendingCalls"].number ?? 0) > 0 { message = "已断开。已经开始的工具调用仍可能完成，请先核对结果再重试。" } } }
                    }
                }
            }
            Section {
                TextField("名称", text: $name).textContentType(.nickname)
                TextField("HTTPS MCP 地址", text: $url).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                SecureField("访问令牌（可选）", text: $token).textInputAutocapitalization(.never).autocorrectionDisabled()
                Button("连接") { perform { _ = try await model.settingsRequest("/api/account/mcp-connectors", body: ["name": .string(name), "url": .string(url), "token": .string(token)]); token = ""; name = ""; url = ""; try await load() } }
                    .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || url.isEmpty)
            } header: { Text("添加服务器") } footer: { Text("支持 Streamable HTTP。受保护的服务器可使用其提供的 Bearer 访问令牌。") }
            if working { ProgressView("正在连接…") }
            if let message { Text(message).font(.footnote).foregroundStyle(.secondary) }
        }.navigationTitle("外部 MCP 服务器").navigationBarTitleDisplayMode(.inline).disabled(working)
            .task { perform { try await load() } }.refreshable { perform { try await load() } }.onDisappear { token = "" }
    }
    private func load() async throws { connections = try await model.settingsRequest("/api/account/mcp-connectors")["connections"].array }
    private func perform(_ work: @escaping @MainActor () async throws -> Void) {
        guard !working else { return }; working = true; message = nil
        Task { defer { working = false }; do { try await work() } catch is CancellationError {} catch { message = error.localizedDescription } }
    }
}

struct McpToolsScreen: View {
    @Bindable var model: LibraryModel
    let connection: CloudJSON
    @State private var tools: [CloudJSON] = []
    @State private var selected = ""
    @State private var arguments = "{}"
    @State private var result = ""
    @State private var working = false
    @State private var confirm = false
    var body: some View {
        Form {
            Section { Text(connection["url"].string ?? "").font(.footnote).textSelection(.enabled) }
            Section {
                Picker("工具", selection: $selected) { ForEach(Array(tools.enumerated()), id: \.offset) { _, tool in Text(tool["title"].string ?? tool["name"].string ?? "").tag(tool["name"].string ?? "") } }
                if let tool = tools.first(where: { $0["name"].string == selected }) {
                    Text(tool["description"].string ?? "").font(.footnote).foregroundStyle(.secondary)
                    DisclosureGroup("参数格式") { Text(pretty(tool["inputSchema"])).font(.caption.monospaced()).textSelection(.enabled) }
                }
                TextEditor(text: $arguments).font(.body.monospaced()).frame(minHeight: 100).accessibilityLabel("参数 JSON")
                Button("调用工具") { confirm = true }.disabled(selected.isEmpty || working)
            } footer: { Text("仅发送以上参数。工具可能修改对方服务的数据。") }
            if working { ProgressView() }
            if !result.isEmpty { Section("结果") { Text(result).font(.footnote.monospaced()).textSelection(.enabled) } }
        }.navigationTitle(connection["name"].string ?? "工具").navigationBarTitleDisplayMode(.inline)
            .task { working = true; defer { working = false }; do { tools = try await model.settingsRequest(base + "/tools")["tools"].array; selected = tools.first?["name"].string ?? "" } catch { result = error.localizedDescription } }
            .confirmationDialog("向此服务器发送参数并调用工具？", isPresented: $confirm, titleVisibility: .visible) { Button("调用工具") { call() }; Button("取消", role: .cancel) {} }
    }
    private var base: String { "/api/account/mcp-connectors/" + (connection["id"].string ?? "") }
    private func pretty(_ value: CloudJSON) -> String { let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]; return (try? encoder.encode(value)).flatMap { String(data: $0, encoding: .utf8) } ?? "" }
    private func call() {
        guard !working else { return }; working = true
        Task { defer { working = false }; do { let value = try CloudJSON.decode(Data(arguments.utf8)); guard case .object = value else { throw LibraryError.invalid("参数必须是 JSON 对象。") }; result = pretty(try await model.settingsRequest(base + "/call", body: ["name": .string(selected), "arguments": value, "confirm": .bool(true)])) } catch { result = error.localizedDescription } }
    }
}

struct LeafhourMcpScreen: View {
    @Bindable var model: LibraryModel
    @State private var value: CloudJSON = .null
    @State private var message: String?
    @State private var working = false
    var body: some View {
        Form {
            Section {
                Text("让其他应用连接 Leafhour。由对方发起 OAuth 登录，你选择一本书和允许的权限。").font(.subheadline).foregroundStyle(.secondary)
                if let url = value["url"].string {
                    Text(url).font(.footnote.monospaced()).textSelection(.enabled)
                    Button("复制服务器地址") { UIPasteboard.general.string = url; message = "已复制" }
                }
            }
            Section("已授权") {
                let active = value["grants"].array.filter { $0["revoked"] != .bool(true) && !($0["scopes"].array.contains(.string("daily:deliver"))) && expiry($0) > Date() }
                if active.isEmpty { Text("暂无有效授权").foregroundStyle(.secondary) }
                ForEach(Array(active.enumerated()), id: \.offset) { _, grant in
                    VStack(alignment: .leading, spacing: 5) {
                        Text(model.cloudBooks.first(where: { $0.id == grant["bookId"].string })?.title ?? grant["bookId"].string ?? "书籍")
                        Text(grant["scopes"].array.compactMap(\.string).joined(separator: ", ")).font(.caption).foregroundStyle(.secondary)
                    }
                    Button("撤回授权", role: .destructive) { run { _ = try await model.settingsRequest("/api/library/grants/" + (grant["id"].string ?? "") + "/revoke", body: [:]); try await load() } }
                }
            }
            if working { ProgressView() }
            if let message { Text(message).font(.footnote).foregroundStyle(.secondary) }
        }.navigationTitle("Leafhour MCP 服务器").navigationBarTitleDisplayMode(.inline).disabled(working)
            .task { run { try await load() } }.refreshable { run { try await load() } }
    }
    private func expiry(_ row: CloudJSON) -> Date { let format = ISO8601DateFormatter(); format.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return format.date(from: row["expiresAt"].string ?? "") ?? .distantPast }
    private func load() async throws { value = try await model.settingsRequest("/api/account/mcp-server") }
    private func run(_ work: @escaping @MainActor () async throws -> Void) { guard !working else { return }; working = true; message = nil; Task { defer { working = false }; do { try await work() } catch is CancellationError {} catch { message = error.localizedDescription } } }
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
                ReadingAppearanceControls(preferences: preferences, category: category)
                if category != .reading { Section {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("排版预览").font(.caption).foregroundStyle(.secondary)
                        ReaderPreferencesPanel.TypographyPreview(text: "留一点时间，读进一本书。\nStay with a book.", fontSize: style.preferences.fontSize, lineSpacing: style.preferences.lineSpacing, fontStyle: style.preferences.fontStyle, latinFont: style.preferences.latinFont)
                    }.padding(20).background(Color(uiColor: style.preferences.paperColor))
                        .environment(\.colorScheme, style.preferences.colorScheme(following: systemScheme))
                }.listRowInsets(EdgeInsets()) }
                if category == .reading { ReaderNavigationControls(preferences: preferences) }
            } else if style.error == nil { ProgressView("正在读取阅读风格…") }
            if let error = style.error {
                Section {
                    Text(error).font(.subheadline).foregroundStyle(.secondary)
                    Button("重试") { Task { if style.ready { style.save() } else { await style.load(library) } } }.frame(minHeight: 44)
                }
            }
        }.listSectionSpacing(16).navigationTitle("阅读风格").navigationBarTitleDisplayMode(.inline)
            .task { await style.load(library) }
            .accessibilityIdentifier("global-reading-style")
    }
}
