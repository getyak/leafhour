import SwiftUI
import LeafhourCore

struct AccountScreen: View {
    @Bindable var model: LibraryModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var authentication = NativeProviderAuthentication()
    @State private var email = ""
    @State private var password = ""
    @State private var code = ""
    @State private var useCode = false
    @State private var working = false
    @State private var error: String?
    @State private var codeSent = false
    @State private var nextCodeAt = Date.distantPast
    var body: some View {
        NavigationStack {
            Form {
                if let account = model.account {
                    signedInSettings(account)
                } else {
                    Section {
                        VStack(alignment: .leading, spacing: 8) {
                            Image(systemName: "leaf").font(.largeTitle).foregroundStyle(Color.leafInk)
                            Text("把自己的书房带在身边").font(.title3).bold()
                            Text("登录 Leafhour，继续阅读网页上传的书，找回自己的笔记与阅读记录。").foregroundStyle(.secondary)
                        }.padding(.vertical, 10)
                    }
                    providerOptions
                    Section("进入自己的书房") {
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
                            if codeSent { Text("验证码已发出，请查看邮箱。60 秒后可以重发。").font(.footnote).foregroundStyle(.secondary) }
                        } else { SecureField("密码", text: $password).textContentType(.password).accessibilityIdentifier("leafhour-login-password") }
                        Button {
                            working = true; error = nil
                            Task {
                                defer { working = false; password = "" }
                                do { try await model.signIn(email: email.trimmingCharacters(in: .whitespacesAndNewlines), password: password, code: useCode ? code : nil); dismiss() }
                                catch { self.error = error.localizedDescription }
                            }
                        } label: { HStack { Text("登录并同步"); Spacer(); if working { ProgressView() } } }
                            .disabled(working || email.isEmpty || (useCode ? code.isEmpty : password.isEmpty)).accessibilityIdentifier("leafhour-login-submit")
                        Button(useCode ? "使用密码登录" : "改用邮箱验证码") { useCode.toggle(); error = nil }.disabled(working)
                    }.disabled(model.nativeAuthenticating)
                    Section("先在本机阅读也可以") {
                        Text("未登录时导入的书与记录仍留在本机书房。登录不会自动把它们传给任何账号；回到本机书房可继续阅读或导出。").font(.footnote).foregroundStyle(.secondary)
                    }
                }
                if let error {
                    Section {
                        Text(error).foregroundStyle(.red).font(.footnote)
                            .accessibilityIdentifier("leafhour-account-auth-error")
                    }
                }
            }.scrollContentBackground(.hidden).background(Color(uiColor: .systemGroupedBackground))
                .navigationTitle(model.account == nil ? "登录书房" : "书房设置").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() }.disabled(working || model.nativeAuthenticating) } }
                .interactiveDismissDisabled(working || model.nativeAuthenticating)
                .background(NativeAuthenticationAnchor(onWindow: authentication.setAnchor).frame(width: 0, height: 0))
                .task { await model.loadAuthenticationOptions() }
                .onChange(of: scenePhase) { _, phase in if phase == .active { authentication.checkExpiry() } }
                .onChange(of: model.account?.id) { _, _ in if authentication.isActive { Task { await model.cancelNativeAuthentication() } } }
        }
    }
    @ViewBuilder private func signedInSettings(_ account: CloudAccount) -> some View {
                    Section {
                        HStack(alignment: .center, spacing: 16) {
                            Image(systemName: "person.crop.circle").font(.system(size: 44, weight: .ultraLight)).foregroundStyle(Color.leafInk)
                            VStack(alignment: .leading, spacing: 6) {
                                Text("自己的书与思考").font(.title3.weight(.semibold))
                                Text(account.email ?? "Leafhour 账号").font(.subheadline).foregroundStyle(.secondary).textSelection(.enabled)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }.padding(.vertical, 12)
                    }.listRowBackground(Color.clear)
                    Section("我的阅读") {
                        NavigationLink { AccountRecordsScreen(model: model) } label: {
                            accountLink("笔记与阅读记录", detail: "回到留下想法的地方", symbol: "text.book.closed")
                        }.accessibilityLabel("我的笔记与阅读记录")
                        NavigationLink { SavedReadingSummariesScreen(model: model) } label: {
                            accountLink("阅读摘要", detail: "整理过的理解，随时重读", symbol: "doc.text")
                        }.accessibilityLabel("我的阅读摘要")
                    }
                    Section("书房与设备") {
                        Button { Task { await model.synchronize() } } label: {
                            HStack(spacing: 12) {
                                Image(systemName: "arrow.triangle.2.circlepath").frame(width: 24).foregroundStyle(Color.leafInk)
                                Text(model.syncing ? "正在同步书房" : "同步书房").foregroundStyle(.primary)
                                Spacer()
                                if model.syncing { ProgressView().controlSize(.small) }
                            }.frame(minHeight: 44)
                        }.disabled(model.syncing)
                        if !model.syncStatus.isEmpty { Text(model.syncStatus).font(.footnote).foregroundStyle(.secondary) }
                        DisclosureGroup {
                            Text("下载的书可离线阅读。笔记与位置先保存在此设备，联网后同步到原账号；草稿留在这台设备。")
                                .font(.subheadline).foregroundStyle(.secondary).padding(.vertical, 6)
                        } label: { Label("离线与数据", systemImage: "iphone").foregroundStyle(.primary) }
                    }
                    Section {
                        DisclosureGroup { providerRows } label: { Label("登录方式", systemImage: "person.badge.key").foregroundStyle(.primary) }
                        Button("退出此账号", role: .destructive) { Task { await model.signOut() } }.frame(minHeight: 44)
                            .disabled(model.busy || model.syncing || model.nativeAuthenticating)
                    } header: { Text("账号") } footer: { Text("重新登录原账号，可以继续阅读这间书房。本机书房另行保留。") }
    }
    private func accountLink(_ title: String, detail: String, symbol: String) -> some View {
        HStack(spacing: 14) {
            Image(systemName: symbol).font(.title3.weight(.light)).foregroundStyle(Color.leafInk).frame(width: 26)
            VStack(alignment: .leading, spacing: 5) {
                Text(title).font(.body).foregroundStyle(.primary)
                Text(detail).font(.caption).foregroundStyle(.secondary)
            }
        }.padding(.vertical, 8)
    }
    private func available(_ provider: NativeOAuthProvider) -> Bool {
        !working && !model.busy && !model.nativeAuthenticating && model.nativeAuthStatus?.available == true && model.nativeAuthStatus?.providers.contains(provider) == true
    }
    private var providerOptions: some View {
        Section { providerRows } header: { Text("使用熟悉的登录方式") } footer: {
            Text("已有书房可以先用邮箱登录，再关联 Apple 或 Google。")
        }
    }
    @ViewBuilder private var providerRows: some View {
        Group {
            if model.account == nil {
                NativeAppleAuthenticationButton(enabled: available(.apple)) { begin(.apple) }.frame(height: 50)
                Button { begin(.google) } label: {
                    HStack { Image(systemName: "globe"); Text("使用 Google 继续").fontWeight(.medium) }.frame(maxWidth: .infinity).frame(minHeight: 50)
                }.buttonStyle(.bordered).disabled(!available(.google)).accessibilityIdentifier("leafhour-login-google")
                if let status = model.nativeAuthStatus, status.available, status.providers.isEmpty { Text("Apple 与 Google 登录暂未开放，可以使用下面的邮箱入口。").font(.footnote).foregroundStyle(.secondary) }
                if let status = model.nativeAuthStatus, status.available, !status.providers.isEmpty, status.providers.count < NativeOAuthProvider.allCases.count {
                    Text(NativeOAuthProvider.allCases.filter { !status.providers.contains($0) }.map(\.name).joined(separator: "、") + " 登录暂未开放。").font(.footnote).foregroundStyle(.secondary)
                }
            } else {
                ForEach(model.linkedIdentities) { identity in
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(identity.provider == "email" ? "邮箱" : identity.provider == "apple" ? "Apple" : "Google")
                            if let email = identity.email { Text(email).font(.caption).foregroundStyle(.secondary).textSelection(.enabled) }
                        }
                        Spacer()
                        Label(identity.emailVerified ? "已关联 · 邮箱已验证" : "已关联", systemImage: "checkmark.circle").font(.caption).foregroundStyle(Color.leafInk)
                    }.frame(minHeight: 44)
                }
                ForEach(NativeOAuthProvider.allCases.filter { provider in !model.linkedIdentities.contains { $0.provider == provider.rawValue } }) { provider in
                    Button("关联 \(provider.name)") { begin(provider) }.frame(minHeight: 44).disabled(!available(provider)).accessibilityIdentifier("leafhour-link-" + provider.rawValue)
                }
                Button("刷新登录方式", systemImage: "arrow.clockwise") { Task { await model.loadAuthenticationOptions() } }.disabled(model.nativeAuthenticating)
            }
            if model.busy {
                Label(model.account == nil ? "正在处理书籍，完成后可以登录。" : "正在处理书籍，完成后可以关联登录方式。", systemImage: "hourglass")
                    .font(.footnote).foregroundStyle(.secondary).accessibilityIdentifier("leafhour-auth-book-processing")
            }
            if model.nativeAuthenticating { ProgressView(model.account == nil ? "正在等待登录…" : "正在确认账号关联…") }
            if model.nativeAuthStatus == nil && model.nativeAuthMessage == nil { ProgressView("正在核对可用的登录方式…") }
            if let message = model.nativeAuthMessage { Text(message).font(.footnote).foregroundStyle(.secondary).accessibilityIdentifier("leafhour-native-auth-status") }
        }
    }

    private func begin(_ provider: NativeOAuthProvider) {
        error = nil
        let signingIn = model.account == nil
        Task {
            do { try await model.authenticate(provider: provider, browser: authentication); if signingIn { dismiss() } }
            catch is CancellationError { }
            catch { self.error = error.localizedDescription }
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
