import SwiftUI
import LeafhourCore

struct AccountScreen: View {
    @Bindable var model: LibraryModel
    @Environment(\.dismiss) private var dismiss
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
                    Section {
                        Label(account.email ?? "我的 Leafhour 账号", systemImage: "person.crop.circle.fill").font(.headline)
                        Text("与网页使用同一间书房。书籍下载后可离线阅读，笔记与位置先保存在此设备，再同步到自己的账号。").font(.footnote).foregroundStyle(.secondary)
                    }
                    Section {
                        NavigationLink { AccountRecordsScreen(model: model) } label: { Label("我的笔记与阅读记录", systemImage: "books.vertical") }
                        NavigationLink { SavedReadingSummariesScreen(model: model) } label: { Label("我的阅读摘要", systemImage: "text.book.closed") }
                        Button { Task { await model.synchronize() } } label: { Label(model.syncing ? "正在同步…" : "同步书房", systemImage: "arrow.triangle.2.circlepath") }.disabled(model.syncing)
                        if !model.syncStatus.isEmpty { Text(model.syncStatus).font(.footnote).foregroundStyle(.secondary) }
                    }
                    Section {
                        Button("退出此账号", role: .destructive) { Task { await model.signOut() } }.disabled(model.busy || model.syncing)
                    } footer: { Text("退出后隐藏这个账号的离线书籍与记录，重新登录原账号即可继续。本机书房另行保留。") }
                } else {
                    Section {
                        VStack(alignment: .leading, spacing: 8) {
                            Image(systemName: "leaf").font(.largeTitle).foregroundStyle(Color.leafInk)
                            Text("把自己的书房带在身边").font(.title3).bold()
                            Text("登录 Leafhour，继续阅读网页上传的书，找回自己的笔记与阅读记录。").foregroundStyle(.secondary)
                        }.padding(.vertical, 10)
                    }
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
                    }
                    if let error { Section { Text(error).foregroundStyle(.red).font(.footnote) } }
                    Section("先在本机阅读也可以") {
                        Text("未登录时导入的书与记录仍留在本机书房。登录不会自动把它们传给任何账号；回到本机书房可继续阅读或导出。").font(.footnote).foregroundStyle(.secondary)
                    }
                }
            }.navigationTitle(model.account == nil ? "登录书房" : "我的账号").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() }.disabled(working) } }
                .interactiveDismissDisabled(working)
        }
    }
}

struct AccountRecordsScreen: View {
    @Bindable var model: LibraryModel
    @State private var selection = 0
    @State private var loading = false
    var body: some View {
        List {
            Picker("记录类型", selection: $selection) { Text("我的笔记").tag(0); Text("阅读记录").tag(1) }.pickerStyle(.segmented)
            if selection == 0 {
                if model.notebookEntries.isEmpty && !loading { ContentUnavailableView("还没有笔记", systemImage: "square.and.pencil", description: Text("网页与 iOS 的个人笔记会保存在同一间书房。")) }
                ForEach(Array(model.notebookEntries.enumerated()), id: \.offset) { _, entry in
                    Section(CloudShelfBook.title(entry["book"]["title"])) {
                        let rows = entry["records"]["comments"].array + entry["records"]["questions"].array
                        if rows.isEmpty { Text("这本书还没有个人笔记").font(.footnote).foregroundStyle(.secondary) }
                        ForEach(Array(rows.enumerated()), id: \.offset) { _, note in
                            VStack(alignment: .leading, spacing: 9) {
                                Text(note["text"].string ?? "").textSelection(.enabled)
                                if let quote = note["quote"].string, !quote.isEmpty { Text("原文 · " + quote).font(.footnote).foregroundStyle(.secondary).textSelection(.enabled) }
                                if let status = note["status"].string { Text(status == "open" ? "未完成的问题" : "我的提问").font(.caption).foregroundStyle(Color.leafInk) }
                            }.padding(.vertical, 5)
                        }
                    }
                }
                if model.notebookCursor != nil { Button("载入更多记录") { load(more: true) }.disabled(loading) }
            } else if model.summary == .null {
                ContentUnavailableView("阅读记录暂未载入", systemImage: "icloud.slash", description: Text("联网后下拉同步，已有记录仍保留在自己的书房。"))
            } else {
                Section("阅读概况") {
                    LabeledContent("累计阅读", value: duration(model.summary["allTime"]["durationSeconds"].number ?? 0))
                    LabeledContent("有阅读的天数", value: "\(Int(model.summary["allTime"]["readingDays"].number ?? 0)) 天")
                    Text("只统计实际记录的阅读时段；阅读时长不代表已经掌握。").font(.footnote).foregroundStyle(.secondary)
                }
                Section("按书查看") {
                    ForEach(Array(model.summary["books"].array.enumerated()), id: \.offset) { _, book in
                        LabeledContent(CloudShelfBook.title(book["title"]), value: duration(book["durationSeconds"].number ?? 0))
                    }
                }
            }
            if loading { ProgressView("正在读取自己的记录…") }
            if !model.syncStatus.isEmpty { Text(model.syncStatus).font(.footnote).foregroundStyle(.secondary) }
        }.navigationTitle("我的记录").navigationBarTitleDisplayMode(.inline)
            .task { load() }
            .refreshable { await model.loadAccountRecords() }
    }
    private func load(more: Bool = false) { guard !loading else { return }; loading = true; Task { await model.loadAccountRecords(more: more); loading = false } }
    private func duration(_ seconds: Double) -> String { seconds < 60 ? "\(Int(seconds)) 秒" : "\(Int(seconds / 60)) 分钟" }
}
