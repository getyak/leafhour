import SwiftUI
import LeafhourCore

struct AccountScreen: View {
    @Bindable var model: LibraryModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var choosingAvatar = false
    @State private var authentication = NativeProviderAuthentication()
    @State private var email = ""
    @State private var password = ""
    @State private var code = ""
    @State private var useCode = false
    @State private var working = false
    @State private var error: String?
    @State private var codeSent = false
    @State private var nextCodeAt = Date.distantPast
    @State private var signingOut = false
    var body: some View {
        NavigationStack {
            Form {
                if let account = model.account {
                    Section {
                        HStack(spacing: 16) {
                            Button { choosingAvatar = true } label: {
                                ProfileAvatarView(owner: account.id, size: 60)
                            }.buttonStyle(.plain).accessibilityLabel("更换头像").accessibilityIdentifier("account-change-avatar")
                            VStack(alignment: .leading, spacing: 5) {
                                Text(account.displayName?.isEmpty == false ? account.displayName! : "我的账号").font(.headline)
                                if let email = account.email { Text(email).font(.subheadline).foregroundStyle(.secondary).textSelection(.enabled) }
                            }
                        }.padding(.vertical, 8)
                        NavigationLink { AccountNameScreen(model: model).id(account.id) } label: {
                            LabeledContent("名称", value: account.displayName?.isEmpty == false ? account.displayName! : "设置名称")
                        }.accessibilityIdentifier("account-edit-name")
                    }
                    Section {
                        NavigationLink("登录方式") { Form { providerRows }.navigationTitle("登录方式").navigationBarTitleDisplayMode(.inline).refreshable { await model.loadAuthenticationOptions() } }
                        NavigationLink { AccountDataScreen(model: model).id(model.importAccountContext) } label: { Text("导出数据") }
                    }
                    Section {
                        Button("退出登录", role: .destructive) { signingOut = true }
                            .disabled(model.busy || model.syncing || model.nativeAuthenticating)
                    }
                } else {
                    Section { Text("登录后同步书籍、笔记与阅读位置。").foregroundStyle(.secondary) }
                    if model.nativeAuthStatus?.providers.isEmpty == false || model.nativeAuthMessage != nil { Section { providerRows } }
                    Section {
                        TextField("邮箱", text: $email).textContentType(.username).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityIdentifier("leafhour-login-email")
                        if useCode {
                            TextField("邮箱验证码", text: $code).textContentType(.oneTimeCode).keyboardType(.numberPad).accessibilityIdentifier("leafhour-login-code")
                            TimelineView(.periodic(from: .now, by: 1)) { timeline in
                                Button(codeSent ? "重新发送验证码" : "发送验证码") {
                                    working = true; error = nil
                                    Task {
                                        defer { working = false }
                                        do { try await model.cloud.requestCode(email: email.trimmingCharacters(in: .whitespacesAndNewlines)); codeSent = true; nextCodeAt = Date().addingTimeInterval(60) }
                                        catch { self.error = error.localizedDescription }
                                    }
                                }.disabled(working || email.isEmpty || timeline.date < nextCodeAt)
                            }
                            if codeSent { Text("验证码已发送，请查看邮箱。").font(.footnote).foregroundStyle(.secondary) }
                        } else { SecureField("密码", text: $password).textContentType(.password).accessibilityIdentifier("leafhour-login-password") }
                        Button(action: signIn) { HStack { Text("登录"); Spacer(); if working { ProgressView() } } }
                            .disabled(working || email.isEmpty || (useCode ? code.isEmpty : password.isEmpty)).accessibilityIdentifier("leafhour-login-submit")
                        Button(useCode ? "使用密码登录" : "使用邮箱验证码") { useCode.toggle(); error = nil }.disabled(working)
                    }.disabled(model.nativeAuthenticating)
                    Section { Text("未登录的书籍与草稿保存在本机书房。").font(.footnote).foregroundStyle(.secondary) }
                }
                if let error { Section { Text(error).foregroundStyle(.red).font(.footnote).accessibilityIdentifier("leafhour-account-auth-error") } }
            }.accessibilityIdentifier("account-settings-form").scrollContentBackground(.hidden).background(Color(uiColor: .systemGroupedBackground))
                .navigationTitle(model.account == nil ? "登录" : "账号").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() }.disabled(working || model.nativeAuthenticating) } }
                .interactiveDismissDisabled(working || model.nativeAuthenticating)
                .background(NativeAuthenticationAnchor(onWindow: authentication.setAnchor).frame(width: 0, height: 0))
                .sheet(isPresented: $choosingAvatar) { ProfileAvatarPicker(owner: model.account?.id ?? "device").id(model.account?.id ?? "device") }
                .task { await model.loadAuthenticationOptions() }
                .onChange(of: scenePhase) { _, phase in if phase == .active { authentication.checkExpiry() } }
                .onChange(of: model.account?.id) { _, _ in if authentication.isActive { Task { await model.cancelNativeAuthentication() } } }
                .confirmationDialog("退出此账号？", isPresented: $signingOut, titleVisibility: .visible) {
                    Button("退出登录", role: .destructive) { Task { await model.signOut() } }
                    Button("取消", role: .cancel) {}
                } message: { Text("此设备的书籍与草稿会保留。") }
        }
    }
    private func signIn() {
        working = true; error = nil
        Task {
            defer { working = false; password = ""; code = "" }
            do { try await model.signIn(email: email.trimmingCharacters(in: .whitespacesAndNewlines), password: password, code: useCode ? code : nil); dismiss() }
            catch { self.error = error.localizedDescription }
        }
    }
    private func available(_ provider: NativeOAuthProvider) -> Bool {
        !working && !model.busy && !model.nativeAuthenticating && model.nativeAuthStatus?.available == true && model.nativeAuthStatus?.providers.contains(provider) == true
    }
    @ViewBuilder private var providerRows: some View {
        if model.account != nil {
            ForEach(model.linkedIdentities) { identity in
                LabeledContent(identity.provider == "email" ? "邮箱" : identity.provider == "apple" ? "Apple" : "Google", value: "已关联")
            }
        }
        ForEach(NativeOAuthProvider.allCases.filter { provider in
            model.nativeAuthStatus?.providers.contains(provider) == true && !model.linkedIdentities.contains { $0.provider == provider.rawValue }
        }) { provider in
            if model.account == nil && provider == .apple {
                NativeAppleAuthenticationButton(enabled: available(provider)) { begin(provider) }.frame(height: 50)
            } else {
                Button(model.account == nil ? "使用 \(provider.name) 继续" : "关联 \(provider.name)") { begin(provider) }
                    .frame(minHeight: 44).disabled(!available(provider))
                    .accessibilityIdentifier((model.account == nil ? "leafhour-login-" : "leafhour-link-") + provider.rawValue)
            }
        }
        if model.nativeAuthenticating { ProgressView("正在等待确认…") }
        if let message = model.nativeAuthMessage {
            Text(message).font(.footnote).foregroundStyle(.secondary).accessibilityIdentifier("leafhour-native-auth-status")
            Button("重试") { Task { await model.loadAuthenticationOptions() } }.disabled(model.nativeAuthenticating)
        }
    }
    private func begin(_ provider: NativeOAuthProvider) {
        error = nil; let signingIn = model.account == nil
        Task {
            do { try await model.authenticate(provider: provider, browser: authentication); if signingIn { dismiss() } }
            catch is CancellationError {}
            catch { self.error = error.localizedDescription }
        }
    }
}

struct AccountNameScreen: View {
    @Bindable var model: LibraryModel
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var working = false
    @State private var error: String?
    @FocusState private var focused: Bool
    init(model: LibraryModel) {
        self.model = model
        _name = State(initialValue: model.account?.displayName ?? "")
    }
    var body: some View {
        Form {
            Section {
                TextField("名称", text: $name).textContentType(.nickname).focused($focused)
                    .submitLabel(.done).onSubmit(save).accessibilityIdentifier("account-name-field")
            } footer: { Text("最多 80 个字符。") }
            if let error { Text(error).foregroundStyle(.red).accessibilityAddTraits(.updatesFrequently) }
        }.navigationTitle("名称").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("保存", action: save).disabled(working || name.count > 80).accessibilityIdentifier("account-name-save") } }
            .disabled(working)
            .task { focused = true }
    }
    private func save() {
        guard !working, let account = model.account else { return }
        working = true; error = nil
        Task {
            defer { working = false }
            do {
                try await model.saveDisplayName(name.trimmingCharacters(in: .whitespacesAndNewlines))
                guard model.account?.id == account.id else { return }
                dismiss()
            } catch { self.error = error.localizedDescription }
        }
    }
}

struct AccountRecordsScreen: View {
    @Bindable var model: LibraryModel
    @State private var selection = 0
    @State private var query = ""
    @State private var includeUnstarted = false
    private var search: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var notebookBooks: [AccountRecordsPresentation.Book] { AccountRecordsPresentation.notebookBooks(model.notebookEntries, query: query) }
    private var readingBooks: [CloudJSON] { AccountRecordsPresentation.readingBooks(model.summary, query: query, includeUnstarted: includeUnstarted) }
    var body: some View {
        List {
            Picker("记录类型", selection: $selection) { Text("我的笔记").tag(0); Text("阅读记录").tag(1) }.pickerStyle(.segmented)
            if selection == 0 {
                Text(model.notebookCursor == nil ? "只搜索此页已载入的书名、作者、笔记与引用。" : "只搜索已载入的书名、作者、笔记与引用；还有记录未读取，可继续载入。")
                    .font(.footnote).foregroundStyle(.secondary)
                AccountRecordsStatus(state: model.notebookState, title: "笔记") { Task { await model.loadAccountRecords() } }
                if notebookBooks.isEmpty { notebookEmptyState }
                ForEach(notebookBooks) { book in
                    Section(book.title) {
                        ForEach(book.rows) { note in
                            VStack(alignment: .leading, spacing: 9) {
                                Text(note.attribution).font(.caption).foregroundStyle(Color.leafInk)
                                Text(note.text).font(.body).textSelection(.enabled)
                                if !note.quote.isEmpty {
                                    Text(note.quoteAttribution + " · " + note.quote).font(.subheadline).foregroundStyle(.secondary).textSelection(.enabled)
                                }
                            }.padding(.vertical, 5)
                        }
                    }
                }
                if model.notebookCursor != nil {
                    Button("载入更多记录") { Task { await model.loadAccountRecords(more: true) } }
                        .frame(minHeight: 44).disabled(model.notebookState.isLoading)
                }
            } else {
                Text("搜索此页已载入的书名与作者。默认按已记录的真实阅读时长排序。").font(.footnote).foregroundStyle(.secondary)
                AccountRecordsStatus(state: model.summaryState, title: "阅读记录") { Task { await model.loadAccountRecords() } }
                if model.summary != .null {
                    Section("阅读概况") {
                        LabeledContent("累计阅读", value: duration(model.summary["allTime"]["durationSeconds"].number ?? 0))
                        LabeledContent("有阅读的天数", value: "\(Int(model.summary["allTime"]["readingDays"].number ?? 0)) 天")
                        Text("只统计实际记录的阅读时段；阅读时长不代表已经掌握。").font(.footnote).foregroundStyle(.secondary)
                    }
                    if model.summary["books"].array.contains(where: { ($0["durationSeconds"].number ?? 0) == 0 }) {
                        Toggle("包括尚未开始阅读的书", isOn: $includeUnstarted)
                    }
                    if readingBooks.isEmpty {
                        ContentUnavailableView(search.isEmpty ? "暂无已记录时长的书" : "已载入内容中没有匹配的书", systemImage: "book", description: Text(search.isEmpty ? "有实际阅读时段的书会显示在这里，也可以选择包括尚未开始的书。" : "只搜索当前已载入的书名与作者。"))
                    } else {
                        Section(includeUnstarted ? "按书查看" : "已记录的阅读 · 按时长排序") {
                            ForEach(Array(readingBooks.enumerated()), id: \.offset) { _, book in
                                let seconds = book["durationSeconds"].number ?? 0
                                LabeledContent(CloudShelfBook.title(book["title"]), value: seconds > 0 ? duration(seconds) : "尚未开始")
                            }
                        }
                    }
                }
            }
        }.navigationTitle("我的记录").navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, prompt: selection == 0 ? "搜索已载入的书与笔记" : "搜索已载入的书名")
            .task(id: model.account?.id) { await model.loadAccountRecords() }
            .refreshable { await model.loadAccountRecords() }
    }
    @ViewBuilder private var notebookEmptyState: some View {
        if !search.isEmpty && (model.notebookState.hasSnapshot || !model.notebookEntries.isEmpty) {
            ContentUnavailableView("已载入内容中没有匹配的笔记", systemImage: "magnifyingglass", description: Text(model.notebookCursor == nil ? "可以换个书名或笔记关键词。" : "还有记录未读取，可以继续载入后再查找。"))
        } else if model.notebookCursor != nil && (model.notebookState.hasSnapshot || !model.notebookEntries.isEmpty) {
            Text("已载入的页面暂无笔记，还有记录未读取，可以继续载入。").font(.subheadline).foregroundStyle(.secondary)
        } else if model.notebookState == .ready {
            ContentUnavailableView("还没有笔记", systemImage: "square.and.pencil", description: Text("网页与 iOS 的个人笔记会保存在同一间书房。书中有笔记或问题后会显示在这里。"))
        } else if case .cached = model.notebookState {
            Text("此前载入的记录中暂无可显示笔记。联网后可重新核对书房记录。").font(.subheadline).foregroundStyle(.secondary)
        } else if case .partial = model.notebookState {
            Text("当前已读取的内容中暂无可显示笔记，仍有部分记录待核对。").font(.subheadline).foregroundStyle(.secondary)
        }
    }
    private func duration(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds > 0 else { return "0 秒" }
        if seconds < 1 { return "少于 1 秒" }
        if seconds < 60 { return "\(Int(seconds)) 秒" }
        if seconds < 3600 { return "\(Int(seconds / 60)) 分钟" }
        return "\(Int(seconds / 3600)) 小时 \(Int(seconds.truncatingRemainder(dividingBy: 3600) / 60)) 分钟"
    }
}

struct AccountRecordsStatus: View {
    let state: AccountRecordsState
    let title: String
    let retry: () -> Void
    var body: some View {
        switch state {
        case .idle, .loading:
            ProgressView("正在读取" + title + "…")
        case .ready:
            EmptyView()
        case .partial(let message), .cached(let message), .failed(let message):
            VStack(alignment: .leading, spacing: 10) {
                Label(statusTitle, systemImage: statusIcon).font(.headline)
                Text(message).font(.subheadline).foregroundStyle(.secondary).textSelection(.enabled)
                Button("重新读取" + title, systemImage: "arrow.clockwise", action: retry).frame(minHeight: 44)
            }.padding(.vertical, 5)
        }
    }
    private var statusTitle: String {
        switch state {
        case .failed: "暂时无法读取" + title
        case .partial: "部分内容暂未更新"
        default: "保留此前载入的记录"
        }
    }
    private var statusIcon: String {
        if case .cached = state { "clock.arrow.circlepath" } else { "exclamationmark.circle" }
    }
}

/// A read-only view of loaded records; filtering never edits the account snapshot.
enum AccountRecordsPresentation {
    enum Kind { case note, question }
    struct Row: Identifiable {
        let id: String
        let value: CloudJSON
        let kind: Kind
        var text: String { value["text"].string ?? "" }
        var attribution: String {
            if value["origin"].string == "assistant" { return "AI 内容" }
            guard value["origin"].string == "user" else { return kind == .note ? "笔记 · 来源未标注" : "问题 · 来源未标注" }
            if kind == .note { return "我的笔记" }
            return value["status"].string == "open" ? "我的提问 · 未完成" : "我的提问"
        }
        var quote: String {
            value["quote"].string ?? value["parts"].array.compactMap { $0["text"].string }.joined(separator: "\n\n")
        }
        var quoteAttribution: String {
            switch value["quoteOrigin"].string {
            case "original": "作者原文"
            case "translation": "译文引用"
            default: "引用 · 来源未标注"
            }
        }
    }
    struct Book: Identifiable {
        let id: String
        let title: String
        let rows: [Row]
    }
    static func notebookBooks(_ entries: [CloudJSON], query: String = "") -> [Book] {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return entries.enumerated().compactMap { index, entry -> Book? in
            let title = CloudShelfBook.title(entry["book"]["title"])
            let bookMatches = query.isEmpty || matches(title, query) || matches(entry["book"]["author"].string ?? "", query)
            let rows = [(Kind.note, entry["records"]["comments"].array), (Kind.question, entry["records"]["questions"].array)].flatMap { kind, values -> [Row] in
                values.enumerated().compactMap { offset, value -> Row? in
                    guard value["deletedAt"] == .null, let text = value["text"].string, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
                    let row = Row(id: (kind == .note ? "note:" : "question:") + (value["id"].string ?? String(offset)), value: value, kind: kind)
                    return bookMatches || matches(text, query) || matches(row.quote, query) ? row : nil
                }
            }
            guard !rows.isEmpty else { return nil }
            return Book(id: entry["book"]["bookId"].string ?? String(index), title: title, rows: rows)
        }
    }
    static func readingBooks(_ summary: CloudJSON, query: String = "", includeUnstarted: Bool = false) -> [CloudJSON] {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return summary["books"].array.filter { book in
            let seconds = book["durationSeconds"].number ?? 0
            guard seconds.isFinite, seconds >= 0, includeUnstarted || seconds > 0 else { return false }
            return query.isEmpty || matches(CloudShelfBook.title(book["title"]), query) || matches(book["author"].string ?? "", query)
        }.sorted { first, second in
            let a = first["durationSeconds"].number ?? 0, b = second["durationSeconds"].number ?? 0
            if a != b { return a > b }
            let order = CloudShelfBook.title(first["title"]).localizedStandardCompare(CloudShelfBook.title(second["title"]))
            return order == .orderedSame ? (first["bookId"].string ?? "") < (second["bookId"].string ?? "") : order == .orderedAscending
        }
    }
    private static func matches(_ source: String, _ query: String) -> Bool {
        source.range(of: query, options: [.caseInsensitive, .diacriticInsensitive]) != nil
    }
}
